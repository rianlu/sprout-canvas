export const SERIES_PRESETS = [
  { id: 'picture-book', label: '绘本连环画', tip: '按起承转合拆成独立故事画面', rule: '按故事的开端, 发展, 转折, 结尾规划场景. 使用适合绘本的叙事, 保持主角外貌和服装一致, 每幕描绘一个明确动作.' },
  { id: 'ecommerce', label: '电商长图', tip: '首屏, 卖点, 细节和使用场景', rule: '按商品首屏, 核心卖点, 材质细节, 使用场景和结尾陈列规划独立图片. 保持同一商品的形状, 包装, 标志和配色, 不编造价格, 销量或功效.' },
  { id: 'video-board', label: '视频分镜', tip: '只生成静态镜头画面', rule: '规划静态影视分镜, 为每幕明确景别, 机位, 镜头运动意图和画面动作. 保持空间轴线和角色服饰连贯. 只描述静态图片, 不请求生成视频.' },
  { id: 'brand-ip', label: '品牌 IP 延展', tip: '基础形象, 表情, 动作和应用', rule: '按角色基础形象, 表情, 动作, 场景应用规划独立品牌角色图片. 明确同一套外貌特征, 身体比例, 服装和品牌色. 每一项单独一张, 不合并为九宫格.' },
];

export function buildSeriesSplitPrompt(template, count) {
  const preset = SERIES_PRESETS.find((item) => item.id === template);
  if (!preset || !Number.isInteger(count) || count < 3 || count > 8) throw new Error('系列模板或幕数无效');
  return `你是中文视觉策划师. ${preset.rule}\n从用户的故事梗概或分段分镜剧本中提取角色或商品的关键特征, 在每幕中保留对应特征并保持一致.\n只输出 JSON 数组, 恰好 ${count} 项, 每项只有 title 和 prompt 字符串. prompt 必须是可独立生成的一幕画面, 长度 60 到 300 字. 不使用 Markdown, 不输出解释.`;
}

export function parseSeriesPlan(text, count) {
  const value = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(value) || value.length !== count || value.some((item) => !item || typeof item.title !== 'string' || typeof item.prompt !== 'string' || !item.title.trim() || !item.prompt.trim() || item.prompt.length > 5000)) throw new Error(`拆解结果需要 ${count} 幕完整分镜, 请重试`);
  return value.map((item) => ({ title: item.title.trim().slice(0, 80), prompt: item.prompt.trim() }));
}

export function scenePrompt({ brief, prompt, index, count }) {
  return `系列主题: ${brief}\n根据故事梗概或分镜剧本保持角色或商品的关键特征, 有首镜参考时延续其主体外观与画风.\n当前第 ${index + 1}/${count} 幕: ${prompt}\n参考图仅用于维持主体和视觉风格, 场景动作以当前幕为准. 本次只生成当前幕的一张独立画面, 不生成拼版或多个分格.`;
}
