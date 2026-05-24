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
  group: string;
  requiresReference?: boolean;
  exampleImage?: string;
  exampleAlt?: string;
  template: string;
}

export type BasicImageStylePreset = ImageStylePreset & { type?: 'basic' };
export type AnyImageStylePreset = BasicImageStylePreset | AdvancedImageStylePreset;

export const ADVANCED_STYLE_GROUPS = [
  '品牌广告',
  '人像改造',
  '电商营销',
  '餐饮食品',
  '图标素材',
  '角色 IP',
  '图鉴拆解',
  '文旅地图',
] as const;

export const ADVANCED_IMAGE_STYLES: AdvancedImageStylePreset[] = [
  {
    id: 'luxury-black-gold-ad',
    type: 'advanced',
    name: '奢侈品黑金广告',
    englishName: 'Luxury Black Gold Ad',
    description: '黑金电影感奢侈品广告, 适合香水, 美妆, 珠宝, 酒类和高端礼盒',
    usage: '输入品牌和产品, 如: CHANEL N°5 香水, 东方木质香调',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/luxury-perfume-ad.jpg',
    exampleAlt: '奢侈品黑金广告高级风格示例图',
    template: `A luxurious cinematic product photograph for {主题}. Create a classic high-end commercial campaign visual with a clear hero product, premium glass, metal, liquid, leather, gemstone or polished packaging materials as appropriate. Place the product upright on a glossy black marble surface with white veining. Use dramatic warm lighting from the upper left, golden highlights, deep reflections, soft luminous bloom, elegant smoke wisps, dark refined background, shallow depth of field, ultra-detailed studio product photography, luxury campaign aesthetic, crisp focus, realistic reflections, warm black-and-gold color palette. If a brand name or label is included in the user input, place it cleanly on the product label and keep it readable. Square composition, premium commercial ad, photorealistic, high contrast, refined and sophisticated.`,
  },
  {
    id: 'integrated-brand-poster',
    type: 'advanced',
    name: '2D+3D 品牌整合海报',
    englishName: 'Integrated Brand Poster',
    description: '2D 图形和 3D 摄影融合, 主体穿插几何面板, 适合品牌主视觉和活动海报',
    usage: '输入品牌, 标题, 副标题和 CTA, 如: DJI | Capture the Air | 新品发布 | 立即探索',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/integrated-brand-poster.webp',
    exampleAlt: '2D+3D 品牌整合海报高级风格示例图',
    template: `{主题}. Act as a Senior Art Director. PHASE 1: INTEGRATED COMPOSITION & OVERLAP. Layout: Seamless fusion of 2D graphics and 3D photography. Overlap Logic: The subject and their primary Product Prop must physically overlap the graphic panel to break the wall between design and photo. Unity: Geometric shapes from the graphic side must bleed into the photographic sky or background area. PHASE 2: BRAND & CATEGORY SIMULATION. Autonomously analyze the brand and industry category from {主题}. If Automotive: Include the vehicle and a person interacting with it. If Tech: Include flagship devices or gadgets. If Fashion/Lifestyle: Focus on editorial poses and premium accessories. Match shapes to brand identity. Use the brand color palette with tasteful commercial polish. PHASE 3: FINAL OUTPUT. Premium 4:5 campaign poster, strong hierarchy, readable headline area, high-end art direction, modern advertising composition, realistic lighting, deep but clean layout, no random text or broken typography.`,
  },
  {
    id: 'brand-editorial-grid',
    type: 'advanced',
    name: '品牌编辑网格海报',
    englishName: 'Brand Editorial Grid',
    description: '2x2 网格, 几何叠层, 品牌色弱化处理, 适合汽车, 运动, 科技和生活方式品牌',
    usage: '输入品牌或项目, 如: Porsche Taycan, muted editorial campaign',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/brand-editorial-grid.webp',
    exampleAlt: '品牌编辑网格海报高级风格示例图',
    template: `{主题}. Act as a World-Class Editorial Designer. PHASE 1: DYNAMIC SUBJECT LOGIC. Autonomously analyze the brand or subject from {主题}. Interweave the main subject with background shapes. Some parts of the car, person, product or prop must be hidden behind geometric blocks, while other parts overlap them to create 3D depth. PHASE 2: GRID & GEOMETRY. Create a clean 2x2 grid composition. Superimpose large bold geometric arcs and circles over the grid. Place one iconic product prop in a separate quadrant to balance the subject. PHASE 3: SOPHISTICATED MUTED PALETTE. Identify core colors and shift them to a sophisticated muted spectrum. Use desaturated, editorial tones instead of aggressive neon. Final image: premium magazine-grade brand poster, layered depth, precise composition, modern typographic restraint, no messy text.`,
  },
  {
    id: 'streetwear-editorial',
    type: 'advanced',
    name: '街头潮牌杂志海报',
    englishName: 'Streetwear Editorial',
    description: '90 年代街头杂志排版, 接触表摄影, 粉笔大字, 适合潮牌, 音乐和运动品牌',
    usage: '输入品牌名或主题, 如: Supreme 风格滑板潮牌海报',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/streetwear-editorial.webp',
    exampleAlt: '街头潮牌杂志海报高级风格示例图',
    template: `Act as a Streetwear Editorial Designer and Art Director creating a vertical brand poster for {主题} in the style of a 1990s streetwear magazine spread — a single hero image combining contact sheet photography, oversized chalky brand typography, and vertical text elements. References: Supreme editorial posters, streetwear zine design, 90s hip-hop magazine layouts, Futura Bold typographic tradition. Perform a complete brand decode from the user subject before generating. Use a warm off-white matte paper background, real brand color logic, contact sheet photo borders, oversized chalky wordmark color, box-logo style element, vertical text accents, gritty magazine texture, editorial photography, cultural attitude, premium streetwear art direction. Keep all visible text short and readable.`,
  },
  {
    id: 'brand-cloud-logo',
    type: 'advanced',
    name: '品牌云朵 Logo',
    englishName: 'Brand Cloud Logo',
    description: '把品牌 Logo 或图形做成真实云朵, 极简, 高级, 适合社媒传播图',
    usage: '输入品牌名或 Logo 描述, 如: Apple logo, Nike swoosh, 芽绘台叶芽图标',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/brand-cloud-logo.webp',
    exampleAlt: '品牌云朵 Logo 高级风格示例图',
    template: `{主题}: The name or symbol of the brand. Goal: Generate a single minimalist surreal image where a massive photorealistic cumulus cloud forms the exact geometric shape of the brand logo or symbol described in {主题}. The cloud must be puffy, soft, voluminous, naturally sunlit, and clearly recognizable as the logo shape. Place it in a clean blue sky with subtle atmospheric depth. Keep composition centered, premium, calm and iconic. No extra objects, no clutter, no random text. The result should feel like a poetic brand campaign poster, simple enough for social media and outdoor advertising.`,
  },
  {
    id: 'brand-logo-sculpture',
    type: 'advanced',
    name: '3D Logo 雕塑',
    englishName: '3D Logo Sculpture',
    description: '官方 Logo 变成大型实体雕塑, 适合品牌视觉, 发布会 KV 和社媒主图',
    usage: '输入品牌或图形, 如: Tesla logo chrome sculpture, 芽绘台芽形标志',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/brand-logo-sculpture.webp',
    exampleAlt: '3D Logo 雕塑高级风格示例图',
    template: `Act as a High-End Product Photographer and CGI Artist. Generate a massive, perfectly centered, three-dimensional physical sculpture of the official logo, symbol or brand mark described in {主题}. The sculpture must strictly adhere to the brand shape or user description. Use premium CGI realism, carefully chosen material based on the subject, such as polished chrome, translucent glass, matte ceramic, brushed metal, acrylic, marble or lacquer. Place it in a clean studio environment with controlled lighting, soft shadows, realistic reflections, luxury product photography finish, strong silhouette, centered composition and no clutter. Keep any text minimal and readable only if requested.`,
  },
  {
    id: 'metal-logo-relief',
    type: 'advanced',
    name: '金属 Logo 浮雕',
    englishName: 'Metal Logo Relief',
    description: 'Logo 像从金属或哑光表面背后顶出来, 适合高级品牌资产图',
    usage: '输入品牌和材质, 如: 芽绘台 + 香槟金金属, Apple + matte black',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/metal-logo-relief.webp',
    exampleAlt: '金属 Logo 浮雕高级风格示例图',
    template: `{主题}. Act as a Senior CGI Artist and Brand Identity Director specializing in premium logo materializations. Create a logo mark that appears to have been pushed outward from behind a metallic or matte surface, like a relief sculpture emerging under tension. Use the brand name or symbol from {主题}. The surface should show realistic material response: brushed metal, champagne gold, matte black, satin silver, ceramic, leather, or another material requested by the user. Add soft directional lighting, micro scratches, beveled edges, subtle shadows around the raised shape, premium close-up composition, strong tactile realism, no extra decoration, no random text.`,
  },
  {
    id: 'y2k-3d-typography',
    type: 'advanced',
    name: 'Y2K 立体字海报',
    englishName: 'Y2K 3D Typography',
    description: '街头潮流, Y2K, 高级数字雕塑感的 3D 品牌字形海报',
    usage: '输入品牌和颜色, 如: 芽绘台 | 珊瑚橙, POP MART | 粉蓝',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/y2k-3d-typography.webp',
    exampleAlt: 'Y2K 立体字海报高级风格示例图',
    template: `{主题}. Act as a 3D Type Designer and CGI Artist working at the intersection of streetwear culture, Y2K aesthetics, and high-end digital sculpture. References: Nigo, Futura, Guccimaze, Soulwax art direction. Create a typographic concept where the brand name or main word from {主题} becomes a sculptural 3D object. Use glossy inflated letterforms, chrome, translucent acrylic, candy plastic, metallic edges, stickers, badges, small graphic ornaments, high-end studio lighting, tactile reflections, strong shadows, clean editorial composition, playful streetwear energy, premium digital sculpture finish. Keep text short and readable, no random extra words.`,
  },
  {
    id: 'fmcg-commercial-poster',
    type: 'advanced',
    name: '快消品商业广告',
    englishName: 'FMCG Commercial Poster',
    description: '真实快消品广告, 人物场景, 包装主视觉, 卖点叙事和高信任商业质感',
    usage: '输入产品和场景, 如: Tide 洗衣液, 印度家庭洗衣房, 去渍卖点',
    group: '品牌广告',
    exampleImage: '/assets/style-examples/fmcg-commercial-poster.webp',
    exampleAlt: '快消品商业广告高级风格示例图',
    template: `FORMAT: 4:5 vertical premium FMCG SMM poster, hyper-realistic commercial advertising, Instagram + billboard hybrid composition, 8K ultra-detail. CONCEPT: {主题}. Build an authentic FMCG identity with strong package presence, clean trustworthy household or lifestyle advertising aesthetic, performance-focused storytelling and emotional clarity. SCENE: premium realistic environment matching the product category, warm natural or studio lighting, believable human interaction if relevant, subtle before-and-after or benefit transformation integrated naturally. COMPOSITION: large product pack hero placement in foreground, dynamic circular or diagonal composition inspired by brand geometry, negative space for headline, layered commercial depth, clear visual hierarchy. PRODUCT: ultra-realistic packaging, slightly angled toward camera, water splash, glow, particles, fabric, food, bubbles or category-specific effects as needed.`,
  },
  {
    id: 'portrait-consistency',
    type: 'advanced',
    name: '人像一致性写真',
    englishName: 'Portrait Consistency',
    description: '基于参考图保留人物身份, 换场景, 光线, 服装和写真氛围',
    usage: '上传人像参考图后输入场景, 如: 韩式教室窗边写真, 雨夜街头写真',
    group: '人像改造',
    requiresReference: true,
    exampleImage: '/assets/style-examples/portrait-consistency.jpg',
    exampleAlt: '人像一致性写真高级风格示例图',
    template: `Use the uploaded reference image as the exact facial identity reference. Maintain the same facial structure, eyes, nose, lips, hairstyle, skin tone, beauty details, and overall appearance consistency throughout the image. Create an ultra-realistic portrait based on this request: {主题}. Preserve identity while changing only the scene, outfit, lighting, pose, and mood required by the user input. Use cinematic natural light, believable skin texture, realistic hair detail, shallow depth of field, refined color grading, and editorial portrait composition. The final image should look like a professional photoshoot of the same person, not a different person.`,
  },
  {
    id: 'travel-selfie',
    type: 'advanced',
    name: '旅行自拍大片',
    englishName: 'Travel Selfie',
    description: '把参考人像变成旅行社媒自拍, 保持身份, 强化地点氛围和动态广角',
    usage: '上传自拍后输入地点, 如: 阿尔卑斯草甸, 东京街头, 海边日落',
    group: '人像改造',
    requiresReference: true,
    exampleImage: '/assets/style-examples/travel-selfie.jpg',
    exampleAlt: '旅行自拍大片高级风格示例图',
    template: `Asset type: portrait image for social post. Create a photorealistic travel selfie portrait based on {主题}, using the uploaded portrait photo as the appearance reference for the person. Preserve recognizable facial structure, eyes, hairline direction, skin texture, and natural temperament from the reference photo. Build a vivid destination backdrop that matches the user input, with lively daylight, environmental depth, believable travel clothing, and social-media adventure energy. Use ultra-realistic mobile travel photography, dynamic action-camera feel, crisp but natural detail, vertical framing, wide-angle perspective, and an authentic handheld selfie mood.`,
  },
  {
    id: 'phone-style-portrait',
    type: 'advanced',
    name: '手机真实随拍',
    englishName: 'Phone-Style Portrait',
    description: '接近真实手机照片的人像改造, 保留脸和自然生活感, 避免影楼味',
    usage: '上传人像后输入状态, 如: 咖啡店随拍, 电梯镜自拍, 夜晚路边回头',
    group: '人像改造',
    requiresReference: true,
    exampleImage: '/assets/style-examples/phone-style-portrait.jpg',
    exampleAlt: '手机真实随拍高级风格示例图',
    template: `Ultra-realistic, almost indistinguishable-from-real casual phone photo portrait. Use the uploaded image as the identity reference and fully preserve the natural appearance and atmosphere of the same person. The face and overall appearance must remain identical to the reference image without changing facial proportions or recognizable features. Create the requested scene: {主题}. Use natural phone camera perspective, imperfect but pleasing everyday framing, realistic ambient light, authentic skin texture, slight lens softness, believable background details, and no over-polished studio feeling. The result should look like a real candid photo captured on a modern phone.`,
  },
  {
    id: 'designer-toy-portrait',
    type: 'advanced',
    name: '潮玩公仔人像',
    englishName: 'Designer-Toy Portrait',
    description: '把参考人像转成 3D 设计师潮玩, 适合头像, 盲盒, IP 周边',
    usage: '上传人像后输入设定, 如: 透明猫眼镜, 街头徽章, 黑色短夹克',
    group: '人像改造',
    requiresReference: true,
    exampleImage: '/assets/style-examples/designer-toy-portrait.jpg',
    exampleAlt: '潮玩公仔人像高级风格示例图',
    template: `Stylized 3D designer-toy portrait based on {主题}. Use the uploaded reference image to maintain the exact face, hairstyle, facial proportions, and recognizable identity of the person. Create a centered symmetrical close-up or half-body collectible toy composition with polished vinyl or resin material, enlarged but tasteful head proportions, expressive eyes, stylized fashion accessories, streetwear-inspired details, and premium collectible packaging energy. Use soft studio lighting, clean background, tactile material realism, high-end blind-box toy aesthetic, and a playful but refined character design.`,
  },
  {
    id: 'sports-tribute-poster',
    type: 'advanced',
    name: '人物致敬海报',
    englishName: 'Sports Tribute Poster',
    description: '人物黑白剪影 + 生涯照片网格 + 混合媒介纹理, 适合球星, 名人和 IP 人物',
    usage: '输入人物和主题, 如: Lionel Messi 生涯致敬海报, 科比精神主题',
    group: '人像改造',
    exampleImage: '/assets/style-examples/sports-tribute-poster.webp',
    exampleAlt: '人物致敬海报高级风格示例图',
    template: `{主题}. Act as a high-end sports graphic designer creating a conceptual tribute poster. The style is a complex dual exposure photo-grid composite with mixed-media textures. CENTRAL STRUCTURE: The central focus is a large-scale high-contrast black and white portrait silhouette of the person or character in {主题}. This main portrait acts as the container. GRID FILL & TEXTURES: The interior silhouette is populated by a dense photo mosaic grid of action shots, career moments, iconic poses or symbolic scenes. Apply tactile collage textures: halftone dots, fabric or embroidery texture, film grain, paper grain, ink scratches, jersey patch feeling. COLOR STRATEGY: Use one dominant accent color associated with the person, team, brand or story. Premium sports editorial composition, dramatic hierarchy, readable short title, no random text.`,
  },
  {
    id: 'premium-product-studio',
    type: 'advanced',
    name: '高级产品棚拍',
    englishName: 'Premium Product Studio',
    description: '干净高端科技棚拍, 适合耳机, 香水, 手表, 美妆, 数码和包装产品',
    usage: '输入产品和品牌参考, 如: 无线耳机, Apple 式极简, 冰蓝色轮廓光',
    group: '电商营销',
    exampleImage: '/assets/style-examples/premium-product-studio.jpg',
    exampleAlt: '高级产品棚拍高级风格示例图',
    template: `Create a premium product studio image for {主题}. Show the product floating against a clean light gray to soft white gradient background with a minimal high-end tech aesthetic. The product should feel sleek, modern, refined, and premium, with subtle illuminated accents that match the user input. Use a three-quarter front angle when appropriate, showing detailed industrial design elements and material realism. Include the brand name cleanly on the product only if the user provides one. Lighting should be soft, controlled, and editorial, with crisp highlights, soft shadows, and a subtle colored rim light or glow. Keep the background uncluttered and minimal. No extra props, no people, no text overlays unless requested, no packaging distractions. Focus entirely on the product as the hero.`,
  },
  {
    id: 'product-3x3-storyboard',
    type: 'advanced',
    name: '3×3 产品分镜板',
    englishName: '3x3 Product Storyboard',
    description: '参考产品生成 9 宫格设计分镜, 保持包装, 品牌, 材质, 颜色和比例一致',
    usage: '建议上传产品图, 输入产品名称和用途, 如: 香薰蜡烛礼盒, 品牌组合展示',
    group: '电商营销',
    requiresReference: true,
    exampleImage: '/assets/style-examples/product-3x3-storyboard.webp',
    exampleAlt: '3×3 产品分镜板高级风格示例图',
    template: `Create ONE final image. A clean 3×3 storyboard grid with nine equal panels in 4:5 ratio. Use the uploaded reference image as the base product reference for {主题}. Keep the same product, packaging design, branding, materials, colors, proportions and overall identity across all nine panels exactly as the reference. The product must remain clearly recognizable in every frame. The label, logo and proportions must stay exactly the same. This storyboard is a high-end designer mockup presentation for a branding portfolio. The focus is on form, composition, materiality and visual rhythm rather than realism or lifestyle narrative. FRAME 1: Front-facing hero shot in a clean studio setup. FRAME 2: Close-up focused on material or packaging detail. FRAME 3: Side angle showing depth. FRAME 4: Floating arrangement with shadows. FRAME 5: Graphic composition with product centered. FRAME 6: Detail crop with typography space. FRAME 7: Minimal lifestyle context. FRAME 8: Packaging or accessory composition. FRAME 9: Final brand closing frame.`,
  },
  {
    id: 'icon-collection-grid',
    type: 'advanced',
    name: '3D 图标九宫格',
    englishName: '3D Icon Collection',
    description: '同主题 3D 图标套装, 九宫格白底, 适合 App, 品牌资产和素材库',
    usage: '输入主题, 如: 狗狗不同情绪, 咖啡馆图标, AI 工具图标',
    group: '图标素材',
    exampleImage: '/assets/style-examples/icon-collection-grid.webp',
    exampleAlt: '3D 图标九宫格高级风格示例图',
    template: `Create a collection of icons representing {主题}. They must belong together as a single coherent theme. Put them in a clean 3x3 grid on a white background. Make the icons in a colorful tactile 3D style, soft rounded forms, consistent camera angle, consistent lighting, consistent material language, playful but polished, no text. Each icon should be distinct and instantly readable while sharing the same visual system. Use high-quality app icon / sticker pack finish, soft shadows, crisp edges, balanced spacing, no messy background.`,
  },
  {
    id: 'brand-sticker-sheet',
    type: 'advanced',
    name: '品牌贴纸套装',
    englishName: 'Brand Sticker Sheet',
    description: '把品牌或 IP 拆成 8 到 10 个贴纸元素, 适合周边, 社媒和贴纸包',
    usage: '输入品牌或 IP, 如: 芽绘台 AI 生图工作台, 咖啡馆品牌, 可爱猫咪 IP',
    group: '图标素材',
    exampleImage: '/assets/style-examples/brand-sticker-sheet.webp',
    exampleAlt: '品牌贴纸套装高级风格示例图',
    template: `{主题}. Act as a vector illustrator designing a trendy, high-end sticker sheet set. Deconstruct the brand identity, IP, product or theme from {主题} into a playful cohesive set of approximately 8-10 unique sticker designs. Include a mix of mascot, logo, product, symbol, phrase badge, small prop, emotional icon, and decorative motif. Use clean vector shapes, thick friendly outlines, tasteful color palette, consistent style, premium sticker-sheet layout on a light background, soft shadow or die-cut white border, no clutter. All stickers must feel like one collection and be suitable for merch, social media, packaging inserts, or digital sticker packs.`,
  },
  {
    id: 'recipe-infographic',
    type: 'advanced',
    name: '现代食谱信息图',
    englishName: 'Recipe Infographic',
    description: '成品菜 + 食材 + 步骤 + tips + 营养信息, 适合餐饮, 食品和小红书内容',
    usage: '输入菜品或饮品, 如: 牛肉面, 抹茶拿铁, 低脂早餐碗',
    group: '餐饮食品',
    exampleImage: '/assets/style-examples/recipe-infographic.webp',
    exampleAlt: '现代食谱信息图高级风格示例图',
    template: `Ultra-clean modern recipe infographic. Showcase {主题} in a visually appealing finished form — sliced, plated, poured, stacked or portioned — floating slightly in perspective or angled view. Arrange ingredients, steps, and tips around the dish in a dynamic editorial layout, not restricted to top-down. Ingredients Section: Include icons or mini illustrations for each ingredient with quantities, arranged in clusters, lists, or circular flows connected visually to the dish. Steps Section: Show preparation steps with numbered panels, arrows, or lines forming a logical flow. Include small cooking icons where helpful. Additional Info: calories, prep/cook time, servings, spice level or tasting notes as clean bubbles or badges. Visual Style: Editorial infographic meets lifestyle food photography, vibrant natural food colors, subtle drop shadows, clean typography, premium social poster.`,
  },
  {
    id: 'cute-scrapbook-food',
    type: 'advanced',
    name: '可爱手帐食品海报',
    englishName: 'Cute Scrapbook Food',
    description: '真实食品摄影混合涂鸦, 贴纸, 胶带纸条和手写箭头, 适合甜品饮品',
    usage: '输入食品或饮品, 如: 草莓抹茶拿铁, 韩系咖啡馆甜品, 可爱便当',
    group: '餐饮食品',
    exampleImage: '/assets/style-examples/cute-scrapbook-food.webp',
    exampleAlt: '可爱手帐食品海报高级风格示例图',
    template: `Cute scrapbook-style food photography poster for {主题}. Aesthetic cafe design, realistic food or drink photography mixed with doodle illustrations, playful handwritten notes and arrows, sticker collage aesthetic, cozy Pinterest cafe vibe, pastel scrapbook journal style, colorful marker doodles, cute cartoon stickers, taped paper notes, hand-drawn sparkles and hearts, aesthetic food advertisement layout, soft natural lighting, creamy textures, vibrant fresh tones, ultra detailed food photography, trendy Gen Z cafe aesthetic, Korean-inspired scrapbook design, whimsical social media poster style, realistic textures and appetizing details.`,
  },
  {
    id: 'character-profile-sheet',
    type: 'advanced',
    name: '角色设定资料卡',
    englishName: 'Character Profile Sheet',
    description: '角色多姿态, 特写, 服装细节和设定说明, 适合 IP 设计和角色开发',
    usage: '输入角色设定, 如: 东方幻想男主, 蒸汽朋克少女侦探, 赛博医生',
    group: '角色 IP',
    exampleImage: '/assets/style-examples/character-profile-sheet.jpg',
    exampleAlt: '角色设定资料卡高级风格示例图',
    template: `Create a stylish illustrated character profile sheet for {主题}. Use a refined sketchbook or mixed-media concept art aesthetic. The page layout should include one main full-body or half-body character portrait, multiple smaller poses, close-up face views, outfit details, accessory callouts, color swatches, and concise readable notes. Emphasize personality, silhouette, clothing layers, materials, props, expression range, and visual consistency. Keep the design suitable for IP development, game character concept art, animation preproduction, or collectible character planning. Use clean spacing, tasteful handwritten or editorial labels, and a coherent art direction.`,
  },
  {
    id: 'mascot-icon',
    type: 'advanced',
    name: 'Notion 风头像吉祥物',
    englishName: 'Notion Mascot Icon',
    description: '高对比矢量吉祥物头像, 粗黑线条, 适合品牌头像和人物 IP',
    usage: '输入人物或吉祥物描述, 如: 戴眼镜的 AI 画师猫, 咖啡店老板头像',
    group: '角色 IP',
    exampleImage: '/assets/style-examples/mascot-icon.webp',
    exampleAlt: 'Notion 风头像吉祥物高级风格示例图',
    template: `Create a clean high-contrast vector mascot icon in Notion-style artwork based on {主题}. Show only the head in a 3/4 view. Use very thick bold black outer outlines and slightly thinner inner detail lines. Flat colors, simple geometric shapes, charming personality, clear silhouette, friendly expression, minimal shadows, white or transparent-looking clean background. The mascot must be instantly recognizable at small avatar size. No complex background, no random text, no messy details.`,
  },
  {
    id: 'pixar-companion-portrait',
    type: 'advanced',
    name: '真人 + 皮克斯分身',
    englishName: 'Pixar Companion Portrait',
    description: '真实人物和同一人的 3D 皮克斯风分身同框, 适合头像和趣味人像',
    usage: '上传人像后输入场景, 如: 和自己的皮克斯分身在工作室合影',
    group: '角色 IP',
    requiresReference: true,
    exampleImage: '/assets/style-examples/pixar-companion.webp',
    exampleAlt: '真人 + 皮克斯分身高级风格示例图',
    template: `Ultra-high-quality hyper-realistic photo featuring a real human and a giant 3D Pixar-style version of THE SAME person, both strictly based on the uploaded reference image. The real person and the Pixar character must have the same identity, facial structure, hairstyle, skin tone, expression spirit and recognizable features. Scene based on {主题}. The Pixar version should be a charming stylized 3D character with premium animation quality, rounded forms, expressive eyes and soft material. The real person remains photorealistic. Place both together naturally in one cinematic composition with warm lighting, believable shadows, playful emotional interaction, high-end portrait finish.`,
  },
  {
    id: 'atlas-breakdown',
    type: 'advanced',
    name: '图鉴式拆解',
    englishName: 'Atlas Breakdown',
    description: '根据主题生成中文拆解信息图, 包含结构标注, 材质工艺, 纹样寓意和核心总结',
    usage: '只需输入主题, 如: 明代马面裙, 宋代汝窑瓷器, 未来机甲少女',
    group: '图鉴拆解',
    exampleImage: '/assets/style-examples/atlas-breakdown.svg',
    exampleAlt: '图鉴式拆解高级风格示例图',
    template: `请根据{主题}自动生成一张“博物馆图鉴式中文拆解信息图”。

要求整张图兼具真实写实主视觉、结构拆解、中文标注、材质说明、纹样寓意、色彩含义和核心特征总结。你需要根据主题自动判断最合适的主体对象、服饰体系、器物结构、时代风格、关键部件、材质工艺、颜色方案与版式结构，用户无需再提供其他信息。

整体风格应为：国家博物馆展板、历史服饰图鉴、文博专题信息图，而不是普通海报、古风写真、电商详情页或动漫插画。背景采用米白、绢纸白、浅茶色等纸张质感，整体高级、克制、专业、可收藏。

版式固定为：顶部中文主标题 + 副标题 + 导语；左侧结构拆解区，中文引线标注关键部件，并配局部特写；右上材质 / 工艺 / 质感区，展示真实纹理小样并附说明；右中纹样 / 色彩 / 寓意区，展示主色板、纹样样本和文化解释；底部穿着顺序 / 构成流程图 + 核心特征总结。

若主题适合人物展示，则以真实人物全身站姿为中央主体；若更适合器物或单体结构，则改为中心主体拆解图，但整体仍保持完整中文信息图形式。所有文字必须为简体中文，清晰、规整、可读，不要乱码、错字、英文或拼音。避免：海报感、影楼感、电商感、动漫感、cosplay感、乱标注、错结构、糊字、假材质、过度装饰。`,
  },
  {
    id: 'technical-infographic',
    type: 'advanced',
    name: '技术拆解信息图',
    englishName: 'Technical Infographic',
    description: '45 度等距 3D 产品, 黑色技术标注, 尺寸, 材质和功能流向箭头',
    usage: '输入对象, 如: 智能耳机, 咖啡机, 机械键盘, 未来无人机',
    group: '图鉴拆解',
    exampleImage: '/assets/style-examples/technical-infographic.webp',
    exampleAlt: '技术拆解信息图高级风格示例图',
    template: `Create a technical infographic of {主题} with a 45-degree isometric 3D perspective showing the object slightly tilted to reveal depth and dimension. Combine a realistic photoreal render with black ink technical annotations on pure white background. Include key component labels with color-coded callout boxes, internal component visibility through transparent or cutaway sections, measurements, dimensions, precise scale markers, material callouts and quantities, color-coded arrows for function/flow: RED for power or battery, BLUE for data or connectivity, ORANGE for thermal or processor, GREEN for sensors or haptics. Add simple schematics or cross-sectional diagrams where relevant. Place the object title in a hand-drawn technical box at top-left. Style: black linework technical pen / architectural, sketched but precise. Educational museum-exhibit vibe, clean composition, balanced layout.`,
  },
  {
    id: 'naturalist-specimen',
    type: 'advanced',
    name: '博物标本剖面',
    englishName: 'Naturalist Specimen',
    description: '黑丝绒背景的博物标本剖面摄影, 适合食物, 植物, 矿物和材质结构',
    usage: '输入标本主题, 如: 石榴, 牛油果, 松露巧克力, 玫瑰石英',
    group: '图鉴拆解',
    exampleImage: '/assets/style-examples/naturalist-specimen.jpg',
    exampleAlt: '博物标本剖面高级风格示例图',
    template: `一颗/一块/一枚{主题}, 以博物学大师发现野外标本的方式解剖。剖开、展开、固定——如同博物馆的珍贵藏品, 却以卡拉瓦乔为《国家地理》掌镜时的光线照亮。每一个内部结构都以自身的材质真相发光。截面锋利得近乎暴力, 内部美丽得近乎神圣。画面中呈现完整标本: 一半保持原状, 展示外表面真实质感, 颜色和纹理; 另一半剖开至核心, 内部关键结构清晰可见。背景为纯粹黑丝绒, 主体悬浮其中, 如同珍贵而危险的事物。标注文字紧贴结构边缘, 手写感衬线字体, 绝不悬空飘浮。画面包含结构名称, 成分或材质说明, 以及一句人话解释这个结构为什么重要。左上角放置暖象牙白主标题: {主题} · 解剖。整体气质: 奥杜邦博物插画 × 卡拉瓦乔光影 × 极美科学摄影。写实风格, 非示意图, 非卡通, 非简化图解。`,
  },
  {
    id: 'travel-map-infographic',
    type: 'advanced',
    name: '旅行地图图鉴',
    englishName: 'Travel Map Infographic',
    description: '国家或城市地形地图, 微缩地标, 城市标签和旅行道具, 适合文旅宣传',
    usage: '输入国家或城市, 如: 日本旅行地图, 杭州文旅图鉴, 意大利美食路线',
    group: '文旅地图',
    exampleImage: '/assets/style-examples/travel-map-infographic.webp',
    exampleAlt: '旅行地图图鉴高级风格示例图',
    template: `A hyper-realistic 3D travel guide infographic poster for {主题}. The country, region or city shape is rendered as a raised, textured terrain map floating on a clean light gray surface. Iconic landmarks are placed as miniature 3D sculpted models at their correct or visually reasonable geographic locations across the map — each one highly detailed and photorealistic. Roads or railway lines connect key cities as white paths across the terrain. Around the map, floating 3D decorative props related to travel are scattered: vintage leather suitcase with travel stickers, compass rose, crystal heart charms, postage stamp seal reading Travel to the destination. Each major city or area has a bold black label on the map, and beside the map, each city has a neat checklist of top attractions in clean sans-serif typography. Premium travel poster, bright, collectible, educational, clean layout.`,
  },
  {
    id: 'line-art-travel-poster',
    type: 'advanced',
    name: '极简线稿旅行海报',
    englishName: 'Line Art Travel Poster',
    description: '城市日常场景线稿旅行海报, 比明信片更现代, 适合城市和生活方式主题',
    usage: '输入目的地, 如: 上海武康路, 京都清晨街角, 里斯本老电车',
    group: '文旅地图',
    exampleImage: '/assets/style-examples/line-art-travel-poster.webp',
    exampleAlt: '极简线稿旅行海报高级风格示例图',
    template: `Create an ultra-high-resolution minimalist line-art travel poster of {主题}, portraying the destination as a stylish everyday urban scene rather than a tourist postcard. Central composition shows a quiet, lived-in street moment with recognizable local architecture, signage, transportation, plants, windows, cafe chairs or pedestrians as appropriate. Use elegant black or dark ink linework, restrained warm off-white background, subtle flat color accents, editorial travel poster layout, calm negative space, premium print feel, modern lifestyle atmosphere, clean composition, no clutter, no random text.`,
  },
  {
    id: 'landmark-blueprint',
    type: 'advanced',
    name: '地标蓝图注释',
    englishName: 'Landmark Blueprint',
    description: '真实地标照片叠加蓝图式技术注释, 适合建筑, 景点和文化遗产',
    usage: '输入地标, 如: 埃菲尔铁塔, 万里长城, 圣家堂, 杭州雷峰塔',
    group: '文旅地图',
    exampleImage: '/assets/style-examples/landmark-blueprint.webp',
    exampleAlt: '地标蓝图注释高级风格示例图',
    template: `Create an infographic image of {主题}, combining a real photograph of the landmark with blueprint-style technical annotations and diagrams overlaid on the image. Include the title of the landmark in a hand-drawn technical box in the top-left. Use fine white or cyan blueprint lines, measurement markers, architectural callouts, historical notes, structural diagrams, subtle transparent overlays, and clean editorial composition. The landmark remains the main photographic subject, majestic and realistic. The annotations should look precise, educational and museum-quality. Avoid clutter, unreadable tiny text and fake messy labels.`,
  },
  {
    id: 'postal-stamp-poster',
    type: 'advanced',
    name: '邮票收藏旅行海报',
    englishName: 'Postal Stamp Poster',
    description: '整张图像一枚奢华纪念邮票, 适合城市, 国家, 地标和文化主题',
    usage: '输入城市或主题, 如: 巴黎咖啡馆, 北京中轴线, 东京樱花季',
    group: '文旅地图',
    exampleImage: '/assets/style-examples/postal-stamp-poster.webp',
    exampleAlt: '邮票收藏旅行海报高级风格示例图',
    template: `Design a premium 4:5 collectible postal-stamp poster for {主题}, where the entire composition is one monumental luxury postage stamp filling the frame edge-to-edge like a rare national artifact. The stamp should dominate the image with perforated edges, fine engraved border details, elegant denomination marks, and a central travel illustration or photoreal landmark scene based on {主题}. Use refined print texture, subtle paper grain, tasteful vintage-modern color palette, premium collectible design, strong central composition, readable short title, no random text. The result should feel like a luxury souvenir poster and a rare stamp at the same time.`,
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
