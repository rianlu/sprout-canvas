import { MAX_PROMPT_LENGTH, requestError } from './generation-contract.mjs';

export const STYLE_LIMITS = Object.freeze({ prompt: MAX_PROMPT_LENGTH, imageBytes: 12 * 1024 * 1024, archiveBytes: 64 * 1024 * 1024, entries: 1000 });
export const STYLE_ARCHIVE_FORMAT = 'sprout-canvas-styles';
export const STYLE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const STYLE_IMAGE_FILE = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
// Fixed choices for the admin form, in decision order: layout first, then visual texture; the first match wins.
// Stored values stay plain text so backups carrying older category names still import unchanged.
export const STYLE_CATEGORIES = Object.freeze([
  { name: '角色与分镜', hint: '多格, 多视图, 表情包或宫格' },
  { name: '商品广告', hint: '产品, 包装, 品牌或电商宣传' },
  { name: '知识图鉴', hint: '标注, 拆解, 信息图或地图' },
  { name: '立体造型', hint: '黏土, 手办, 微缩, 纸雕或 3D' },
  { name: '写实摄影', hint: '像照片: 人像, 胶片, 棚拍' },
  { name: '平面设计', hint: '色块, 网点, 拼贴, 故障或排版' },
  { name: '绘画插画', hint: '笔触颜料: 水彩, 水墨, 动漫' },
]);

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
