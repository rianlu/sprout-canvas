import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ReferenceUploader } from '../components/studio/ReferenceUploader';
import { ResultGrid } from '../components/studio/ResultGrid';
import { StylePicker } from '../components/studio/StylePicker';
import { GenerationCoreSettings } from '../components/studio/GenerationSettingsPanel';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { requestTextGeneration } from '../lib/api/text';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { applyAnyImageStyleToPrompt, findImageStyle } from '../lib/styles/image-styles';
import type { QueueSubmitInput } from '../lib/api/queue';
import type { AspectRatio, GenerationConfig, ImageQuality, ImageSizeTier, RefImage, ResultRecord } from '../types/generation';

interface SeriesStudioProps {
  onSubmit: (input: QueueSubmitInput) => Promise<unknown>;
  results: ResultRecord[];
}

type BatchMode = 'variants' | 'multiTopic' | 'board';

interface BatchTask {
  title: string;
  prompt: string;
}

const MAX_BATCH_COUNT = 9;

const MODE_META: Record<BatchMode, { label: string; eyebrow: string; description: string; placeholder: string; optimizeLabel: string }> = {
  variants: {
    label: '同图变体',
    eyebrow: 'Image Variations',
    description: '基于一张参考图, 批量生成相似但不同的版本, 适合换背景, 构图, 配色, 广告版式和服装道具。',
    placeholder: '例如: 基于这张产品图做 4 版夏日广告图, 分别突出清爽背景, 产品近景, 生活方式场景和极简棚拍。',
    optimizeLabel: '生成任务清单',
  },
  multiTopic: {
    label: '多主题同风格',
    eyebrow: 'Multi Topic',
    description: '每行一个主题, 套同一个风格和参数批量生成, 适合一批产品主图, 一组角色, 多个海报方向。',
    placeholder: '每行一个主题:\n草莓味气泡水夏日主图\n柠檬味气泡水夏日主图\n白桃味气泡水夏日主图\n葡萄味气泡水夏日主图',
    optimizeLabel: '优化主题清单',
  },
  board: {
    label: '分镜套图',
    eyebrow: 'Board Template',
    description: '输入一个主题, 使用高级模板生成一张九宫格, 资料卡或广告板大图, 生成后可进入切图。',
    placeholder: '例如: 一款东方木质调香水的 9 宫格广告分镜, 需要包含氛围, 产品, 材质, 使用场景和品牌收尾。',
    optimizeLabel: '优化套图主题',
  },
};

const DEFAULT_VARIANT_TASKS = ['背景变化版: 保持参考图主体一致, 更换为更有氛围的背景, 保持画面自然统一', '构图变化版: 保持参考图主体一致, 调整镜头角度和主体占比, 形成新的视觉重心', '光影变化版: 保持参考图主体一致, 改变光线方向, 明暗层次和整体情绪', '广告版式版: 保持参考图主体一致, 加强商业广告构图, 预留标题和卖点空间', '配色变化版: 保持参考图主体一致, 切换整体色彩系统, 形成不同视觉风格', '场景应用版: 保持参考图主体一致, 放入真实使用或生活方式场景', '材质细节版: 保持参考图主体一致, 强化材质, 纹理, 反光和细节特写', '极简棚拍版: 保持参考图主体一致, 使用干净背景和高级棚拍光线', '社媒封面版: 保持参考图主体一致, 做成适合社媒传播的封面构图'];

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseTaskLines(value: string): BatchTask[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const normalized = line.replace(/^[-*\d.、\s]+/, '').trim();
    const separator = normalized.includes(':') ? ':' : normalized.includes('：') ? '：' : '';
    if (!separator) return { title: normalized.slice(0, 28), prompt: normalized };
    const [title, ...rest] = normalized.split(separator);
    return { title: title.trim() || '未命名任务', prompt: rest.join(separator).trim() || normalized };
  });
}


function buildBaseConfig(settings: Pick<GenerationConfig, 'aspectRatio' | 'sizeTier' | 'quality' | 'background' | 'outputFormat' | 'outputCompression'>, refs: RefImage[], mode: GenerationConfig['mode']): GenerationConfig {
  const size = resolveSize(settings.aspectRatio, settings.sizeTier);
  return {
    mode,
    generationMode: 'images',
    imageModel: 'gpt-image-2',
    prompt: '',
    imageCount: 1,
    aspectRatio: settings.aspectRatio,
    sizeTier: settings.sizeTier,
    requestSize: size.size,
    sizeHint: size.hint,
    quality: settings.quality,
    background: settings.background,
    outputFormat: settings.outputFormat,
    outputCompression: settings.outputCompression,
    refImages: refs,
    editSelection: null,
  };
}

function buildOptimizeSystem(mode: BatchMode, count: number) {
  if (mode === 'variants') return `你是 AI 生图批量变体策划器。用户会提供一张参考图和一句目标。请拆成 ${count} 条可直接用于图生图的变体任务。只输出多行文本, 每行格式为“变体名称: 具体画面目标”。必须让每条都保持参考图主体一致, 但在背景, 构图, 配色, 镜头, 广告版式或道具上形成清晰差异。禁止 Markdown, 禁止编号, 禁止解释, 禁止 think。`;
  if (mode === 'multiTopic') return '你是 AI 生图批量提示词优化器。用户会提供多行主题。请逐行优化成可直接生图的任务清单, 保持统一视觉风格和质量标准。只输出多行文本, 每行格式为“主题名称: 优化后的完整画面描述”。禁止 Markdown, 禁止解释, 禁止 think。';
  return '你是 AI 分镜套图主题优化器。用户会提供一个粗略主题。请优化成适合生成一张九宫格分镜板, 角色资料卡, 广告板或图鉴大图的主题描述。只输出 1 段中文, 80 到 160 字, 必须包含主体, 场景, 镜头/模块, 风格, 版式, 画面重点和一致性约束。禁止标题, Markdown, 列表, emoji, 解释, 示例, think。';
}

export function SeriesStudio({ onSubmit, results }: SeriesStudioProps) {
  const [mode, setMode] = useState<BatchMode>(() => (readDraft('batch_mode') as BatchMode) || 'variants');
  const [brief, setBrief] = useState(() => readDraft('batch_brief'));
  const [taskText, setTaskText] = useState(() => readDraft('batch_tasks'));
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState(() => readDraft('batch_style'));
  const [count, setCount] = useState(() => clampInt(Number(readDraft('batch_count')), 2, MAX_BATCH_COUNT, 4));
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>((readDraft('batch_aspect_ratio') as AspectRatio) || '1:1');
  const [sizeTier, setSizeTier] = useState<ImageSizeTier>((readDraft('batch_size_tier') as ImageSizeTier) || '1K');
  const [quality, setQuality] = useState<ImageQuality>((readDraft('batch_quality') as ImageQuality) || 'auto');
  const [background, setBackground] = useState<GenerationConfig['background']>((readDraft('batch_background') as GenerationConfig['background']) || 'auto');
  const [outputFormat, setOutputFormat] = useState<GenerationConfig['outputFormat']>((readDraft('batch_output_format') as GenerationConfig['outputFormat']) || 'auto');
  const [outputCompression, setOutputCompression] = useState(() => clampInt(Number(readDraft('batch_output_compression')), 10, 100, 90));
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);

  const selectedStyle = useMemo(() => findImageStyle(selectedStyleId), [selectedStyleId]);
  const tasks = useMemo(() => {
    if (mode === 'board') return brief.trim() ? [{ title: '分镜套图', prompt: brief.trim() }] : [];
    if (mode === 'variants') return parseTaskLines(taskText).slice(0, MAX_BATCH_COUNT);
    return parseTaskLines(taskText || brief).slice(0, MAX_BATCH_COUNT);
  }, [brief, mode, taskText]);
  const plannedCount = mode === 'board' ? (brief.trim() ? 1 : 0) : Math.max(0, Math.min(mode === 'multiTopic' ? tasks.length : count, MAX_BATCH_COUNT));
  const batchResults = useMemo(() => results.filter((record) => record.kind === 'series' && submittedIds.includes(record.id)), [results, submittedIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeDraft('batch_mode', mode);
      writeDraft('batch_brief', brief);
      writeDraft('batch_tasks', taskText);
      writeDraft('batch_style', selectedStyleId);
      writeDraft('batch_count', String(count));
      writeDraft('batch_aspect_ratio', aspectRatio);
      writeDraft('batch_size_tier', sizeTier);
      writeDraft('batch_quality', quality);
      writeDraft('batch_background', background);
      writeDraft('batch_output_format', outputFormat);
      writeDraft('batch_output_compression', String(outputCompression));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [aspectRatio, background, brief, count, mode, outputCompression, outputFormat, quality, selectedStyleId, sizeTier, taskText]);

  useEffect(() => {
    if (mode === 'board' && !selectedStyleId) setSelectedStyleId('product-storyboard');
  }, [mode, selectedStyleId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const baseSettings = useMemo<Pick<GenerationConfig, 'aspectRatio' | 'sizeTier' | 'quality' | 'background' | 'outputFormat' | 'outputCompression'>>(() => ({
    aspectRatio,
    sizeTier,
    quality,
    background,
    outputFormat,
    outputCompression,
  }), [aspectRatio, background, outputCompression, outputFormat, quality, sizeTier]);

  const settingsPreviewConfig = useMemo<GenerationConfig>(() => buildBaseConfig(baseSettings, refs, refs.length ? 'reference' : 'text'), [baseSettings, refs]);

  function patchSettings(next: Partial<GenerationConfig>) {
    if (next.aspectRatio) setAspectRatio(next.aspectRatio);
    if (next.sizeTier) setSizeTier(next.sizeTier);
    if (next.quality) setQuality(next.quality);
    if (next.background) setBackground(next.background);
    if (next.outputFormat) setOutputFormat(next.outputFormat);
    if (typeof next.outputCompression === 'number') setOutputCompression(next.outputCompression);
  }

  function switchMode(nextMode: BatchMode) {
    setMode(nextMode);
    setTaskText('');
    if (nextMode === 'variants') setCount(4);
    if (nextMode === 'multiTopic') setCount(4);
    if (nextMode === 'board') setCount(1);
  }

  async function optimizePrompt() {
    if (!brief.trim()) throw new Error('请先填写你想生成什么');
    setBusy(true);
    try {
      const content = mode === 'variants'
        ? `变体需求: ${brief}\n变体数量: ${count}`
        : mode === 'multiTopic'
          ? `多行主题:\n${brief}\n统一风格: ${selectedStyle?.name || '由内容自动判断'}`
          : `套图主题: ${brief}\n推荐模板: ${selectedStyle?.name || '产品九宫格分镜'}`;
      const response = await requestTextGeneration(buildOptimizeSystem(mode, count), content);
      const optimized = response.text.trim();
      if (!optimized) throw new Error('优化结果为空');
      if (mode === 'board') setBrief(optimized);
      else setTaskText(optimized);
      setToast({ type: 'success', message: '提示词已优化, 请确认后提交.' });
    } finally {
      setBusy(false);
    }
  }

  function validateBeforeSubmit() {
    if (mode === 'variants' && refs.length === 0) throw new Error('同图变体需要先上传图片或从展馆选择图片');
    if (mode === 'board' && !brief.trim()) throw new Error('请填写分镜套图主题');
    if (mode !== 'board' && tasks.length === 0) throw new Error('请先填写或优化任务清单');
    if (selectedStyle?.type === 'advanced' && selectedStyle.requiresReference && refs.length === 0) throw new Error('当前高级风格需要上传或选择参考图');
  }

  async function submitBatch() {
    validateBeforeSubmit();
    setSubmitting(true);
    try {
      const submitTasks = mode === 'variants'
        ? (tasks.length ? tasks.slice(0, count) : DEFAULT_VARIANT_TASKS.slice(0, count).map((item) => { const [title, ...rest] = item.split(':'); return { title, prompt: `${brief}\n${rest.join(':').trim()}` }; }))
        : mode === 'board'
          ? [{ title: '分镜套图', prompt: brief.trim() }]
          : tasks;
      const nextIds: string[] = [];
      for (const task of submitTasks.slice(0, mode === 'board' ? 1 : MAX_BATCH_COUNT)) {
        const prompt = applyAnyImageStyleToPrompt(task.prompt, selectedStyle);
        const config = buildBaseConfig(baseSettings, refs, refs.length ? 'reference' : 'text');
        const payload = await buildGenerationPayload({ ...config, prompt });
        const id = randomId('result');
        nextIds.push(id);
        setSubmittedIds((current) => [id, ...current.filter((item) => item !== id)].slice(0, 36));
        await onSubmit({
          endpoint: '/v1/images/generations',
          body: JSON.stringify(payload),
          contentType: 'application/json',
          clientContext: { kind: 'series', placeholderId: id, prompt: task.prompt, mode: refs.length ? 'reference' : 'text', outputFormat: config.outputFormat },
        });
      }
      setToast({ type: 'success', message: `已提交 ${nextIds.length} 个任务, 队列会依次生成.` });
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : '操作失败' });
      setBusy(false);
      setSubmitting(false);
    }
  }

  return (
    <div className="series-page batch-page">
      <header className="studio-hero series-hero">
        <div>
          <span className="eyebrow">Batch Workflow</span>
          <h1>批量出图</h1>
          <p>创作台专注单张精修, 这里负责一次生成多张图: 同图变体, 多主题同风格或分镜套图.</p>
        </div>
        <div className="provider-pill">
          <span>预计提交</span>
          <strong>{plannedCount || 0} 张</strong>
        </div>
      </header>

      <div className="batch-mode-grid" role="tablist" aria-label="批量出图模式">
        {(Object.entries(MODE_META) as Array<[BatchMode, typeof MODE_META[BatchMode]]>).map(([key, item]) => (
          <button key={key} className={`batch-mode-card ${mode === key ? 'active' : ''}`} onClick={() => switchMode(key)}>
            <span className="eyebrow">{item.eyebrow}</span>
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </button>
        ))}
      </div>

      <div className="series-layout batch-layout">
        <div className="series-main batch-main">
          <Card className="series-step-card batch-input-card">
            <div className="series-step-heading">
              <span className="step-badge">1</span>
              <div><span className="eyebrow">Input</span><h2>{MODE_META[mode].label}</h2><p>{MODE_META[mode].description}</p></div>
            </div>

            {mode === 'variants' && (
              <ReferenceUploader images={refs} onChange={setRefs} galleryRecords={results} title="变体参考图" localHint="选择 1 张作为批量变体基础图" maxImages={1} />
            )}

            <label className="field"><span>{mode === 'multiTopic' ? '多行主题' : mode === 'board' ? '套图主题' : '变体需求'}</span><textarea className="series-content-input" value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={MODE_META[mode].placeholder} /></label>

            <div className="button-row"><Button disabled={busy || !brief.trim()} onClick={() => { void runAction(optimizePrompt); }}>{busy ? '优化中...' : MODE_META[mode].optimizeLabel}</Button></div>
          </Card>

          <Card className="series-step-card batch-style-card">
            <div className="series-step-heading">
              <span className="step-badge">2</span>
              <div><span className="eyebrow">Style</span><h2>风格和参数</h2><p>高级风格会作为模板套用, 普通风格会追加为风格要求.</p></div>
            </div>
            <StylePicker selected={selectedStyle} onChange={(style) => setSelectedStyleId(style?.id || '')} />
            <div className="series-settings-block">
              {mode !== 'board' && <label className="field series-count-field"><span>生成张数</span><input type="number" inputMode="numeric" min={2} max={MAX_BATCH_COUNT} value={count} onChange={(event) => { const next = Number(event.target.value); setCount(Number.isFinite(next) ? next : 4); }} onBlur={(event) => setCount(clampInt(Number(event.target.value), 2, MAX_BATCH_COUNT, 4))} /></label>}
              <GenerationCoreSettings config={settingsPreviewConfig} onChange={patchSettings} className="series-core-settings" />
            </div>
          </Card>
        </div>

        <aside className="series-side batch-side">
          <Card className="series-step-card sticky-card">
            <div className="series-step-heading">
              <span className="step-badge">3</span>
              <div><span className="eyebrow">Tasks</span><h2>确认任务清单</h2><p>{mode === 'board' ? '分镜套图固定提交 1 张大图, 生成后可去切图.' : '每行会作为一张图提交到队列, 可手动修改.'}</p></div>
            </div>
            {mode !== 'board' && <label className="field"><span>任务清单</span><textarea className="series-plan-input" value={taskText} onChange={(event) => setTaskText(event.target.value)} placeholder={'例:\n清爽背景版: 保持主体, 换成夏日浅色背景\n产品近景版: 放大材质细节和反光\n生活方式版: 放到真实使用场景中'} /></label>}
            <div className="series-plan-preview">
              {tasks.length === 0 ? <div className="empty-state">{mode === 'variants' ? '未生成任务清单时, 会按默认差异方向自动提交多张. 点击生成任务清单后可逐条编辑.' : '还没有任务清单. 可以先写目标, 再点击优化提示词.'}</div> : tasks.slice(0, mode === 'board' ? 1 : MAX_BATCH_COUNT).map((task, index) => (
                <article key={`${task.title}-${index}`} className="series-plan-item"><span>{index + 1}</span><div><strong>{task.title}</strong><p>{task.prompt}</p></div></article>
              ))}
            </div>
            <Button variant="primary" className="generate-button" disabled={submitting || plannedCount === 0} onClick={() => { void runAction(submitBatch); }}>{submitting ? '正在提交...' : `提交 ${plannedCount || 0} 个任务`}</Button>
            <p className="series-help-text">提交后不会阻塞页面, 所有任务会进入右下角队列排队生成.</p>
          </Card>
        </aside>
      </div>

      <section className="series-results-section">
        <div className="preview-heading"><div><span className="eyebrow">Results</span><h2>本次批量结果</h2></div><span>{batchResults.length} 张</span></div>
        <ResultGrid records={batchResults} />
      </section>
      {toast && <div className={`toast ${toast.type}`} role="status" aria-live="polite">{toast.message}</div>}
    </div>
  );
}
