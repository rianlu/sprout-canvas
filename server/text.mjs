import { readLocalConfig } from './config.mjs';
import { json, logLine, readRequestBody, upstreamHeaders, timeoutSignal, isTimeoutError, readUpstreamError } from './http.mjs';
import { rankedTextProviders, recordTextProviderFailure, recordTextProviderSuccess } from './text-routing.mjs';
const TEXT_UPSTREAM_TIMEOUT_MS = 60_000;

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

function inputItemToText(item) {
  if (typeof item?.content === 'string') return item.content;
  if (!Array.isArray(item?.content)) return '';
  return item.content
    .map((part) => part?.text || part?.input_text || '')
    .filter(Boolean)
    .join('\n');
}

function responsesPayloadToChatPayload(payload, config) {
  const messages = Array.isArray(payload?.input)
    ? payload.input.map((item) => ({ role: item.role || 'user', content: inputItemToText(item) })).filter((item) => item.content)
    : [{ role: 'user', content: String(payload?.input || '') }];
  return {
    model: payload?.model || config.textModel,
    messages,
    stream: false,
  };
}

async function callJsonUpstream(config, upstreamPath, payload) {
  try {
    const upstream = await fetch(`${config.baseUrl}${upstreamPath}`, {
      method: 'POST',
      headers: upstreamHeaders(config, 'application/json'),
      body: JSON.stringify(payload),
      signal: timeoutSignal(TEXT_UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) throw new Error(await readUpstreamError(upstream, config));
    return upstream.json();
  } catch (error) {
    if (isTimeoutError(error)) {
      const timeoutError = new Error(`文本上游 ${Math.round(TEXT_UPSTREAM_TIMEOUT_MS / 1000)}s 内未响应, 已切换备用服务商`);
      timeoutError.isTextTimeout = true;
      throw timeoutError;
    }
    throw error;
  }
}

export async function handleTextGeneration(req, res) {
  let config;
  try {
    config = await readLocalConfig();
  } catch (error) {
    json(res, 500, { error: error.message });
    return;
  }
  let payload;
  try {
    payload = JSON.parse((await readRequestBody(req, 256 * 1024)).toString('utf8') || '{}');
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 400;
    json(res, statusCode, { error: statusCode === 400 ? '请求体不是有效 JSON' : error.message || String(error) });
    return;
  }
  const errors = [];
  const attempts = [];
  const textProviders = rankedTextProviders(config.textProviders);
  if (!textProviders.length) {
    json(res, 503, { error: '没有健康的文本服务商', attempts });
    return;
  }
  for (const textProvider of textProviders) {
    const model = textProvider.textModel;
    try {
      const chatPayload = responsesPayloadToChatPayload({ ...payload, model }, textProvider);
      const data = await callJsonUpstream(textProvider, '/v1/chat/completions', chatPayload);
      const text = extractChatText(data);
      if (!text) throw new Error('Chat Completions API 未返回文本内容');
      recordTextProviderSuccess(textProvider.id);
      if (errors.length) logLine('INFO', `[text-provider] fallback success provider=${textProvider.name} mode=chat_completions`);
      json(res, 200, { text, provider: 'chat_completions', providerName: textProvider.name, attempts });
      return;
    } catch (error) {
      const message = error.message || String(error);
      errors.push(`${textProvider.name} Chat Completions: ${message}`);
      attempts.push({ providerName: textProvider.name, mode: 'chat_completions', timeout: Boolean(error.isTextTimeout), error: message.slice(0, 180) });
      logLine('WARN', `[text-provider] failed provider=${textProvider.name} mode=chat_completions error=${message.slice(0, 240)}`);
      recordTextProviderFailure(textProvider.id, message, logLine);
    }
  }
  json(res, 502, { error: errors.join(' | '), attempts });
}
