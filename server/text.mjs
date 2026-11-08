import { readLocalConfig } from './config.mjs';
import { json, logLine, readJson, upstreamHeaders, timeoutSignal, isTimeoutError } from './http.mjs';
import { readLimitedBody } from './image-result.mjs';
import { fetchGeneration, upstreamFailure, formatUpstreamFailure, upstreamFailureDetail, publicUpstreamText, relayNotice } from './upstream-outcome.mjs';
import { rankedTextProviders, recordTextProviderFailure, recordTextProviderSuccess } from './text-routing.mjs';
import { requestError, MAX_PROMPT_LENGTH, MAX_REFERENCE_IMAGES } from '../shared/generation-contract.mjs';
import { createTextLimiter } from './request-guards.mjs';
import { creditError, creditRequestId, validateCreditQuote } from '../shared/credits-contract.mjs';
import { secretHash, UNKNOWN_OUTCOME_REFUND } from './credits-store.mjs';
import { MAX_SERIES_BRIEF_LENGTH } from '../shared/series-planning.mjs';
import { SERIES_SCENES, normalizeScene, parseScene, planningMessages, reviewScene, rewriteMessages } from '../shared/series-scenes.mjs';
import { PROMPT_POLISH_INSTRUCTIONS, validatePolishedPrompt } from '../shared/prompt-polish.mjs';
const TEXT_UPSTREAM_TIMEOUT_MS = 60_000;
// Streaming channels are judged by silence, not by total length: a reply that keeps arriving may run up to the cap.
const TEXT_STREAM_IDLE_MS = 60_000;
const TEXT_STREAM_TOTAL_MS = 180_000;
const TEXT_REPLY_LIMIT = 1024 * 1024;
// A slow first draft is returned as is, so one request never waits for two long calls.
const SERIES_REWRITE_BUDGET_MS = 90_000;
const textLimits = createTextLimiter();
let stateStore;
let stopping = false;
const inFlight = new Map();
const pendingSettlements = new Map();
const settlementWaiters = new Set();
export function initText(store) { stateStore = store; store.credits.recoverText(); }

export async function stopText() {
  stopping = true;
  for (const timer of pendingSettlements.values()) timer.ref?.();
  await Promise.allSettled([...inFlight.values()]);
  if (pendingSettlements.size) await new Promise((resolve) => { settlementWaiters.add(resolve); });
}

function extractResponsesText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  if (Array.isArray(data?.output)) {
    for (const output of data.output) {
      if (Array.isArray(output?.content)) {
        for (const item of output.content) {
          if (typeof item?.text === 'string' && item.text.trim()) return item.text.trim();
        }
      }
    }
  }
  return '';
}

function sanitizeTextOutput(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
}

function extractChatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return sanitizeTextOutput(content);
  if (Array.isArray(content)) {
    return sanitizeTextOutput(content.map((item) => item?.text || '').join(''));
  }
  return '';
}

// The server owns the instructions, so the text endpoint only runs polishing and series planning, never a caller-supplied system prompt.
function polishMessages(payload) {
  return [{ role: 'system', content: PROMPT_POLISH_INSTRUCTIONS }, { role: 'user', content: payload.content }];
}

// `source` is the user's text, so a reply that ignores it and only states a used-up quota is a channel error, not a result.
async function askText(textProvider, model, messages, execution, source) {
  execution.outcomeUnknown = true;
  const data = await callChat(textProvider, { model, messages });
  const text = extractChatText(data);
  const replied = data?.choices?.[0]?.message?.content != null;
  if (!text || text.length > 128000) throw Object.assign(new Error('文字通道未返回可用内容'), { definiteFailure: true, contentFailure: replied });
  const notice = relayNotice(text, source);
  if (notice) throw Object.assign(new Error(formatUpstreamFailure(notice, textProvider, '文字服务')), { definiteFailure: true, upstreamStatus: 200, detail: upstreamFailureDetail(notice, textProvider) });
  execution.outcomeUnknown = false;
  return text;
}

function parsePlan(scene, text, count) {
  try { return parseScene(scene, text, count); }
  catch { throw Object.assign(new Error(`分镜拆解未返回 ${count} 幕完整分镜`), { definiteFailure: true, contentFailure: true }); }
}

// One series request stays one credit charge: write once, check, and rewrite the flagged shots at most once.
// A valid first draft is never lost; a failed or worse rewrite falls back to it.
async function planSeries(textProvider, model, payload, execution) {
  const input = { scene: payload.scene, count: payload.sceneCount, content: payload.content, referenceCount: payload.referenceCount };
  const started = Date.now();
  const draft = parsePlan(payload.scene, await askText(textProvider, model, planningMessages(input), execution, payload.content), payload.sceneCount);
  const issues = reviewScene(payload.scene, draft.raw, payload.referenceCount);
  if (!issues.length) return JSON.stringify(draft.tasks);
  if (Date.now() - started > SERIES_REWRITE_BUDGET_MS) {
    logLine('INFO', `[series-plan] rewrite skipped, first draft took ${Math.round((Date.now() - started) / 1000)}s scene=${normalizeScene(payload.scene)} issues=${issues.length}`);
    return JSON.stringify(draft.tasks);
  }
  logLine('INFO', `[series-plan] rewrite scene=${normalizeScene(payload.scene)} issues=${issues.length}`);
  try {
    const revised = parsePlan(payload.scene, await askText(textProvider, model, rewriteMessages(input, draft.raw, issues), execution, payload.content), payload.sceneCount);
    if (reviewScene(payload.scene, revised.raw, payload.referenceCount).length <= issues.length) return JSON.stringify(revised.tasks);
  } catch (error) {
    logLine('WARN', `[series-plan] rewrite kept first draft scene=${normalizeScene(payload.scene)} error=${String(error.message || error).slice(0, 160)}`);
  }
  execution.outcomeUnknown = false;
  return JSON.stringify(draft.tasks);
}

function callChat(config, payload) {
  return config.stream ? callStreamUpstream(config, { ...payload, stream: true }) : callJsonUpstream(config, '/v1/chat/completions', { ...payload, stream: false });
}

// Server-sent events from /v1/chat/completions. Only a reply that reached its finish signal is usable; a cut stream
// or silence is an unknown outcome and is refunded without another call. An error event is a definite failure.
async function callStreamUpstream(config, payload) {
  const controller = new AbortController();
  let idleTimer, reason = '';
  const abort = (why) => { reason = why; controller.abort(); };
  const totalTimer = setTimeout(() => abort('total'), TEXT_STREAM_TOTAL_MS);
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => abort('idle'), TEXT_STREAM_IDLE_MS); };
  totalTimer.unref?.();
  try {
    touch();
    const upstream = await fetchGeneration(`${config.baseUrl}/v1/chat/completions`, { method: 'POST', headers: upstreamHeaders(config, 'application/json'), body: JSON.stringify(payload), signal: controller.signal });
    // Some relays ignore stream:true and answer with plain JSON; anything else that succeeded is read as events.
    if (!upstream.ok || String(upstream.headers.get('content-type') || '').includes('json')) {
      const body = await readLimitedBody(upstream, TEXT_REPLY_LIMIT, '文字结果过长, 无法读取完整结果');
      const failure = upstreamFailure(upstream.status, body, { strictServerErrors: false });
      if (failure) throw Object.assign(new Error(formatUpstreamFailure(failure, config, '文字服务')), { definiteFailure: !failure.outcomeUnknown, outcomeUnknown: failure.outcomeUnknown, upstreamStatus: upstream.status, detail: upstreamFailureDetail(failure, config) });
      return JSON.parse(body.toString('utf8'));
    }
    const decoder = new TextDecoder();
    let buffer = '', content = '', size = 0, finished = false;
    const handle = (line) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data) return;
      if (data === '[DONE]') { finished = true; return; }
      let event;
      try { event = JSON.parse(data); } catch { return; }
      const failure = event?.error ? upstreamFailure(200, event, { strictServerErrors: false }) : null;
      if (failure) throw Object.assign(new Error(formatUpstreamFailure(failure, config, '文字服务')), { definiteFailure: !failure.outcomeUnknown, outcomeUnknown: failure.outcomeUnknown, upstreamStatus: 200, detail: upstreamFailureDetail(failure, config) });
      const choice = event?.choices?.[0];
      content += choice?.delta?.content || choice?.message?.content || '';
      if (choice?.finish_reason) finished = true;
    };
    for await (const chunk of upstream.body) {
      touch();
      size += chunk.length;
      if (size > TEXT_REPLY_LIMIT) throw new Error('文字结果过长, 无法读取完整结果');
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) handle(line.trim());
    }
    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) handle(line.trim());
    if (!finished) throw Object.assign(new Error('文本上游的流式回复中途结束, 结果未知'), { outcomeUnknown: true });
    return { choices: [{ message: { content } }] };
  } catch (error) {
    if (reason) {
      const timeoutError = new Error(reason === 'idle' ? `文本上游 ${TEXT_STREAM_IDLE_MS / 1000}s 内没有新内容, 结果未知` : `文本上游 ${TEXT_STREAM_TOTAL_MS / 1000}s 内未完成, 结果未知`);
      throw Object.assign(timeoutError, { isTextTimeout: true, outcomeUnknown: true });
    }
    if (!error.definiteFailure) error.outcomeUnknown = true;
    throw error;
  } finally {
    clearTimeout(idleTimer); clearTimeout(totalTimer);
    // Releases the connection when an error event or a size limit ended the read early.
    controller.abort();
  }
}

async function callJsonUpstream(config, upstreamPath, payload) {
  try {
    const upstream = await fetchGeneration(`${config.baseUrl}${upstreamPath}`, {
      method: 'POST',
      headers: upstreamHeaders(config, 'application/json'),
      body: JSON.stringify(payload),
      signal: timeoutSignal(TEXT_UPSTREAM_TIMEOUT_MS),
    });
    const body = await readLimitedBody(upstream, TEXT_REPLY_LIMIT, '文字结果过长, 无法读取完整结果');
    const failure = upstreamFailure(upstream.status, body, { strictServerErrors: false });
    if (failure) throw Object.assign(new Error(formatUpstreamFailure(failure, config, '文字服务')), { definiteFailure: !failure.outcomeUnknown, outcomeUnknown: failure.outcomeUnknown, upstreamStatus: upstream.status, detail: upstreamFailureDetail(failure, config) });
    return JSON.parse(body.toString('utf8'));
  } catch (error) {
    if (!error.definiteFailure && !error.upstreamStatus && isTimeoutError(error)) {
      const timeoutError = new Error(`文本上游 ${Math.round(TEXT_UPSTREAM_TIMEOUT_MS / 1000)}s 内未响应, 结果未知`);
      timeoutError.isTextTimeout = true;
      timeoutError.outcomeUnknown = true;
      throw timeoutError;
    }
    if (!error.definiteFailure) error.outcomeUnknown = true;
    throw error;
  }
}

function validateTextInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw requestError('文字请求格式无效');
  // Pages built before the server composed the instructions still send their own messages.
  if ('input' in payload) throw requestError('页面版本已更新, 请刷新页面后重试');
  if (Object.keys(payload).some((key) => !['requestId', 'kind', 'creditQuote', 'content', 'sceneCount', 'referenceCount', 'scene'].includes(key))) throw requestError('文字请求格式无效');
  if (!['prompt', 'series'].includes(payload.kind)) throw requestError('文字任务类型无效');
  if (payload.kind === 'series' && (!Number.isInteger(payload.sceneCount) || payload.sceneCount < 3 || payload.sceneCount > 8)) throw requestError('分镜数量缺失或无效, 请刷新页面后重试');
  if (payload.kind === 'prompt' && payload.sceneCount !== undefined) throw requestError('提示词处理不能携带分镜数量');
  if (payload.referenceCount !== undefined && (payload.kind !== 'series' || !Number.isInteger(payload.referenceCount) || payload.referenceCount < 0 || payload.referenceCount > MAX_REFERENCE_IMAGES)) throw requestError('参考图数量无效');
  if (payload.scene !== undefined && (payload.kind !== 'series' || !SERIES_SCENES.includes(payload.scene))) throw requestError('系列场景无效, 请刷新页面后重试');
  const limit = payload.kind === 'series' ? MAX_SERIES_BRIEF_LENGTH : MAX_PROMPT_LENGTH;
  if (typeof payload.content !== 'string' || !payload.content.trim() || payload.content.length > limit) throw requestError(`文字内容为空或超过 ${limit} 字`);
  return { requestId: creditRequestId(payload.requestId), kind: payload.kind, creditQuote: validateCreditQuote(payload.creditQuote), content: payload.content, sceneCount: payload.sceneCount, referenceCount: payload.referenceCount, scene: payload.kind === 'series' ? normalizeScene(payload.scene) : undefined };
}

function commitResult(op, response) {
  const state = response.status === 200 ? 'charged' : 'refunded';
  try {
    stateStore.credits.settle(op.id, state, { result: response, error: response.body.error || '', reason: response.unknown ? UNKNOWN_OUTCOME_REFUND : '' });
    clearTimeout(pendingSettlements.get(op.id));
    pendingSettlements.delete(op.id);
    if (!pendingSettlements.size) { for (const resolve of settlementWaiters) resolve(); settlementWaiters.clear(); }
    return true;
  } catch {
    logLine('ERROR', `文字任务结算等待存储恢复: ${op.id}`);
    clearTimeout(pendingSettlements.get(op.id));
    const timer = setTimeout(() => { if (commitResult(op, response)) inFlight.delete(op.id); }, 5000);
    if (!stopping) timer.unref?.();
    pendingSettlements.set(op.id, timer);
    return false;
  }
}

function replyText(res, op, response) {
  const credit = stateStore.credits.publicCharge(op.id);
  const body = response.status === 200 || !credit?.unlimited ? response.body
    : { ...response.body, error: response.unknown ? '文字处理结果未知, 本次使用无限额度, 未扣减点数. 不会自动重新调用' : '文字处理未完成, 本次使用无限额度, 未扣减点数' };
  return json(res, response.status, { ...body, requestId: op.request_id, credit, settlementPending: pendingSettlements.has(op.id) });
}

async function replayText(res, op) {
  if (inFlight.has(op.id)) return replyText(res, op, await inFlight.get(op.id));
  if (op.result) return replyText(res, op, JSON.parse(op.result));
  if (['reserved', 'running'].includes(op.state)) return json(res, 202, { requestId: op.request_id, status: 'running' });
  throw creditError('此文字请求已结束, 临时文字结果已过期. 再次处理需要新建请求', 'TEXT_RESULT_EXPIRED', 409);
}

export async function handleTextResult(req, res, userId, requestId) {
  const op = stateStore.credits.byRequest(userId, creditRequestId(requestId));
  if (!op || op.kind === 'image') throw requestError('文字任务不存在', 404);
  return await replayText(res, op);
}

export async function handleTextGeneration(req, res, session) {
  const payload = validateTextInput(await readJson(req, 256 * 1024));
  // Defaults are left out so a request from a page built before scenes and reference counts keeps its original identity.
  const hash = secretHash(JSON.stringify({ kind: payload.kind, content: payload.content, sceneCount: payload.sceneCount, ...(payload.referenceCount ? { referenceCount: payload.referenceCount } : {}), ...(payload.scene && payload.scene !== 'general' ? { scene: payload.scene } : {}) }));
  const existing = stateStore.credits.byRequest(session.userId, payload.requestId);
  stateStore.credits.checkQuote(session, payload.creditQuote, !existing);
  if (existing) {
    if (existing.request_hash !== hash || existing.kind !== payload.kind) throw creditError('请求编号已用于不同内容', 'REQUEST_CONFLICT');
    return await replayText(res, existing);
  }
  const release = textLimits.acquire(session.userId);
  let op;
  try { op = stateStore.credits.reserveText(payload, session, hash); }
  catch (error) { release(); throw error; }
  const work = (async () => {
    const execution = { outcomeUnknown: false };
    let response;
    try { response = await generateText(payload, op, session, execution); }
    catch { response = execution.outcomeUnknown ? unknownTextResult() : { status: 503, body: { error: '文字任务未完成, 已释放占用点数, 请稍后重试', code: 'TEXT_FAILED' } }; }
    commitResult(op, response);
    return response;
  })().finally(() => { release(); if (!pendingSettlements.has(op.id)) inFlight.delete(op.id); });
  inFlight.set(op.id, work);
  return replyText(res, op, await work);
}

function unknownTextResult(attempts = []) {
  return { status: 409, unknown: true, body: { error: '文字处理结果未知, 本次不扣点. 不会自动重新调用', code: 'OUTCOME_UNKNOWN', attempts } };
}

async function generateText(payload, op, session, execution) {
  const config = await readLocalConfig();
  const errors = [];
  const attempts = [];
  const textProviders = rankedTextProviders(config.textProviders);
  if (!textProviders.length) return { status: 503, body: { error: '没有可用的文本通道, 已释放占用点数', code: 'TEXT_FAILED', attempts } };
  for (const textProvider of textProviders) {
    const model = textProvider.textModel;
    stateStore.credits.authorized(session);
    stateStore.credits.settle(op.id, 'running');
    try {
      execution.outcomeUnknown = true;
      let text;
      if (payload.kind === 'series') text = await planSeries(textProvider, model, payload, execution);
      else {
        text = await askText(textProvider, model, polishMessages(payload), execution, payload.content);
        try { text = validatePolishedPrompt(text); }
        catch (error) { throw Object.assign(error, { definiteFailure: true, contentFailure: true }); }
      }
      recordTextProviderSuccess(textProvider.id);
      if (errors.length) logLine('INFO', `[text-provider] fallback success provider=${textProvider.name} mode=chat_completions`);
      return { status: 200, body: { text, provider: 'chat_completions', providerName: textProvider.name, attempts } };
    } catch (error) {
      execution.outcomeUnknown = !error.definiteFailure;
      const message = error.message || String(error);
      const publicMessage = publicUpstreamText(message, textProvider);
      errors.push(`${textProvider.name} Chat Completions: ${publicMessage}`);
      attempts.push({ providerName: textProvider.name, mode: 'chat_completions', timeout: Boolean(error.isTextTimeout), error: publicMessage.slice(0, 180) });
      logLine('WARN', `[text-provider] failed provider=${textProvider.name} mode=chat_completions error=${(error.detail || message).slice(0, 240)}`);
      if (!error.contentFailure) recordTextProviderFailure(textProvider.id, message, logLine);
      if (execution.outcomeUnknown) return unknownTextResult(attempts);
    }
  }
  return { status: 502, body: { error: payload.kind === 'series' ? '分镜拆解未完成, 已释放占用灵感点, 请重试' : '文字处理失败, 已释放占用灵感点', code: 'TEXT_FAILED', attempts } };
}
