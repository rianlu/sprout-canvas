import { requestError } from './generation-contract.mjs';

export const CREDIT_LIMITS = Object.freeze({ points: 1_000_000_000, price: 1_000_000, batch: 100, note: 120, reason: 300 });
export const ACCESS_CODE_PATTERN = /^sc_[A-Za-z0-9_-]{32}$/;
export const CREDIT_DEFAULTS = Object.freeze({ image: 10, text: 1 });
export function creditError(message, code, statusCode = 409, details = {}) {
  return Object.assign(requestError(message, statusCode), { code, details });
}
export function creditInteger(value, name, min = 0, max = CREDIT_LIMITS.points) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw requestError(`${name} 必须是 ${min} 到 ${max} 的整数`);
  return value;
}
export function creditRequestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw requestError('请求编号无效');
  return value;
}
export function creditText(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw requestError(`${name} 无效或过长`);
  return value.trim();
}
export function validateCreditQuote(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['accessCodeId', 'userId', 'version', 'unlimited'].includes(key))) throw requestError('缺少有效的灵感点报价');
  if (value.unlimited !== undefined && typeof value.unlimited !== 'boolean') throw requestError('额度模式无效');
  return { accessCodeId: creditRequestId(value.accessCodeId), userId: creditRequestId(value.userId), version: creditInteger(value.version, '点值版本', 1, Number.MAX_SAFE_INTEGER), unlimited: value.unlimited ?? false };
}
