// Fixed planning instructions for one series type. The series endpoint selects one;
// these files are not Cursor skills and are not chosen by the browser.

export const SERIES_SKILL_IDS = ['product', 'storyboard', 'illustration', 'photo', 'open'];

const SHARED_SHAPE = `每条 prompt 写成大约 120 到 220 字的完整画面, 包含主体外观或商品事实, 这一镜的动作或展示重点, 场景, 景别和光线. 前半段重复必须稳住的事实, 后半段只写这一镜不同的地方. 不用“同上”. 只写一张静态画面, 不写视频, 不写拼版, 不把规划说明抄进 prompt.`;

const PRODUCT_SHAPE = `每条 prompt 大约 140 到 260 字, 只写一张静态详情模块, 不写视频, 不拼版, 不把规划说明抄进 prompt.
开头只留一句短的商品身份, 写名称和必须稳住的外观, 这句可以各镜相同. 不要把用户这次给出的参数整段抄到每一镜开头.
后面只写这一镜: 商品怎么放, 画面标题写什么, 标注写什么, 标注指向哪里. 标题和标注是画面上能看见的字, 用用户已经给出的事实写成短句. 每一镜的标题和标注都要不同.`;

const NO_REFERENCE_RULE = `这次没有参考图. 不要写“与图 1 相同”, 也不要编造图号. 原文没写明的外观选定一次, 之后每镜沿用同一套说法. 用户点名了作品或角色但没写外观时, 使用能认出该作品或角色的外观, 不要另编一套人设. 用户没给出的数字, 比例和价格不要写成画面标注.`;

export const SERIES_SKILLS = {
  product: {
    id: 'product',
    label: '商品图',
    when: '详情页, 主图, 卖点组图, 试穿或使用展示.',
    whenNot: '有明确时间顺序的故事, 电影分镜, 绘本.',
    constraints: `按国内电商详情页规划, 不要做成没有文字的白底主图. 每镜是一个详情模块: 商品在画面里, 同时有这一镜自己的标题, 以及指向对应部位的标注. 标注只来自用户这次写出的事实, 每条事实放在相关的那一镜上. 商品没有的项目不要补一镜, 也不要套用固定栏目. 不要写“不出现文字”或“不添加文字”.
只有用户明确要求无文字主图或白底图时, 才不放标注.
不编造用户没写的价格, 销量, 功效和口号. 标注可以缩短用户的原话, 不能换成另一套卖点.
外观各镜一致. 模块跟着这次的事实走, 可以是整体, 某一处结构, 某一项功能或使用方式. 不要每件商品都排成同样的四格, 也不要四镜都只是同一件商品换个角度.
反例: 每镜开头都写“350ml, 白瓷, 竹盖, 食品级, 画面不出现文字”. 正例: 开头只写“白色陶瓷杯, 杯身和杯盖各镜一致”; 容量镜的画面标题是“350ml”, 标注指向杯身; 杯盖镜只标杯盖, 不再重复容量. 有参考图时按图号写外观, 没有参考图时不要写图号.`,
    promptShape: PRODUCT_SHAPE,
    textPolicy: 'labels',
    banInventedSlogan: false,
  },
  storyboard: {
    id: 'storyboard',
    label: '叙事分镜',
    when: '电影分镜, 广告分镜, 按时间推进的故事板.',
    whenNot: '商品卖点图, 没有情节的静物组图.',
    constraints: `人物外观和服装在每一镜用同一套说法. 各镜按时间写不同的动作, 机位和情绪, 保持场景关系. 不改成商品棚拍, 不编造画面文字.`,
    banInventedSlogan: false,
  },
  illustration: {
    id: 'illustration',
    label: '插画',
    when: '绘本, 插画连作, 故事插图.',
    whenNot: '实拍商品图, 电影机位清单.',
    constraints: `画风和角色外观在每一镜用同一套说法. 各镜按故事节拍变化. 用户没有给出要印出的原句时, 画面不出现文字.`,
    banInventedSlogan: false,
  },
  photo: {
    id: 'photo',
    label: '照片组',
    when: '旅行, 纪实, 同一人物或同一地点的一组照片.',
    whenNot: '绘本插画, 商品详情页.',
    constraints: `人物外观, 服装和摄影气质在每一镜用同一套说法. 各镜用地点, 时间和光线分开. 不改成插画, 不编造海报文字.`,
    banInventedSlogan: true,
  },
  open: {
    id: 'open',
    label: '按原文',
    when: '用途不明确, 或同时包含多种目的.',
    whenNot: '',
    constraints: `只稳住用户原文已经写明的外观, 画风和限制. 各镜按用户列出的不同画面来写. 不追加用户没写的营销目的或故事结局. 只有用户给出的原句才写入画面.`,
    banInventedSlogan: true,
  },
};

export function skillForType(type) {
  return SERIES_SKILLS[type] || SERIES_SKILLS.open;
}

export function mentionsReference(content) {
  return /参考图|图\s*[1-4１-４]/.test(String(content || ''));
}

export function classifySeriesInstruction() {
  const guide = SERIES_SKILL_IDS.map((id) => `${id}: ${SERIES_SKILLS[id].when}${SERIES_SKILLS[id].whenNot ? ` 不用于${SERIES_SKILLS[id].whenNot}` : ''}`).join('\n');
  return `你只判断系列创作需求属于哪一种规划方式. 只输出一个标识: product, storyboard, illustration, photo, open. 不写画面, 不解释.
${guide}
无法判断时输出 open.`;
}

export function parseSeriesType(text) {
  const match = String(text || '').toLowerCase().match(/\b(product|storyboard|illustration|photo|open)\b/);
  return match ? match[1] : 'open';
}

export function referenceInstruction(referenceCount, content = '') {
  const mentioned = mentionsReference(content);
  if (!Number.isInteger(referenceCount)) return mentioned
    ? '正文提到了参考图, 但这次没有收到张数. 按用户写下的图号和用途保留, 不要把所有图都收成图 1, 也不要臆测没写用途的图里有什么. 规划看不到图片.'
    : NO_REFERENCE_RULE;
  if (referenceCount === 0) return mentioned
    ? '这次没有上传参考图. 正文里的图号只是说明, 不要写“与图 1 相同”. 外观按用户写下的事实; 没写的外观选定一次, 之后每镜沿用同一套说法.'
    : NO_REFERENCE_RULE;
  if (referenceCount === 1) return '这次有 1 张参考图, 对应图 1, 但规划看不到图片. 需要跨镜认出的颜色, 款式, 材质和身份写“与图 1 相同”, 不要猜具体颜色或版型.';
  return `这次有 ${referenceCount} 张参考图, 按上传顺序对应图 1 到图 ${referenceCount}, 但规划看不到图片. 用户写明了某张图的用途就保留该图号和用途, 不要把所有图都收成图 1, 也不要交换编号. 用户没写用途的图, 不要臆测里面是什么. 需要稳住、且用户没指定图号的外观, 写“与用户参考图一致”.`;
}

export function seriesShotInstruction(count, skill, referenceCount = 0, content = '') {
  return `你是系列静态图片的视觉策划师. 规划方式: ${skill.label}.
${skill.constraints}
${referenceInstruction(referenceCount, content)}
${skill.promptShape || SHARED_SHAPE}
输出恰好 ${count} 项. 每项 title 不超过 80 字, prompt 非空. 原文多于 ${count} 段时按顺序合并相邻段落, 不丢掉结尾; 少于 ${count} 段时拆成能区分的画面.
只输出 JSON 数组, 恰好 ${count} 项, 每项只有 title 和 prompt. 不输出解释.`;
}

export function seriesRewriteInstruction(count) {
  return `只修改有问题的分镜, 保留没有问题的分镜. 仍输出恰好 ${count} 项的 JSON 数组, 每项只有 title 和 prompt. 不输出解释.`;
}

const INSTRUCTION_LEAK = /只输出 JSON|输出恰好|大约 \d+ 到 \d+|规划方式:|不要把规划说明抄进/;
const PRODUCT_TEXT_BAN = /不出现\S{0,8}文字|不添加\S{0,16}文字|无额外文字|禁止(出现)?文字/;

function repeatedDetailClauses(plan) {
  const lists = plan.map((item) => item.prompt.split(/[，。；\n]/).map((part) => part.replace(/\s+/g, '').trim()).filter((part) => part.length >= 16));
  const counts = new Map();
  for (const list of lists) for (const clause of new Set(list)) counts.set(clause, (counts.get(clause) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count === plan.length && plan.length > 1).map(([clause]) => clause);
}

const CITED_FIGURE = /与图\s*[1-4１-４]|图\s*[1-4１-４]\s*相同/;

export function reviewSeriesPlan(plan, skill = SERIES_SKILLS.open, referenceCount) {
  const issues = [];
  const seen = new Map();
  const repeated = skill.textPolicy === 'labels' ? repeatedDetailClauses(plan) : [];
  plan.forEach((item, index) => {
    const prompt = item.prompt.replace(/\s+/g, ' ').trim();
    if (INSTRUCTION_LEAK.test(item.prompt)) issues.push({ index, reason: '把规划说明抄进了画面提示词' });
    if (referenceCount === 0 && CITED_FIGURE.test(item.prompt)) issues.push({ index, reason: '这次没有参考图, 不要写与图几相同' });
    if (skill.textPolicy === 'labels' && PRODUCT_TEXT_BAN.test(item.prompt)) issues.push({ index, reason: '详情页禁止了画面文字, 参数应写成这一镜的标注' });
    if (skill.textPolicy === 'labels' && repeated.length >= 2) issues.push({ index, reason: `商品参数整段重复 (${repeated.slice(0, 2).join(' / ')}), 应改成这一镜自己的画面标注` });
    if (skill.banInventedSlogan && /加入文字|卖点文字区域|广告语[:：]/.test(item.prompt)) issues.push({ index, reason: '编造了画面广告' });
    if (skill.textPolicy === 'labels' && /广告语[:：]/.test(item.prompt)) issues.push({ index, reason: '编造了广告语, 标注只能使用用户给出的事实' });
    if (seen.has(prompt)) issues.push({ index, reason: `与第 ${seen.get(prompt) + 1} 镜完全相同` });
    else seen.set(prompt, index);
  });
  return issues;
}
