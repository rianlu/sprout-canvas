import { readLocalConfig } from './config.mjs';
import { json, logLine, readJson, upstreamHeaders, timeoutSignal, isTimeoutError } from './http.mjs';
import { readLimitedBody } from './image-result.mjs';
import { fetchGeneration, upstreamFailure, formatUpstreamFailure } from './upstream-outcome.mjs';
import { rankedTextProviders, recordTextProviderFailure, recordTextProviderSuccess } from './text-routing.mjs';
import { requestError, MAX_PROMPT_LENGTH } from '../shared/generation-contract.mjs';
import { createTextLimiter } from './request-guards.mjs';
import { creditError, creditRequestId, validateCreditQuote } from '../shared/credits-contract.mjs';
import { secretHash, UNKNOWN_OUTCOME_REFUND } from './credits-store.mjs';
import { buildSeriesSplitPrompt, parseSeriesPlan, MAX_SERIES_BRIEF_LENGTH } from '../shared/series-planning.mjs';
import { PROMPT_POLISH_INSTRUCTIONS, validatePolishedPrompt } from '../shared/prompt-polish.mjs';
const TEXT_UPSTREAM_TIMEOUT_MS = 60_000;
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
function textMessages(payload) {
  if (payload.kind === 'series') return [
    { role: 'system', content: buildSeriesSplitPrompt(payload.sceneCount) },
    // Same wording the page used to send; a real comparison dropped scenes more often with a shorter variant.
    { role: 'user', content: `系列梗概: ${payload.content}\n从梗概中提取主体与画面风格要求, 保持全系列一致.` },
  ];
  return [{ role: 'system', content: PROMPT_POLISH_INSTRUCTIONS }, { role: 'user', content: payload.content }];
}

async function callJsonUpstream(config, upstreamPath, payload) {
  try {
    const upstream = await fetchGeneration(`${config.baseUrl}${upstreamPath}`, {
      method: 'POST',
      headers: upstreamHeaders(config, 'application/json'),
      body: JSON.stringify(payload),
      signal: timeoutSignal(TEXT_UPSTREAM_TIMEOUT_MS),
    });
    const body = await readLimitedBody(upstream, 1024 * 1024, '文字结果过长, 无法读取完整结果');
    const failure = upstreamFailure(upstream.status, body, { strictServerErrors: false });
    if (failure) throw Object.assign(new Error(formatUpstreamFailure(failure, config)), { definiteFailure: !failure.outcomeUnknown, outcomeUnknown: failure.outcomeUnknown, upstreamStatus: upstream.status });
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
  if (Object.keys(payload).some((key) => !['requestId', 'kind', 'creditQuote', 'content', 'sceneCount'].includes(key))) throw requestError('文字请求格式无效');
  if (!['prompt', 'series'].includes(payload.kind)) throw requestError('文字任务类型无效');
  if (payload.kind === 'series' && (!Number.isInteger(payload.sceneCount) || payload.sceneCount < 3 || payload.sceneCount > 8)) throw requestError('分镜数量缺失或无效, 请刷新页面后重试');
  if (payload.kind === 'prompt' && payload.sceneCount !== undefined) throw requestError('提示词处理不能携带分镜数量');
  const limit = payload.kind === 'series' ? MAX_SERIES_BRIEF_LENGTH : MAX_PROMPT_LENGTH;
  if (typeof payload.content !== 'string' || !payload.content.trim() || payload.content.length > limit) throw requestError(`文字内容为空或超过 ${limit} 字`);
  return { requestId: creditRequestId(payload.requestId), kind: payload.kind, creditQuote: validateCreditQuote(payload.creditQuote), content: payload.content, sceneCount: payload.sceneCount };
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
  const hash = secretHash(JSON.stringify({ kind: payload.kind, content: payload.content, sceneCount: payload.sceneCount }));
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
      const data = await callJsonUpstream(textProvider, '/v1/chat/completions', { model, messages: textMessages(payload), stream: false });
      let text = extractChatText(data);
      // Model output that misses the contract depends on the user's input, so only a malformed reply counts against the channel circuit.
      const replied = data?.choices?.[0]?.message?.content != null;
      if (!text || text.length > 128000) throw Object.assign(new Error('文字通道未返回可用内容'), { definiteFailure: true, contentFailure: replied });
      if (payload.kind === 'series') {
        try { text = JSON.stringify(parseSeriesPlan(text, payload.sceneCount)); }
        catch { throw Object.assign(new Error(`分镜拆解未返回 ${payload.sceneCount} 幕完整分镜`), { definiteFailure: true, contentFailure: true }); }
      } else {
        try { text = validatePolishedPrompt(text); }
        catch (error) { throw Object.assign(error, { definiteFailure: true, contentFailure: true }); }
      }
      recordTextProviderSuccess(textProvider.id);
      if (errors.length) logLine('INFO', `[text-provider] fallback success provider=${textProvider.name} mode=chat_completions`);
      return { status: 200, body: { text, provider: 'chat_completions', providerName: textProvider.name, attempts } };
    } catch (error) {
      execution.outcomeUnknown = !error.definiteFailure;
      const message = error.message || String(error);
      errors.push(`${textProvider.name} Chat Completions: ${message}`);
      attempts.push({ providerName: textProvider.name, mode: 'chat_completions', timeout: Boolean(error.isTextTimeout), error: message.slice(0, 180) });
      logLine('WARN', `[text-provider] failed provider=${textProvider.name} mode=chat_completions error=${message.slice(0, 240)}`);
      if (!error.contentFailure) recordTextProviderFailure(textProvider.id, message, logLine);
      if (execution.outcomeUnknown) return unknownTextResult(attempts);
    }
  }
  return { status: 502, body: { error: payload.kind === 'series' ? '分镜拆解未完成, 已释放占用灵感点, 请重试' : '文字处理失败, 已释放占用灵感点', code: 'TEXT_FAILED', attempts } };
}
