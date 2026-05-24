export interface ImageStylePreset {
  id: string;
  name: string;
  englishName: string;
  description: string;
  group: string;
  prompt: string;
}

export const BASIC_STYLE_GROUPS = [
  '数字与游戏',
  '动漫与插画',
  '传统绘画',
  '版画与印刷',
  '现代视觉',
  '氛围与时代风格',
] as const;

export const BASIC_IMAGE_STYLES: ImageStylePreset[] = [
  { id: 'pixel-art', name: '像素艺术', englishName: 'Pixel Art', description: 'Retro game aesthetic', group: '数字与游戏', prompt: '像素艺术风格, 复古游戏美学, 清晰像素边缘, 有限色板, 低分辨率怀旧质感' },
  { id: '8-bit', name: '8位风', englishName: '8-Bit', description: 'Classic console vibes', group: '数字与游戏', prompt: '8位复古游戏风格, 经典主机视觉, 简化造型, 块状像素, 怀旧电子色彩' },
  { id: 'isometric', name: '等距视角', englishName: 'Isometric', description: '3D, angled perspective', group: '数字与游戏', prompt: '等距视角构图, 俯视三维空间, 结构清晰, 45度角透视, 模型化场景' },
  { id: 'low-poly', name: '低多边形', englishName: 'Low Poly', description: 'Geometric & minimal', group: '数字与游戏', prompt: '低多边形风格, 几何切面, 简洁块面, 低细节建模感, 现代极简视觉' },
  { id: 'voxel', name: '体素风', englishName: 'Voxel', description: '3D pixel blocks', group: '数字与游戏', prompt: '体素风格, 3D像素方块构成, 方块化角色和场景, 可爱游戏模型质感' },
  { id: 'lego-style', name: '乐高风', englishName: 'LEGO Style', description: 'Brick-built, playful', group: '数字与游戏', prompt: '乐高积木风格, 拼搭玩具质感, 塑料积木颗粒, 童趣明亮, brick-built playful design' },

  { id: 'anime', name: '动漫风', englishName: 'Anime', description: 'Clean lines, vibrant', group: '动漫与插画', prompt: '动漫插画风格, 干净线条, 鲜明色彩, 精致角色设计, 二次元视觉, 画面清爽' },
  { id: 'ghibli-style', name: '吉卜力风', englishName: 'Ghibli Style', description: 'Warm, hand-painted fantasy', group: '动漫与插画', prompt: '温暖手绘幻想动画风格, 柔和自然光, 细腻背景, 治愈氛围, 童话般的手绘质感' },
  { id: 'comic-book', name: '美漫风', englishName: 'Comic Book', description: 'Bold outlines, halftone', group: '动漫与插画', prompt: '美式漫画风格, 粗线条勾边, 强烈动态构图, 半调网点, 高对比色彩' },
  { id: 'cel-shading', name: '赛璐璐上色', englishName: 'Cel Shading', description: 'Flat shadow, toon render', group: '动漫与插画', prompt: '赛璐璐上色风格, 平涂阴影, toon render, 明确色块, 动画截图质感' },
  { id: 'claymation', name: '黏土/定格', englishName: 'Claymation', description: 'Handcrafted clay characters', group: '动漫与插画', prompt: '黏土定格动画风格, 手工塑形角色, 柔软黏土材质, 微小手作瑕疵, 温暖棚拍光' },
  { id: 'paper-cut', name: '剪纸风', englishName: 'Paper Cut', description: 'Layered paper, shadow depth', group: '动漫与插画', prompt: '剪纸风格, 多层纸张叠加, 纸纤维纹理, 柔和投影, 手工立体层次' },

  { id: 'watercolor', name: '水彩', englishName: 'Watercolor', description: 'Organic & expressive', group: '传统绘画', prompt: '水彩画风格, 透明颜料晕染, 自然水痕, 轻盈笔触, 纸张纹理, 有机表达' },
  { id: 'oil-painting', name: '油画', englishName: 'Oil Painting', description: 'Rich brush strokes', group: '传统绘画', prompt: '油画风格, 厚重颜料层次, 丰富笔触, 细腻明暗, 经典绘画质感' },
  { id: 'charcoal', name: '炭笔画', englishName: 'Charcoal', description: 'Raw & textured', group: '传统绘画', prompt: '炭笔素描风格, 粗粝黑白质感, 明暗强烈, 纸面颗粒, 原始手绘表现' },
  { id: 'pastel', name: '粉彩/色粉', englishName: 'Pastel', description: 'Soft & delicate', group: '传统绘画', prompt: '粉彩色粉风格, 柔软粉质笔触, 低饱和色彩, 细腻温柔, 轻盈梦幻' },
  { id: 'pencil-sketch', name: '铅笔素描', englishName: 'Pencil Sketch', description: 'Graphite, light & shadow', group: '传统绘画', prompt: '铅笔素描风格, 石墨线条, 细腻排线, 明暗层次, 手绘草图质感' },
  { id: 'gouache', name: '水粉画', englishName: 'Gouache', description: 'Opaque, matte painterly', group: '传统绘画', prompt: '水粉画风格, 不透明哑光颜料, 柔和块面, 绘本质感, 温润手绘色彩' },
  { id: 'chinese-ink-wash', name: '中国水墨', englishName: 'Chinese Ink Wash', description: 'Flowing ink, poetic空灵', group: '传统绘画', prompt: '中国水墨画风格, 墨色流动, 留白空灵, 诗意构图, 宣纸纹理, 东方意境' },

  { id: 'ink-drawing', name: '墨线画', englishName: 'Ink Drawing', description: 'Bold & expressive', group: '版画与印刷', prompt: '墨线画风格, 黑色墨水线条, 大胆勾勒, 表现力强, 简洁有力' },
  { id: 'etching', name: '蚀刻版画', englishName: 'Etching', description: 'Fine lines & texture', group: '版画与印刷', prompt: '蚀刻版画风格, 精细刻线, 复古纸张纹理, 细密交叉排线, 古典印刷质感' },
  { id: 'ukiyo-e', name: '浮世绘', englishName: 'Ukiyo-e', description: 'Traditional & timeless', group: '版画与印刷', prompt: '浮世绘风格, 日本传统木版画, 平面色块, 优雅线条, 复古装饰构图' },
  { id: 'graffiti', name: '涂鸦/街画', englishName: 'Graffiti', description: 'Street art, spray-paint feel', group: '版画与印刷', prompt: '街头涂鸦风格, 喷漆质感, 大胆字形和色块, 都市墙面艺术, 强烈个性' },
  { id: 'risograph', name: '孔版印刷', englishName: 'Risograph', description: 'Grainy, limited-color print', group: '版画与印刷', prompt: 'Risograph孔版印刷风格, 颗粒噪点, 限定色套印, 轻微错位, 独立杂志质感' },
  { id: 'woodcut', name: '木刻版画', englishName: 'Woodcut', description: 'Carved lines, high contrast', group: '版画与印刷', prompt: '木刻版画风格, 雕刻刀痕线条, 黑白高对比, 粗犷纹理, 传统印刷感' },

  { id: 'abstract', name: '抽象艺术', englishName: 'Abstract', description: 'Interpretive & bold', group: '现代视觉', prompt: '抽象艺术风格, 非具象表达, 大胆形状和色彩, 情绪化构图, 解释性视觉' },
  { id: 'minimal-line', name: '极简线条', englishName: 'Minimal Line', description: 'Clean & minimal', group: '现代视觉', prompt: '极简线条风格, 干净轮廓, 大量留白, 少量色彩, 现代简洁视觉' },
  { id: 'technical-cutaway', name: '技术剖面图', englishName: 'Technical Cutaway', description: 'Detailed & informative', group: '现代视觉', prompt: '技术剖面图风格, 结构拆解, 信息清晰, 精密标注感, 详细说明性视觉' },
  { id: '3d-render', name: '3D 渲染', englishName: '3D Render', description: 'Smooth CG, studio lighting', group: '现代视觉', prompt: '3D渲染风格, 光滑CG质感, 专业棚拍灯光, 精致材质, 高质量渲染' },
  { id: 'collage', name: '拼贴画', englishName: 'Collage', description: 'Mixed media, editorial', group: '现代视觉', prompt: '拼贴画风格, 混合媒介, 纸张剪贴, 编辑视觉, 多层素材组合' },
  { id: 'flat-design', name: '扁平设计', englishName: 'Flat Design', description: 'No shadow, vector-clean', group: '现代视觉', prompt: '扁平设计风格, 矢量干净, 无复杂阴影, 简明几何造型, 现代UI插画感' },
  { id: 'blueprint', name: '蓝图', englishName: 'Blueprint', description: 'Technical & precise', group: '现代视觉', prompt: '蓝图风格, 蓝底白线, 技术制图, 精准结构线, 工程图纸视觉' },
  { id: 'surrealism', name: '超现实主义', englishName: 'Surrealism', description: 'Dreamlike & irrational', group: '现代视觉', prompt: '超现实主义风格, 梦境般场景, 非理性组合, 奇幻想象, 象征性画面' },
  { id: 'glitch-art', name: '故障艺术', englishName: 'Glitch Art', description: 'Digital corruption aesthetic', group: '现代视觉', prompt: '故障艺术风格, 数字损坏效果, RGB错位, 扫描线, 数据噪声和电子干扰' },

  { id: 'neon-glow', name: '霓虹光效', englishName: 'Neon Glow', description: 'Electric & bold', group: '氛围与时代风格', prompt: '霓虹光效风格, 电光色彩, 强烈发光边缘, 深色背景, 未来夜景氛围' },
  { id: 'photoreal', name: '写实摄影', englishName: 'Photoreal', description: 'Realistic & detailed', group: '氛围与时代风格', prompt: '写实摄影风格, 真实光影, 细节丰富, 自然材质, 高真实感照片效果' },
  { id: 'cinematic', name: '电影感', englishName: 'Cinematic', description: 'Atmospheric & dramatic', group: '氛围与时代风格', prompt: '电影感风格, 戏剧化光影, 景深, 氛围色调, 叙事构图, cinematic lighting' },
  { id: 'synthwave', name: '合成波', englishName: 'Synthwave', description: 'Retro futurism', group: '氛围与时代风格', prompt: '合成波风格, 复古未来主义, 紫粉霓虹, 夕阳网格, 80年代电子氛围' },
  { id: 'steampunk', name: '蒸汽朋克', englishName: 'Steampunk', description: 'Vintage & intricate', group: '氛围与时代风格', prompt: '蒸汽朋克风格, 黄铜齿轮, 维多利亚复古机械, 复杂装置, 暖棕金属质感' },
  { id: 'cyberpunk', name: '赛博朋克', englishName: 'Cyberpunk', description: 'High tech & neon', group: '氛围与时代风格', prompt: '赛博朋克风格, 高科技低生活, 霓虹城市, 雨夜反光, 未来电子氛围' },
  { id: 'gold-foil', name: '金箔', englishName: 'Gold Foil', description: 'Luxurious & refined', group: '氛围与时代风格', prompt: '金箔装饰风格, 奢华金属光泽, 精致纹理, 高级质感, refined luxury' },
  { id: 'holographic', name: '全息', englishName: 'Holographic', description: 'Shimmer & shine', group: '氛围与时代风格', prompt: '全息风格, 彩虹镭射反光, 未来闪耀质感, 透明渐变, shimmer and shine' },
  { id: 'pop-art', name: '波普艺术', englishName: 'Pop Art', description: 'Bold colors, halftone dots', group: '氛围与时代风格', prompt: '波普艺术风格, 高饱和色彩, 半调圆点, 漫画化构图, 大胆平面视觉' },
  { id: 'impressionism', name: '印象派', englishName: 'Impressionism', description: 'Light & color, visible strokes', group: '氛围与时代风格', prompt: '印象派风格, 捕捉光与色彩, 可见短笔触, 柔和空气感, 明亮自然氛围' },
  { id: 'art-deco', name: '装饰艺术', englishName: 'Art Deco', description: 'Geometric elegance, 1920s', group: '氛围与时代风格', prompt: '装饰艺术风格, 1920年代几何优雅, 对称构图, 金色线条, 豪华复古' },
  { id: 'art-nouveau', name: '新艺术运动', englishName: 'Art Nouveau', description: 'Organic curves, floral motifs', group: '氛围与时代风格', prompt: '新艺术运动风格, 有机曲线, 花卉藤蔓装饰, 优雅女性化线条, 华丽自然图案' },
  { id: 'vaporwave', name: '蒸汽波', englishName: 'Vaporwave', description: 'Retro 80s/90s, pastel neons', group: '氛围与时代风格', prompt: '蒸汽波风格, 80/90年代复古, 粉紫霓虹, 复古电脑美学, 梦幻电子氛围' },
  { id: 'stained-glass', name: '彩色玻璃', englishName: 'Stained Glass', description: 'Leaded outlines, luminous', group: '氛围与时代风格', prompt: '彩色玻璃风格, 铅条分割轮廓, 透明彩色玻璃片, 发光宗教窗花质感' },
  { id: 'film-noir', name: '黑色电影', englishName: 'Film Noir', description: 'High contrast B&W, moody', group: '氛围与时代风格', prompt: '黑色电影风格, 高对比黑白影调, 阴影强烈, 悬疑氛围, moody cinematic scene' },
  { id: 'double-exposure', name: '双重曝光', englishName: 'Double Exposure', description: 'Overlaid images, ghostly', group: '氛围与时代风格', prompt: '双重曝光风格, 两层图像叠加, 半透明轮廓, 梦幻重影, ghostly overlaid images' },
];

export function findBasicImageStyle(styleId: string) {
  return BASIC_IMAGE_STYLES.find((style) => style.id === styleId) || null;
}

export function applyImageStyleToPrompt(prompt: string, style: ImageStylePreset | null) {
  const cleanPrompt = prompt.trim();
  if (!style) return cleanPrompt;
  return `${cleanPrompt}\n风格要求: ${style.name} (${style.englishName}), ${style.prompt}.`;
}

export interface AdvancedImageStylePreset {
  id: string;
  type: 'advanced';
  name: string;
  englishName: string;
  description: string;
  usage: string;
  exampleImage?: string;
  exampleAlt?: string;
  template: string;
}

export type BasicImageStylePreset = ImageStylePreset & { type?: 'basic' };
export type AnyImageStylePreset = BasicImageStylePreset | AdvancedImageStylePreset;

export const ADVANCED_IMAGE_STYLES: AdvancedImageStylePreset[] = [
  {
    id: 'atlas-breakdown',
    type: 'advanced',
    name: '图鉴式拆解',
    englishName: 'Atlas Breakdown',
    description: '根据主题生成中文拆解信息图, 包含结构标注, 材质工艺, 纹样寓意和核心总结',
    usage: '只需输入主题, 如: 明代马面裙, 宋代汝窑瓷器, 未来机甲少女',
    exampleImage: '/assets/style-examples/atlas-breakdown.svg',
    exampleAlt: '图鉴式拆解高级风格示例图',
    template: `请根据{主题}自动生成一张“博物馆图鉴式中文拆解信息图”。

要求整张图兼具真实写实主视觉、结构拆解、中文标注、材质说明、纹样寓意、色彩含义和核心特征总结。你需要根据主题自动判断最合适的主体对象、服饰体系、器物结构、时代风格、关键部件、材质工艺、颜色方案与版式结构，用户无需再提供其他信息。

整体风格应为：国家博物馆展板、历史服饰图鉴、文博专题信息图，而不是普通海报、古风写真、电商详情页或动漫插画。背景采用米白、绢纸白、浅茶色等纸张质感，整体高级、克制、专业、可收藏。

版式固定为：
- 顶部：中文主标题 + 副标题 + 导语
- 左侧：结构拆解区，中文引线标注关键部件，并配局部特写
- 右上：材质 / 工艺 / 质感区，展示真实纹理小样并附说明
- 右中：纹样 / 色彩 / 寓意区，展示主色板、纹样样本和文化解释
- 底部：穿着顺序 / 构成流程图 + 核心特征总结

若主题适合人物展示，则以真实人物全身站姿为中央主体；若更适合器物或单体结构，则改为中心主体拆解图，但整体仍保持完整中文信息图形式。所有文字必须为简体中文，清晰、规整、可读，不要乱码、错字、英文或拼音。重点突出真实结构、材质差异、文化说明与图鉴气质。

避免：海报感、影楼感、电商感、动漫感、cosplay感、乱标注、错结构、糊字、假材质、过度装饰。`,
  },
];

export function findAdvancedImageStyle(styleId: string) {
  return ADVANCED_IMAGE_STYLES.find((style) => style.id === styleId) || null;
}

export function findImageStyle(styleId: string): AnyImageStylePreset | null {
  return findBasicImageStyle(styleId) || findAdvancedImageStyle(styleId);
}

export function applyAnyImageStyleToPrompt(prompt: string, style: AnyImageStylePreset | null) {
  const cleanPrompt = prompt.trim();
  if (!style) return cleanPrompt;
  if (style.type === 'advanced') return style.template.replaceAll('{主题}', cleanPrompt);
  return applyImageStyleToPrompt(cleanPrompt, style);
}
