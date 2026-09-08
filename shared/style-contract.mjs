import { MAX_PROMPT_LENGTH, requestError } from './generation-contract.mjs';

export const STYLE_LIMITS = Object.freeze({ prompt: MAX_PROMPT_LENGTH, imageBytes: 12 * 1024 * 1024, archiveBytes: 64 * 1024 * 1024, entries: 1000 });
export const STYLE_ARCHIVE_FORMAT = 'sprout-canvas-styles';
export const STYLE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const STYLE_IMAGE_FILE = /^[a-f0-9]{64}\.(png|jpg|webp)$/;

function text(value, label, limit, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw requestError(`${label}${required ? '不能为空, 且' : ''}最多 ${limit} 个字符`);
  return value;
}

export function validateStyleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw requestError('风格内容必须是对象');
  const allowed = ['name', 'prompt', 'author', 'category', 'sourceUrl', 'published', 'sortOrder', 'imageDataUrl', 'version'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw requestError('风格内容包含未知字段');
  const prompt = text(input.prompt, '提示词', STYLE_LIMITS.prompt, true);
  const name = text(input.name, '名称', 100).trim() || Array.from(prompt.trim().replace(/\s+/g, ' ')).slice(0, 24).join('');
  const sourceUrl = text(input.sourceUrl, '来源链接', 2048).trim();
  const category = text(input.category, '分类', 60).trim();
  if (category === '全部') throw requestError('请使用具体分类名称, 全部为筛选项');
  if (sourceUrl) {
    let url;
    try { url = new URL(sourceUrl); } catch { throw requestError('来源链接必须是完整的 http 或 https 地址'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw requestError('来源链接必须是普通 http 或 https 地址');
  }
  if (input.published !== undefined && typeof input.published !== 'boolean') throw requestError('上架状态无效');
  if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 999999)) throw requestError('排序须为 0 到 999999 的整数');
  if (input.version !== undefined && (!Number.isSafeInteger(input.version) || input.version < 1)) throw requestError('风格版本无效');
  if (input.imageDataUrl !== undefined && typeof input.imageDataUrl !== 'string') throw requestError('示例图格式无效');
  return { name, prompt, author: text(input.author, '作者', 200).trim(), category: category === '未分类' ? '' : category, sourceUrl, published: input.published ?? true, sortOrder: input.sortOrder ?? 0 };
}
