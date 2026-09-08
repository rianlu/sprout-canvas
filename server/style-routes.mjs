import { json, readJson } from './http.mjs';
import { STYLE_ID, STYLE_LIMITS } from '../shared/style-contract.mjs';
import { requestError } from '../shared/generation-contract.mjs';

export function createStyleRoutes({ store, adminAuth, readConfig, requireUser }) {
  return async function route(req, res, url) {
    const admin = url.pathname.startsWith('/api/admin/');
    if (!admin && !url.pathname.startsWith('/api/styles')) return false;
    if (admin) {
      const config = await readConfig();
      if (url.pathname === '/api/admin/auth/status' && req.method === 'GET') { json(res, 200, adminAuth.status(req, config)); return true; }
      if (url.pathname === '/api/admin/auth/login' && req.method === 'POST') {
        const body = await readJson(req, 4096);
        const cookie = adminAuth.login(req, config, body?.password);
        json(res, 200, { ok: true }, { 'Set-Cookie': cookie }); return true;
      }
      if (url.pathname === '/api/admin/auth/logout' && req.method === 'POST') { json(res, 200, { ok: true }, { 'Set-Cookie': adminAuth.logout(req, config) }); return true; }
      adminAuth.require(req, config);
    } else if (!await requireUser(req, res)) return true;
    const pathname = admin ? url.pathname.replace('/api/admin/', '/api/') : url.pathname;
    if (pathname === '/api/styles' && req.method === 'GET') { json(res, 200, store.catalog(admin)); return true; }
    const image = pathname.match(/^\/api\/styles\/images\/([^/]+)$/);
    if (image && req.method === 'GET') {
      const file = store.image(image[1], admin);
      res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, no-cache' });
      res.end(file.bytes); return true;
    }
    if (!admin) throw requestError('接口不存在', 404);
    if (pathname === '/api/styles' && req.method === 'POST') { json(res, 201, { style: store.create(await readJson(req, 17 * 1024 * 1024)) }); return true; }
    if (pathname === '/api/styles/export' && req.method === 'GET') {
      json(res, 200, store.export(), { 'Content-Disposition': `attachment; filename="sprout-styles-${new Date().toISOString().slice(0, 10)}.json"` }); return true;
    }
    if (pathname === '/api/styles/import' && req.method === 'POST') {
      const body = await readJson(req, STYLE_LIMITS.archiveBytes);
      if (!body || typeof body !== 'object') throw requestError('备份内容无效');
      json(res, 200, url.searchParams.get('preview') === '1' ? store.previewImport(body.archive) : store.import(body.archive, body.revision)); return true;
    }
    const match = pathname.match(/^\/api\/styles\/([^/]+)$/);
    if (match && STYLE_ID.test(match[1])) {
      if (req.method === 'PUT') { json(res, 200, { style: store.update(match[1], await readJson(req, 17 * 1024 * 1024)) }); return true; }
      if (req.method === 'DELETE') { const body = await readJson(req, 4096); store.remove(match[1], body?.version); json(res, 200, { ok: true }); return true; }
    }
    throw requestError('接口不存在', 404);
  };
}
