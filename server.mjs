import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, readLocalConfig, publicConfig } from './server/config.mjs';
import { json, setBaseHeaders, logLine, timeoutSignal, upstreamHeaders, stripHtml, readJson } from './server/http.mjs';
import { initAuth, sessionFromRequest, handleAuthStatus, handleAuthLogin, handleAuthLogout, requireApiAuth } from './server/auth.mjs';
import { handleTextGeneration } from './server/text.mjs';
import { getTextProviderCircuitState, isTextProviderCircuitOpen } from './server/text-routing.mjs';
import { createStateStore } from './server/state-store.mjs';
import { validateGenerationSubmission, toImagesPayload, requestError } from './shared/generation-contract.mjs';
import * as queue from './server/queue.mjs';
import { createStyleStore } from './server/style-store.mjs';
import { createAdminAuth } from './server/admin-auth.mjs';
import { createStyleRoutes } from './server/style-routes.mjs';

let shuttingDown = false;
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'], ['.txt', 'text/plain; charset=utf-8'],
]);
const bootConfig = await readLocalConfig().catch((error) => {
  console.error(error.message);
  console.error('请在 config/local.config.json 中填写有效配置.');
  process.exit(1);
});
const state = createStateStore(bootConfig.stateFile);
globalThis.__LOG_FILE__ = bootConfig.logFile;
const styles = createStyleStore(bootConfig.styleDataDir, { log: logLine });
const styleRoutes = createStyleRoutes({ store: styles, adminAuth: createAdminAuth(styles, bootConfig.cookieNamespace), readConfig: readLocalConfig, requireUser: requireApiAuth });
initAuth(state, bootConfig.cookieNamespace);
queue.init({ readLocalConfig, upstreamHeaders, timeoutSignal, stripHtml, logLine });
queue.initializePersistence(state);

async function health(req, res, detailed = false) {
  if (shuttingDown) return json(res, 503, { ok: false });
  if (!detailed) return json(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) });
  await readLocalConfig();
  json(res, 200, { ok: true, imageConcurrency: 1 });
}

async function configResponse(req, res) {
  const config = await readLocalConfig();
  const imageChannels = queue.providerHealth(config.imageProviders);
  const textChannels = config.textProviders.map((provider) => {
    const open = isTextProviderCircuitOpen(provider.id);
    const state = getTextProviderCircuitState(provider.id);
    return { id: provider.id, name: provider.name, status: open ? 'cooldown' : state.lastError ? 'degraded' : state.lastSuccessAt ? 'available' : 'untested', failures: state.failures, openUntil: state.openUntil, lastSuccessAt: state.lastSuccessAt || 0 };
  });
  json(res, 200, { ...publicConfig(config), imageChannels, textChannels, imageCapabilities: { customSizes: config.imageProviders.some((provider) => provider.generationMode === 'images' && /^gpt-image-2(?:-|$)/.test(provider.imageModel)), formats: [...new Set(config.imageProviders.flatMap((provider) => provider.capabilities.outputFormats))], exactSize: config.imageProviders.every((provider) => provider.capabilities.exactSize), maxReferences: 4 } });
}

async function submit(req, res) {
  const input = validateGenerationSubmission(await readJson(req));
  const userId = sessionFromRequest(req).userId;
  if (queue.findSubmission(userId, input.requestId)) return json(res, 202, queue.submitGeneration(input, userId));
  const config = await readLocalConfig(input.providerId);
  const payload = Buffer.from(JSON.stringify(toImagesPayload(input)));
  if (!config.imageProviders.some((provider) => queue.providerSupportsRequest(provider, '/v1/images/generations', 'application/json', payload))) throw requestError('当前通道不支持这些生成参数');
  const selected = input.providerId ? config : queue.chooseImageProvider(config, '/v1/images/generations', 'application/json', '', payload);
  if (!queue.providerSupportsRequest(selected, '/v1/images/generations', 'application/json', payload)) throw requestError('当前通道不支持这些生成参数');
  json(res, 202, queue.submitGeneration(input, userId, selected));
}

function result(req, res, jobId) {
  const outcome = queue.getJobResult(jobId, sessionFromRequest(req).userId);
  if (outcome.kind === 'missing') throw requestError('任务不存在或已过期', 404);
  if (outcome.kind === 'progress') return json(res, 202, outcome.job);
  res.writeHead(outcome.status, { 'Content-Type': outcome.contentType, 'Cache-Control': 'no-store' });
  res.end(outcome.body);
}

async function serveStatic(req, res, pathname) {
  let cleanPath;
  try {
    cleanPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  } catch {
    json(res, 400, { error: '请求路径编码无效' });
    return;
  }
  if (cleanPath.startsWith('/config/') || cleanPath.includes('/.') || path.basename(cleanPath).startsWith('.')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const staticRoot = path.resolve(ROOT, 'dist');
  const entryPath = path.join(staticRoot, 'index.html');
  if (!existsSync(entryPath)) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>需要构建</title><body><h1>前端产物不存在</h1><p>请先运行 <code>npm run build</code>, 或开发时同时运行 <code>npm start</code> 和 <code>npm run dev</code>.</p></body>');
    return;
  }
  const filePath = path.resolve(staticRoot, `.${cleanPath}`);
  const relativePath = path.relative(staticRoot, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream' });
    res.end(data);
  } catch {
    if (!path.extname(cleanPath)) {
      const data = await readFile(entryPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer((req, res) => {
  setBaseHeaders(req, res);
  void route(req, res).catch((error) => {
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode >= 500) logLine('ERROR', `HTTP ${req.method} ${(req.url || '').split('?')[0]}: ${error.message}`);
    json(res, statusCode, { error: statusCode >= 500 ? '服务暂时无法完成请求, 请稍后重试' : error.message });
  });
});

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health' && req.method === 'GET') return await health(req, res);
  if (url.pathname === '/ready' && req.method === 'GET') return await health(req, res, true);
  if (shuttingDown) throw requestError('服务正在重启, 请稍后重试', 503);
  if (url.pathname === '/api/auth/status' && req.method === 'GET') return await handleAuthStatus(req, res);
  if (url.pathname === '/api/auth/login' && req.method === 'POST') return await handleAuthLogin(req, res);
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') return await handleAuthLogout(req, res);
  if (await styleRoutes(req, res, url)) return;
  if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res, url.pathname);
  if (!(await requireApiAuth(req, res))) return;
  const userId = sessionFromRequest(req).userId;
  if (url.pathname === '/api/config' && req.method === 'GET') return await configResponse(req, res);
  if (url.pathname === '/api/text' && req.method === 'POST') return await handleTextGeneration(req, res);
  if (url.pathname === '/api/jobs' && req.method === 'POST') return await submit(req, res);
  if (url.pathname === '/api/jobs/me' && req.method === 'GET') {
    const requestIds = (url.searchParams.get('requests') || '').split(',').filter(Boolean);
    if (requestIds.length > 100 || requestIds.some((id) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) throw requestError('请求编号列表无效');
    return json(res, 200, queue.getJobsForUser(userId, { cursor: url.searchParams.get('cursor') || '', limit: Number(url.searchParams.get('limit') || 30), requestIds }));
  }
  if (url.pathname === '/api/jobs/archive' && req.method === 'POST') {
    queue.archiveCompleted(userId); return json(res, 200, { ok: true });
  }
  const match = url.pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]+)(?:\/(result|ack|priority|resume))?$/);
  if (!match) throw requestError('接口不存在', 404);
  const [, jobId, action] = match;
  if (action === 'result' && req.method === 'GET') return result(req, res, jobId);
  if (action === 'ack' && req.method === 'POST') return json(res, 200, queue.acknowledge(jobId, userId));
  if (action === 'priority' && req.method === 'POST') return json(res, 200, queue.prioritize(jobId, userId));
  if (action === 'resume' && req.method === 'POST') return json(res, 202, queue.resumeGeneration(jobId, userId, validateGenerationSubmission(await readJson(req))));
  if (!action && req.method === 'PATCH') {
    const input = validateGenerationSubmission(await readJson(req));
    const job = queue.getJobStatus(jobId, userId);
    if (!job) throw requestError('任务不存在', 404);
    const provider = await readLocalConfig(job.providerId);
    return json(res, 200, queue.updatePendingGeneration(jobId, userId, input, provider));
  }
  if (!action && req.method === 'DELETE') {
    const outcome = queue.cancel(jobId, userId);
    if (!outcome.ok) throw requestError(outcome.error, outcome.status);
    return json(res, 200, outcome);
  }
  if (!action && req.method === 'GET') {
    const job = queue.getJobStatus(jobId, userId);
    if (!job) throw requestError('任务不存在或已过期', 404);
    return json(res, 200, job);
  }
  throw requestError('接口不支持此方法', 405);
}

server.listen(bootConfig.port, bootConfig.host, () => {
  logLine('INFO', `芽绘台 SproutCanvas 已启动: http://${bootConfig.host}:${bootConfig.port}`);
  logLine('INFO', '生图队列: 单 worker, 用户间公平轮询. 图片仅在内存临时中转.');
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logLine('INFO', `收到 ${signal}, 等待当前任务结束...`);
  const deadline = setTimeout(() => { logLine('WARN', '关闭等待超时, 未完成任务将在重启后标记为中断'); process.exit(1); }, 450000);
  deadline.unref?.();
  const httpClosed = new Promise((resolve) => server.close(resolve));
  await queue.stopWorker();
  await httpClosed;
  state.close();
  styles.close();
  clearTimeout(deadline);
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
