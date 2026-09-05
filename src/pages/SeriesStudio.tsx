import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Loader2, Minus, Plus, Wand2 } from 'lucide-react';
import { StyleQuickPicker } from '../components/studio/StyleQuickPicker';
import { ReferencePanel } from '../components/studio/ReferencePanel';
import { ResultStream } from '../components/studio/ResultStream';
import { ParamsPanel } from '../components/studio/ParamsPanel';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { requestTextGeneration } from '../lib/api/text';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { applyAnyImageStyleToPrompt, findImageStyle } from '../lib/styles/image-styles';
import type { QueueSubmitInput } from '../lib/api/queue';
import type { GenerationConfig, RefImage, ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';

interface SeriesStudioProps {
  onSubmit: (input: QueueSubmitInput) => Promise<QueueJob>;
  results: ResultRecord[];
  jobs: QueueJob[];
}

type BatchMode = 'variants' | 'multiTopic' | 'board';

interface BatchTask {
  title: string;
  prompt: string;
}

const MAX_BATCH_COUNT = 9;

const MODE_META: Record<BatchMode, { label: string; description: string; placeholder: string; optimizeLabel: string }> = {
  variants: {
    label: '同图变体',
    description: '基于一张参考图, 批量生成相似但不同的版本.',
    placeholder: '例如: 基于这张产品图做 4 版夏日广告图, 分别突出清爽背景, 产品近景, 生活方式场景和极简棚拍.',
    optimizeLabel: '生成任务清单',
  },
  multiTopic: {
    label: '多主题同风格',
    description: '每行一个主题, 套同一个风格批量生成.',
    placeholder: '每行一个主题:\n草莓味气泡水夏日主图\n柠檬味气泡水夏日主图',
    optimizeLabel: '优化主题清单',
  },
  board: {
    label: '分镜套图',
    description: '一个主题生成一张分镜大图, 之后可切图拆分.',
    placeholder: '例如: 一款东方木质调香水的九宫格广告分镜, 需要包含氛围, 产品, 材质, 使用场景和品牌收尾.',
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

function buildOptimizeSystem(mode: BatchMode, count: number) {
  if (mode === 'variants') return `你是 AI 生图批量变体策划器。用户会提供一张参考图和一句目标。请拆成 ${count} 条可直接用于图生图的变体任务。只输出多行文本, 每行格式为“变体名称: 具体画面目标”。必须让每条都保持参考图主体一致, 但在背景, 构图, 配色, 镜头, 广告版式或道具上形成清晰差异。禁止 Markdown, 禁止编号, 禁止解释。`;
  if (mode === 'multiTopic') return '你是 AI 生图批量提示词优化器。用户会提供多行主题。请逐行优化成可直接生图的任务清单, 保持统一视觉风格和质量标准。只输出多行文本, 每行格式为“主题名称: 优化后的完整画面描述”。禁止 Markdown, 禁止解释。';
  return '你是 AI 分镜套图主题优化器。用户会提供一个粗略主题。请优化成适合生成一张九宫格分镜板, 角色资料卡, 广告板或图鉴大图的主题描述。只输出 1 段中文, 80 到 160 字, 必须包含主体, 场景, 镜头/模块, 风格, 版式, 画面重点和一致性约束。禁止标题, Markdown, 列表, emoji, 解释, 示例。';
}

export function SeriesStudio({ onSubmit, results, jobs }: SeriesStudioProps) {
  const [mode, setMode] = useState<BatchMode>(() => (readDraft('batch_mode') as BatchMode) || 'variants');
  const [brief, setBrief] = useState(() => readDraft('batch_brief'));
  const [taskText, setTaskText] = useState(() => readDraft('batch_tasks'));
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [styleId, setStyleId] = useState(() => readDraft('batch_style'));
  const [count, setCount] = useState(() => clampInt(Number(readDraft('batch_count')), 2, MAX_BATCH_COUNT, 4));
  const [config, setConfig] = useState<GenerationConfig>(() => {
    const size = resolveSize((readDraft('batch_aspect_ratio') as GenerationConfig['aspectRatio']) || '1:1');
    return {
      mode: 'text',
      generationMode: 'images',
      imageModel: 'gpt-image-2',
      prompt: '',
      imageCount: 1,
      aspectRatio: (readDraft('batch_aspect_ratio') as GenerationConfig['aspectRatio']) || '1:1',
      sizeTier: '1K',
      requestSize: size.size,
      sizeHint: size.hint,
      quality: (readDraft('batch_quality') as GenerationConfig['quality']) || 'auto',
      background: 'auto',
      outputFormat: (readDraft('batch_output_format') as GenerationConfig['outputFormat']) || 'auto',
      outputCompression: 90,
      refImages: [],
    };
  });
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const selectedStyle = useMemo(() => findImageStyle(styleId), [styleId]);
  const tasks = useMemo(() => {
    if (mode === 'board') return brief.trim() ? [{ title: '分镜套图', prompt: brief.trim() }] : [];
    if (mode === 'variants') return parseTaskLines(taskText).slice(0, MAX_BATCH_COUNT);
    return parseTaskLines(taskText || brief).slice(0, MAX_BATCH_COUNT);
  }, [brief, mode, taskText]);
  const plannedCount = mode === 'board' ? (brief.trim() ? 1 : 0) : Math.max(0, Math.min(mode === 'multiTopic' ? tasks.length : count, MAX_BATCH_COUNT));

  const seriesResults = useMemo(() => results.filter((record) => record.kind === 'series' && submittedIds.includes(record.id)), [results, submittedIds]);
  const seriesJobs = useMemo(() => jobs.filter((job) => {
    const context = job.clientContext;
    if (!context || context.kind !== 'series') return false;
    return submittedIds.includes(context.placeholderId || job.id);
  }), [jobs, submittedIds]);

  // 草稿持久化
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeDraft('batch_mode', mode);
      writeDraft('batch_brief', brief);
      writeDraft('batch_tasks', taskText);
      writeDraft('batch_style', styleId);
      writeDraft('batch_count', String(count));
      writeDraft('batch_aspect_ratio', config.aspectRatio);
      writeDraft('batch_quality', config.quality);
      writeDraft('batch_output_format', config.outputFormat);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [brief, config.aspectRatio, config.outputFormat, config.quality, count, mode, styleId, taskText]);

  useEffect(() => {
    if (mode === 'board' && !styleId) setStyleId('product-storyboard');
  }, [mode, styleId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setConfig((current) => {
      const size = resolveSize(current.aspectRatio, current.sizeTier);
      if (current.requestSize === size.size) return current;
      return { ...current, requestSize: size.size, sizeHint: size.hint };
    });
  }, [config.aspectRatio, config.sizeTier]);

  async function optimizePrompt() {
    if (!brief.trim()) throw new Error('请先填写主题描述');
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
      setToast({ type: 'success', message: '提示词已优化, 请确认后提交' });
    } finally {
      setBusy(false);
    }
  }

  function validateBeforeSubmit() {
    if (mode === 'variants' && refs.length === 0) throw new Error('同图变体需要先上传图片或从展馆选择图片');
    if (mode === 'board' && !brief.trim()) throw new Error('请填写分镜套图主题');
    if (mode !== 'board' && tasks.length === 0) throw new Error('请先填写或优化任务清单');
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
        const payload = await buildGenerationPayload({ ...config, prompt, refImages: refs });
        const id = randomId('shot');
        await onSubmit({
          endpoint: '/v1/images/generations',
          body: JSON.stringify(payload),
          contentType: 'application/json',
          clientContext: { kind: 'series', placeholderId: id, prompt: task.prompt, mode: refs.length ? 'reference' : 'text', outputFormat: config.outputFormat },
        });
        nextIds.push(id);
        setSubmittedIds((current) => [id, ...current.filter((item) => item !== id)].slice(0, 36));
        setPendingIds((current) => [id, ...current].slice(0, 36));
      }
      setToast({ type: 'success', message: `已提交 ${nextIds.length} 个任务, 队列会依次生成` });
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
    <div className="series-page">
      <header className="page-head">
        <div className="page-head-copy">
          <h1>系列策划</h1>
          <p>一个主题拆一批分镜, 逐张提交按队列顺序生成</p>
        </div>
      </header>

      <section className="series-toolbar" aria-label="系列工作流">
        <div className="series-toolbar-row">
          <div className="series-mode-seg" role="tablist" aria-label="系列类型">
            {(Object.entries(MODE_META) as Array<[BatchMode, typeof MODE_META[BatchMode]]>).map(([key, item]) => (
              <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''} onClick={() => { setMode(key); setTaskText(''); if (key !== 'board') setCount(4); }}>
                {item.label}
              </button>
            ))}
          </div>

          {mode !== 'board' && (
            <div className="shot-stepper">
              <span className="stepper-label">共</span>
              <button type="button" className="stepper-btn" disabled={count <= 2} onClick={() => setCount((c) => Math.max(2, c - 1))} aria-label="减少张数"><Minus size={14} /></button>
              <span className="stepper-value">{count}</span>
              <button type="button" className="stepper-btn" disabled={count >= MAX_BATCH_COUNT} onClick={() => setCount((c) => Math.min(MAX_BATCH_COUNT, c + 1))} aria-label="增加张数"><Plus size={14} /></button>
              <span className="stepper-label">张</span>
            </div>
          )}

          <div className="chip chip-accent" title="预计提交数量"><span className="dot" aria-hidden="true" />预计 {plannedCount || 0} 张</div>
        </div>

        <div className="series-theme-row">
          <div className="field">
            <textarea
              className="series-content-input"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={MODE_META[mode].placeholder}
              aria-label="主题描述"
              rows={3}
              style={{ minHeight: 92 }}
            />
          </div>
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || !brief.trim()} onClick={() => { void runAction(optimizePrompt); }}>
            {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Wand2 size={16} aria-hidden="true" />}
            {busy ? '拆解中...' : '自动拆解'}
          </button>
        </div>
      </section>

      <div className="series-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
        <aside className="control-rail" style={{ position: 'sticky', top: 'calc(var(--top-bar-h) + 20px)' }} aria-label="系列参数">
          <StyleQuickPicker styleId={styleId} onSelect={setStyleId} />
          {mode === 'variants' && (
            <ReferencePanel images={refs} onChange={setRefs} galleryRecords={results} maxImages={1} singleMode />
          )}
          <ParamsPanel
            config={{ ...config, imageCount: 1, prompt: brief }}
            onChange={(patch) => setConfig((current) => ({ ...current, ...patch }))}
            onSubmit={() => { void runAction(submitBatch); }}
            submitting={submitting}
            promptEmpty={plannedCount === 0}
          />
        </aside>

        <section aria-label="分镜任务">
          {tasks.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 280 }}>
              <LayoutDashboard className="empty-icon" size={28} aria-hidden="true" />
              <strong>还没有分镜清单</strong>
              <span>填写主题后点击「自动拆解」, 或在左侧直接输入每行一个主题</span>
            </div>
          ) : (
            <div className="shot-grid">
              {tasks.slice(0, mode === 'board' ? 1 : MAX_BATCH_COUNT).map((task, index) => (
                <article key={`${task.title}-${index}`} className={`shot-card ${index < seriesResults.length ? '' : 'pending'}`}>
                  <div className="shot-card-head">
                    <div className="shot-id-row">
                      <span className="shot-badge">{index + 1}</span>
                      <h3 title={task.title}>{task.title}</h3>
                    </div>
                    <span className="chip">待提交</span>
                  </div>
                  <p className="shot-desc" title={task.prompt}>{task.prompt}</p>
                  <div className="shot-card-foot">
                    <span className="foot-actions">
                      <button type="button" className="link-btn" onClick={() => setTaskText((current) => {
                        const lines = current.split('\n');
                        if (index < lines.length) lines.splice(index, 1, `${task.title}: ${task.prompt}`);
                        return lines.join('\n');
                      })}>编辑</button>
                    </span>
                    <span className="foot-actions">
                      <button type="button" className="link-btn danger" onClick={() => setTaskText((current) => {
                        const lines = current.split('\n').filter(Boolean);
                        const normalized = lines.map((line) => line.trim()).indexOf(`${task.title}: ${task.prompt}`) >= 0 ? lines.indexOf(`${task.title}: ${task.prompt}`) : lines.findIndex((line) => line.trim() === `${task.title}: ${task.prompt}`);
                        if (normalized >= 0) lines.splice(normalized, 1);
                        return lines.join('\n');
                      })}>移除</button>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}

          {seriesResults.length + seriesJobs.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="result-stream-head">
                <div className="page-head-copy">
                  <h2 className="t-headline-sm">本次批量结果</h2>
                  <p>{seriesResults.length} 张已完成</p>
                </div>
              </div>
              <ResultStream records={seriesResults} jobs={seriesJobs} pendingIds={pendingIds} onDismiss={(id) => setSubmittedIds((c) => c.filter((item) => item !== id))} />
            </div>
          )}
        </section>
      </div>

      {toast && <div className={`toast ${toast.type}`} role="status" aria-live="polite">{toast.message}</div>}
    </div>
  );
}
