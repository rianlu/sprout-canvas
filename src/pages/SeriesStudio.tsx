import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ReferenceUploader } from '../components/studio/ReferenceUploader';
import { ResultGrid } from '../components/studio/ResultGrid';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { requestTextGeneration } from '../lib/api/text';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import type { QueueSubmitInput } from '../lib/api/queue';
import type { GenerationConfig, RefImage, ResultRecord } from '../types/generation';

interface SeriesStudioProps {
  onSubmit: (input: QueueSubmitInput) => Promise<unknown>;
  results: ResultRecord[];
}

const PRESETS = {
  ecommerce: {
    label: '电商详情页',
    hint: '自动拆成主图, 卖点, 细节, 场景, 规格和收尾图。',
    example: '例如: 屁桃贴, 可爱贴纸产品, 需要一组电商详情页视觉图, 包含主图, 核心卖点, 材质细节, 使用场景和规格说明...',
    planSystem: '你是电商详情图组策划。根据生成内容和统一风格锚点拆分 5 到 8 张相关联图片。只输出多行文本, 每行格式为“图片名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖主图, 核心卖点, 细节特写, 使用场景, 尺寸规格, 品牌收尾。',
    optimizeSystem: '你是电商生图提示词优化器。把用户输入改写成可直接用于生成系列电商图片的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含色彩, 光影, 背景, 构图, 材质, 版式, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张电商详情页视觉模块, 构图完整, 避免乱码文字, 如需文字仅保留短标题区域和信息占位感.',
  },
  productPhoto: {
    label: '产品拍摄组',
    hint: '适合同一产品的白底, 质感, 场景, 包装和细节图。',
    example: '例如: 一款透明果冻质感的无线蓝牙音箱, 需要白底主图, 45度角展示, 材质特写, 包装组合和生活方式场景...',
    planSystem: '你是产品摄影组图策划。根据生成内容和统一风格锚点拆分 4 到 8 张同一产品图片。只输出多行文本, 每行格式为“图片名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖白底主图, 45度角, 材质细节, 尺寸比例, 生活方式场景, 包装组合。',
    optimizeSystem: '你是产品摄影提示词优化器。把用户输入改写成可直接用于生成产品组图的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含产品主体, 摄影光线, 背景材质, 镜头角度, 真实质感, 阴影, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张产品摄影图, 产品为唯一视觉主体, 色彩和材质准确, 背景干净, 避免文字乱码和多余品牌标识.',
  },
  poster: {
    label: '海报宣传',
    hint: '适合活动主视觉, 系列海报, 宣传KV和不同渠道尺寸延展。',
    example: '例如: 夏日新品发布活动, 主题是清爽海风和柑橘气泡, 需要一组主KV, 卖点海报, 倒计时海报和收尾海报...',
    planSystem: '你是海报系列策划。根据生成内容和统一风格锚点拆分 3 到 6 张宣传海报视觉。只输出多行文本, 每行格式为“海报名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖主KV, 卖点海报, 倒计时海报, 场景海报, 收尾转化海报。',
    optimizeSystem: '你是宣传海报提示词优化器。把用户输入改写成可直接用于生成系列海报的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含视觉主题, 色彩系统, 光影氛围, 背景层次, 主体构图, 留白版式, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张宣传海报视觉, 保留清晰标题和文案留白区域, 避免生成不可读乱码文字, 画面有明确传播焦点.',
  },
  socialCarousel: {
    label: '社媒轮播',
    hint: '适合小红书, Instagram, 公众号封面配图等连续内容。',
    example: '例如: 小红书轮播内容, 主题是新手如何布置高颜值桌面, 需要封面钩子, 痛点说明, 步骤拆解, 对比图和总结页...',
    planSystem: '你是社媒轮播内容策划。根据生成内容和统一风格锚点拆分 4 到 9 张连续轮播图。只输出多行文本, 每行格式为“页面名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖封面钩子, 痛点, 解决方案, 细节说明, 对比, 总结引导。',
    optimizeSystem: '你是社媒轮播生图提示词优化器。把用户输入改写成可直接用于生成系列社媒图片的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含平台感, 封面风格, 色彩, 图文留白, 构图节奏, 装饰元素, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张社媒轮播视觉页, 构图简洁有停留感, 预留文案区, 避免不可读乱码文字, 与整组视觉保持连贯.',
  },
  adCampaign: {
    label: '广告素材组',
    hint: '适合投放广告, A/B 创意, 卖点角度和人群场景变化。',
    example: '例如: 一款便携咖啡机广告素材组, 面向上班族和露营用户, 需要利益点, 使用前后对比, 人群场景, 促销和行动引导...',
    planSystem: '你是广告创意组图策划。根据生成内容和统一风格锚点拆分 4 到 8 张广告素材。只输出多行文本, 每行格式为“素材名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖强利益点, 使用前后对比, 人群场景, 价格促销, 信任背书, 行动引导。',
    optimizeSystem: '你是广告素材提示词优化器。把用户输入改写成可直接用于生成广告创意组图的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含目标人群, 核心卖点, 视觉冲击, 色彩, 光影, CTA留白, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张广告素材图, 第一眼焦点明确, 有行动引导区域, 不生成乱码文字, 画面适合投放测试.',
  },
  brandKit: {
    label: '品牌视觉组',
    hint: '适合品牌调性探索, 主视觉, 图标, 背景纹理和社媒模板。',
    example: '例如: 一个治愈系宠物零食品牌, 品牌关键词是安心, 温暖, 天然, 需要主视觉, 色彩氛围, 图形纹理, 包装和社媒模板...',
    planSystem: '你是品牌视觉系统策划。根据生成内容和统一风格锚点拆分 5 到 8 张品牌视觉资产。只输出多行文本, 每行格式为“资产名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖品牌主视觉, 色彩氛围, 图形纹理, 产品应用, 社媒模板, 包装延展。',
    optimizeSystem: '你是品牌视觉提示词优化器。把用户输入改写成可直接用于生成品牌视觉组的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含品牌气质, 色彩系统, 图形语言, 字体气质, 材质, 版式秩序, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张品牌视觉资产图, 风格统一, 适合延展成品牌物料, 避免随机Logo和不可读文字.',
  },
  ipCharacter: {
    label: '角色设定',
    hint: '适合 IP 角色三视图, 表情, 动作, 道具和场景设定。',
    example: '例如: 一个圆滚滚的水獭咖啡师 IP, 戴小围裙和贝雷帽, 需要正面, 侧面, 背面, 表情表, 动作姿态和道具设定...',
    planSystem: '你是角色设定组图策划。根据生成内容和统一风格锚点拆分 5 到 10 张角色设定图。只输出多行文本, 每行格式为“设定名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖正面形象, 侧面形象, 背面形象, 表情表, 动作姿态, 道具, 场景应用。',
    optimizeSystem: '你是角色设定提示词优化器。把用户输入改写成可直接用于生成角色系列图的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含角色轮廓, 服饰道具, 色彩, 线条, 表情范围, 造型比例, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张角色设定图, 角色身份清晰, 造型和比例稳定, 背景简洁, 避免文字乱码.',
  },
  sticker: {
    label: '表情贴纸',
    hint: '自动拆成不同情绪, 动作和常用聊天场景。',
    example: '例如: 屁桃贴角色表情包, 可爱圆润贴纸风, 需要开心, 生气, 疑惑, 加油, 收到, 晚安等常用聊天动作...',
    planSystem: '你是 IP 表情包策划。根据生成内容和统一风格锚点拆分 8 到 12 张相关联表情图。只输出多行文本, 每行格式为“表情名称: 动作和表情描述”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是 IP 表情包生图提示词优化器。把用户输入改写成可直接用于生成系列表情包的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含角色外观, 线条, 色彩, 表情幅度, 背景, 构图, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张表情包图片, 主体清晰, 表情夸张, 背景简洁, 避免乱码文字.',
  },
  productConcept: {
    label: '产品概念图',
    hint: '适合新产品外观, CMF, 使用场景和功能概念探索。',
    example: '例如: 面向年轻人的桌面空气净化器概念, 小型圆角造型, 柔和灯带, 需要外观主视图, CMF材质, 功能细节和使用场景...',
    planSystem: '你是产品概念组图策划。根据生成内容和统一风格锚点拆分 4 到 8 张产品概念图。只输出多行文本, 每行格式为“概念名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖外观主视图, 材质配色, 功能细节, 使用场景, 尺寸比例, 系列化变体。',
    optimizeSystem: '你是产品概念提示词优化器。把用户输入改写成可直接用于生成产品概念组图的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含产品定位, 形态语言, CMF材质, 光影, 背景, 工业设计感, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张产品概念图, 外观可信, 结构清楚, 材质统一, 背景不抢主体, 避免乱码文字.',
  },
  tutorial: {
    label: '教程步骤图',
    hint: '适合安装步骤, 使用流程, 操作指南和说明书配图。',
    example: '例如: 智能门锁安装教程, 需要准备工具, 拆旧锁, 安装锁体, 连接电池, App配网, 完成检查等步骤图...',
    planSystem: '你是教程步骤图策划。根据生成内容和统一风格锚点拆分 4 到 10 张步骤图片。只输出多行文本, 每行格式为“步骤名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议按准备, 步骤1, 步骤2, 关键注意, 完成效果, 常见错误拆分。',
    optimizeSystem: '你是教程步骤图提示词优化器。把用户输入改写成可直接用于生成流程说明组图的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含主体对象, 操作手势, 视角, 背景简洁度, 标注留白, 清晰度, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张教程步骤图, 操作关系清晰, 可预留编号和标注区域, 避免不可读乱码文字, 画面简洁易懂.',
  },
  eventCampaign: {
    label: '活动物料组',
    hint: '适合节日活动, 新品发布, 线下活动和全渠道物料延展。',
    example: '例如: 春季新品快闪活动, 主题是花园灵感和轻盈绿色, 需要活动主视觉, 预热图, 亮点介绍, 现场导视和感谢收尾...',
    planSystem: '你是活动营销物料策划。根据生成内容和统一风格锚点拆分 5 到 9 张活动视觉。只输出多行文本, 每行格式为“物料名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。建议覆盖活动主视觉, 倒计时, 亮点介绍, 嘉宾或产品, 社媒预热, 现场导视, 收尾感谢。',
    optimizeSystem: '你是活动物料提示词优化器。把用户输入改写成可直接用于生成活动系列物料的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含活动气氛, 主视觉元素, 色彩, 光影, 版式留白, 渠道适配, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张活动视觉物料, 氛围强, 主次清楚, 保留标题和信息区, 避免乱码文字.',
  },
  custom: {
    label: '通用设计方案',
    hint: '适合无法归类的海报套图, 概念图, 场景图和混合型需求。',
    example: '例如: 一组未来感 AI 工作台概念图, 需要封面主视觉, 功能展示, 使用场景, 细节特写和氛围延展...',
    planSystem: '你是视觉系列策划。根据生成内容和统一风格锚点拆分 4 到 8 张相关联图片。只输出多行文本, 每行格式为“图片名称: 画面目标”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是系列生图提示词优化器。把用户输入改写成可直接用于生成系列图片的共同风格提示词。只输出 1 段中文, 80 到 160 字, 用逗号分隔关键词。必须包含主体风格, 色彩, 光影, 背景, 构图, 材质, 一致性约束。禁止输出标题, Markdown, 列表, emoji, 解释, 示例, think。',
    outputRule: '生成单张系列图片, 保持统一视觉系统, 同时让画面主题和构图有自然变化.',
  },
};

type PresetKey = keyof typeof PRESETS;

const MAX_SERIES_BATCH = 12;

function parsePlan(plan: string) {
  return plan.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [title, ...rest] = line.replace(/^[-\d.\s]+/, '').split(/[:：]/);
    return { title: title?.trim() || `第 ${index + 1} 张`, goal: rest.join(':').trim() || line };
  });
}

export function SeriesStudio({ onSubmit, results }: SeriesStudioProps) {
  const [preset, setPreset] = useState<PresetKey>('custom');
  const [content, setContent] = useState(() => readDraft('series_content'));
  const [style, setStyle] = useState(() => readDraft('series_style'));
  const [plan, setPlan] = useState(() => readDraft('series_plan'));
  const [count, setCount] = useState(4);
  const [aspectRatio, setAspectRatio] = useState<GenerationConfig['aspectRatio']>('1:1');
  const [quality, setQuality] = useState<GenerationConfig['quality']>('auto');
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const pages = useMemo(() => parsePlan(plan), [plan]);
  const seriesResults = results.filter((record) => record.kind === 'series').slice(0, 16);
  const plannedCount = Math.min(MAX_SERIES_BATCH, pages.length || Math.max(1, count));
  const canSubmit = Boolean(content.trim() || style.trim()) && !busy && !submitting;

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft('series_content', content), 400);
    return () => window.clearTimeout(timer);
  }, [content]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft('series_style', style), 400);
    return () => window.clearTimeout(timer);
  }, [style]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft('series_plan', plan), 400);
    return () => window.clearTimeout(timer);
  }, [plan]);

  async function createPlan() {
    if (!content.trim() && !style.trim()) throw new Error('请先填写需要生成的内容');
    setBusy(true);
    try {
      const response = await requestTextGeneration(PRESETS[preset].planSystem, `设计主题: ${PRESETS[preset].label}\n需要生成的内容: ${content || '未填写'}\n风格锚点: ${style || '请根据内容自动选择适合的统一风格锚点'}`);
      setPlan(response.text.trim());
      setCount(Math.max(1, Math.min(12, parsePlan(response.text).length || count)));
    } finally { setBusy(false); }
  }

  async function optimizeStyle() {
    if (!content.trim() && !style.trim()) throw new Error('请先填写需要生成的内容');
    setBusy(true);
    try {
      const response = await requestTextGeneration(PRESETS[preset].optimizeSystem, `设计主题: ${PRESETS[preset].label}\n需要生成的内容: ${content || '未填写'}\n原始风格要求: ${style || '未填写, 请根据内容自动选择'}`);
      setStyle(response.text.trim());
    } finally { setBusy(false); }
  }

  async function submitSeries() {
    if (!content.trim() && !style.trim()) throw new Error('请填写需要生成的内容');
    setSubmitting(true);
    const size = resolveSize(aspectRatio);
    const fallbackCount = Math.max(1, Math.min(MAX_SERIES_BATCH, Math.round(count) || 1));
    const effectivePages = (pages.length ? pages : Array.from({ length: fallbackCount }, (_, index) => ({ title: `第 ${index + 1} 张`, goal: `系列第 ${index + 1}/${fallbackCount} 张` }))).slice(0, MAX_SERIES_BATCH);
    try {
      for (let index = 0; index < effectivePages.length; index += 1) {
        const page = effectivePages[index];
        const anchor = style.trim() || `${PRESETS[preset].label}, ${content.trim()}, 风格由 AI 根据内容保持统一`;
        const prompt = [`设计主题: ${PRESETS[preset].label}`, `需要生成的内容: ${content || '未填写'}`, `统一风格锚点: ${anchor}`, `当前图片: ${page.title}`, `画面目标: ${page.goal}`, PRESETS[preset].outputRule, '保持系列一致性, 但不要与其他图片重复.'].join('\n');
        const config: GenerationConfig = {
          mode: refs.length ? 'reference' : 'text',
          generationMode: 'images',
          imageModel: 'gpt-image-2',
          prompt,
          imageCount: 1,
          aspectRatio,
          requestSize: size.size,
          sizeHint: size.hint,
          quality,
          background: 'auto',
          outputFormat: 'auto',
          outputCompression: 90,
          refImages: refs,
        };
        const payload = await buildGenerationPayload(config);
        await onSubmit({
          endpoint: '/v1/images/generations',
          body: JSON.stringify(payload),
          contentType: 'application/json',
          clientContext: { kind: 'series', placeholderId: randomId('series'), prompt: page.title, mode: config.mode },
        });
      }
      setToast({ type: 'success', message: `已提交 ${effectivePages.length} 个系列任务, 可在右下角队列查看进度.` });
    } finally {
      setSubmitting(false);
    }
  }
  async function runAction(action: () => Promise<void>) {
    try {
      setToast(null);
      await action();
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : '操作失败' });
    }
  }

  return (
    <div className="series-page">
      <header className="studio-hero series-hero">
        <div>
          <span className="eyebrow">Series Workflow</span>
          <h1>系列生成</h1>
          <p>选择设计主题, 输入要生成的内容, AI 会自动补齐风格并拆成一组相关联图片.</p>
        </div>
        <div className="provider-pill">
          <span>预计提交</span>
          <strong>{plannedCount} 张</strong>
        </div>
      </header>

      <div className="series-layout">
        <div className="series-main">
          <Card className="series-step-card series-brief-card">
            <div className="series-step-heading">
              <span className="step-badge">1</span>
              <div><span className="eyebrow">Brief</span><h2>说明你要生成什么</h2><p>设计主题会注入隐藏规则, 风格锚点不会写也可以自动生成.</p></div>
            </div>
            <label className="field"><span>设计主题</span><select value={preset} onChange={(event) => setPreset(event.target.value as PresetKey)}>{Object.entries(PRESETS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select><small>{PRESETS[preset].hint}</small></label>
            <label className="field"><span>需要生成的内容</span><textarea className="series-content-input" value={content} onChange={(event) => setContent(event.target.value)} placeholder={PRESETS[preset].example} /></label>
            <label className="field"><span>风格锚点 (可选)</span><textarea className="series-style-input" value={style} onChange={(event) => setStyle(event.target.value)} placeholder="不知道风格可以留空, AI 会根据内容自动补齐。也可以写: 可爱风, 粉嫩马卡龙配色, 圆润贴纸造型, 奶油白背景, 柔光..." /></label>
            <div className="button-row"><Button disabled={busy || !content.trim()} onClick={() => { void runAction(optimizeStyle); }}>{busy ? '处理中...' : '生成风格锚点'}</Button><Button disabled={busy || (!style.trim() && !content.trim())} onClick={() => { void runAction(createPlan); }}>拆分成图片清单</Button></div>
          </Card>

          <Card className="series-step-card series-reference-card">
            <div className="series-step-heading">
              <span className="step-badge">2</span>
              <div><span className="eyebrow">Reference</span><h2>设置参考图和输出参数</h2><p>参考图可选, 会让整个系列保持同一个主体或产品.</p></div>
            </div>
            <ReferenceUploader images={refs} onChange={setRefs} />
            <div className="field-grid series-settings-grid">
              <label className="field"><span>没有规划时生成张数</span><input type="number" inputMode="numeric" min={1} max={MAX_SERIES_BATCH} value={count} onChange={(event) => { const n = Number(event.target.value); setCount(Number.isFinite(n) ? n : 1); }} onBlur={() => setCount((current) => Math.max(1, Math.min(MAX_SERIES_BATCH, Math.round(current) || 1)))} /></label>
              <label className="field"><span>比例</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as GenerationConfig['aspectRatio'])}><option>1:1</option><option>16:9</option><option>9:16</option><option>4:3</option><option>3:4</option><option>auto</option></select></label>
              <label className="field"><span>质量</span><select value={quality} onChange={(event) => setQuality(event.target.value as GenerationConfig['quality'])}><option>auto</option><option>low</option><option>medium</option><option>high</option></select></label>
            </div>
          </Card>
        </div>

        <aside className="series-side">
          <Card className="series-step-card sticky-card">
            <div className="series-step-heading">
              <span className="step-badge">3</span>
              <div><span className="eyebrow">Shot List</span><h2>确认图片清单</h2><p>每行一张图, 固定风格锚点只写一次, 每张图只写变化目标.</p></div>
            </div>
            <label className="field"><span>图片清单</span><textarea className="series-plan-input" value={plan} onChange={(event) => setPlan(event.target.value)} placeholder={'例:\n封面主视觉: 产品居中, 展示整体氛围\n卖点细节: 放大材质和关键功能\n场景应用: 展示真实使用环境'} /></label>
            <div className="series-plan-preview">
              {pages.length === 0 ? <div className="empty-state">还没有图片清单. 可以点击左侧“拆分成图片清单”, 或直接按示例手写.</div> : pages.map((page, index) => (
                <article key={`${page.title}-${index}`} className="series-plan-item"><span>{index + 1}</span><div><strong>{page.title}</strong><p>{page.goal}</p></div></article>
              ))}
            </div>
            <Button variant="primary" className="generate-button" disabled={!canSubmit} onClick={() => { void runAction(submitSeries); }}>{submitting ? '正在提交...' : `提交 ${plannedCount} 个系列任务`}</Button>
            <p className="series-help-text">提交后不会阻塞页面, 任务会进入右下角队列自动排队生成.</p>
          </Card>
        </aside>
      </div>

      <section className="series-results-section">
        <div className="preview-heading"><div><span className="eyebrow">Results</span><h2>最近系列结果</h2></div><span>{seriesResults.length} 张</span></div>
        <ResultGrid records={seriesResults} />
      </section>
      {toast && <div className={`toast ${toast.type}`} role="status" aria-live="polite">{toast.message}</div>}
    </div>
  );
}
