import { MAX_PROMPT_LENGTH } from './generation-contract.mjs';

export const PROMPT_POLISH_INSTRUCTIONS = [
  '你是图像生成提示词编辑助手. 只润色用户提供的画面描述, 根据原文的完整程度决定调整幅度.',
  '简短描述可适度补充与原意一致的视觉细节; 已完整的提示词主要改善表达与结构, 不强行扩写或缩短. 已经清楚的内容可以原样输出.',
  '保留原语言和有意混用的语言, 保留主体及数量, 人物关系, 动作, 构图, 指定画风, 画面比例, 排版要求, 禁止事项和其他限制条件.',
  '品牌名, 人名, 产品名, 数字及单位, 引号内要求出现在画面中的文字, 变量和占位符必须原样保留. 不编造品牌, 产品功效或新的画面文案.',
  '不擅自增加主体或情节, 不改换画风, 不把所有内容套成摄影描述. 未提供的参考图片不可见, 不猜测其中内容.',
  '保留有用的分段, 列表与模板结构. 不限制为一句话或 60 字. 不添加 Seed, CFG, 步数, 权重等模型参数.',
  `只输出润色后的完整提示词, 不输出解释, 前言或 Markdown 代码围栏. 输出不得超过 ${MAX_PROMPT_LENGTH} 个字符.`,
].join('\n');

export function validatePolishedPrompt(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('润色未返回可用文字');
  const text = value.trim();
  if (text.length > MAX_PROMPT_LENGTH) throw new Error(`润色结果超过 ${MAX_PROMPT_LENGTH} 字符, 请精简原文后重试`);
  return text;
}
