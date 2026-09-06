import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenText, Brush, Download, Minus, Plus, RefreshCw, Sparkles, Trash2, ZoomIn,
} from 'lucide-react';
import type { AspectRatio, GenerationConfig, ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import type { QueueSubmitInput } from '../lib/api/queue';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { requestTextGeneration } from '../lib/api/text';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { applyAnyImageStyleToPrompt, findImageStyle } from '../lib/styles/image-styles';
import { ToastStack } from '../components/shell/QueueDrawer';

/* ============ 系列策划 (照搬 Stitch 系列策划稿, 类名原样) ============ */

export interface SeriesStudioProps {
  onSubmit: (input: QueueSubmitInput) => Promise<QueueJob>;
  results: ResultRecord[];
  jobs: QueueJob[];
}

type ScenarioTemplate = 'picture-book' | 'ecommerce' | 'video-board' | 'brand-ip';

interface BatchTask {
  title: string;
  prompt: string;
}

const MAX_BATCH_COUNT = 8;
const MIN_BATCH_COUNT = 3;

/** 场景模版 (稿: 绘本连环画/电商长图/视频分镜/品牌IP延展) — 映射旧 BatchMode 逻辑 */
const TEMPLATES: { id: ScenarioTemplate; label: string; mode: 'variants' | 'multiTopic' | 'board'; tip: string }[] = [
  { id: 'picture-book', label: '绘本连环画', mode: 'multiTopic', tip: '一个故事拆多幕, 每幕一张' },
  { id: 'ecommerce', label: '电商长图', mode: 'multiTopic', tip: '分段卖点, 统一风格输出' },
  { id: 'video-board', label: '视频分镜', mode: 'multiTopic', tip: '镜头语言拆解连贯画面' },
  { id: 'brand-ip', label: '品牌IP延展', mode: 'board', tip: '角色资料卡 / 九宫格大图' },
];

const ASPECTS: { id: AspectRatio; label: string; tip: string }[] = [
  { id: '16:9', label: '16:9', tip: '宽景分镜' },
  { id: '3:4', label: '3:4', tip: '画册立轴' },
  { id: '1:1', label: '1:1', tip: '方形插画' },
  { id: '9:16', label: '9:16', tip: '移动全屏' },
];

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseTaskLines(value: string): BatchTask[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const normalized = line.replace(/^[-*\d.、\s]+/, '').trim();
    const separator = normalized.includes('：') ? '：' : normalized.includes(':') ? ':' : '';
    if (!separator) return { title: normalized.slice(0, 28), prompt: normalized };
    const [title, ...rest] = normalized.split(separator);
    return { title: title.trim() || '未命名分镜', prompt: rest.join(separator).trim() || normalized };
  });
}

function buildSplitSystem(count: number) {
  return `你是 AI 分镜拆解器。用户会提供一段故事或主题。请拆成 ${count} 条可直接用于文生图的分镜任务。只输出多行文本, 每行格式为“分镜名称: 具体画面描述”。相邻分镜必须保持主体外貌、色彩基调与画风一致。禁止 Markdown, 禁止编号, 禁止解释。`;
}

type ShotState =
  | { kind: 'done'; task: BatchTask; record: ResultRecord }
  | { kind: 'generating'; task: BatchTask }
  | { kind: 'waiting'; task: BatchTask }
  | { kind: 'planned'; task: BatchTask };

function templateOf(mode: string): ScenarioTemplate {
  if (mode === 'board') return 'brand-ip';
  return 'picture-book';
}

export function SeriesStudio({ onSubmit, results, jobs }: SeriesStudioProps) {
  const [template, setTemplate] = useState<ScenarioTemplate>(() => (readDraft('batch_template') as ScenarioTemplate) || 'picture-book');
  const [brief, setBrief] = useState(() => readDraft('batch_brief'));
  const [taskText, setTaskText] = useState(() => readDraft('batch_tasks'));
  const [styleId, setStyleId] = useState(() => readDraft('batch_style'));
  const [count, setCount] = useState(() => clampInt(Number(readDraft('batch_count')), MIN_BATCH_COUNT, MAX_BATCH_COUNT, 4));
  const [config, setConfig] = useState<GenerationConfig>(() => {
    const ratio = (readDraft('batch_aspect_ratio') as GenerationConfig['aspectRatio']) || '16:9';
    const size = resolveSize(ratio);
    return {
      mode: 'text',
      generationMode: 'images',
      imageModel: 'gpt-image-2',
      prompt: '',
      imageCount: 1,
      aspectRatio: ratio,
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
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);

  const mode = useMemo(() => TEMPLATES.find((t) => t.id === template)?.mode ?? 'multiTopic', [template]);
  const selectedStyle = useMemo(() => findImageStyle(styleId), [styleId]);
  const tasks = useMemo(() => {
    if (mode === 'board') return brief.trim() ? [{ title: '分镜套图', prompt: brief.trim() }] : [];
    return parseTaskLines(taskText || brief).slice(0, MAX_BATCH_COUNT);
  }, [brief, mode, taskText]);

  const submittedIds = useMemo(() => new Set(tasks.map(() => '')), [tasks]);
  const seriesResults = useMemo(() => results.filter((r) => r.kind === 'series').slice(0, 12), [results]);
  const seriesJobs = useMemo(() => jobs.filter((j) => j.clientContext?.kind === 'series'), [jobs]);

  const pushToast = (type: 'info' | 'success' | 'error', message: string) => {
    const id = randomId();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200);
  };

  // 草稿持久化
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeDraft('batch_template', template);
      writeDraft('batch_brief', brief);
      writeDraft('batch_tasks', taskText);
      writeDraft('batch_style', styleId);
      writeDraft('batch_count', String(count));
      writeDraft('batch_aspect_ratio', config.aspectRatio);
      writeDraft('batch_quality', config.quality);
      writeDraft('batch_output_format', config.outputFormat);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [brief, config.aspectRatio, config.outputFormat, config.quality, count, styleId, taskText, template]);

  useEffect(() => {
    if (mode === 'board' && !styleId) setStyleId('product-storyboard');
  }, [mode, styleId]);

  async function splitStory() {
    if (!brief.trim()) { pushToast('info', '先写下故事梗概再拆解'); return; }
    setBusy(true);
    try {
      const response = await requestTextGeneration(
        buildSplitSystem(count),
        `故事梗概: ${brief}\n分镜数量: ${count}\n统一风格: ${selectedStyle?.name || '自然水彩'}`,
      );
      const optimized = response.text.trim();
      if (!optimized) throw new Error('拆解结果为空');
      setTaskText(optimized);
      pushToast('success', '已拆解分镜, 可逐条微调后提交');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : '拆解失败, 请重试');
    } finally {
      setBusy(false);
    }
  }

  async function submitBatch() {
    if (mode === 'board' && !brief.trim()) { pushToast('error', '请填写分镜套图主题'); return; }
    if (mode !== 'board' && tasks.length === 0) { pushToast('error', '请先填写或拆解任务清单'); return; }
    setSubmitting(true);
    try {
      const submitTasks = mode === 'board' ? [{ title: '分镜套图', prompt: brief.trim() }] : tasks.slice(0, MAX_BATCH_COUNT);
      const seriesId = randomId('series');
      for (const task of submitTasks) {
        const prompt = applyAnyImageStyleToPrompt(task.prompt, selectedStyle);
        const payload = await buildGenerationPayload({ ...config, prompt });
        await onSubmit({
          endpoint: '/v1/images/generations',
          body: JSON.stringify(payload),
          contentType: 'application/json',
          clientContext: {
            kind: 'series',
            placeholderId: randomId('shot'),
            prompt: task.prompt,
            mode: 'text',
            outputFormat: config.outputFormat,
            seriesId,
            masterPrompt: brief.trim(),
          },
        });
      }
      pushToast('success', `已提交 ${submitTasks.length} 幕, 队列按序生成`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  // ⌘+Enter
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void submitBatch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 分镜状态: 已完成 / 生成中 / 排队 / 计划中
  const shots: ShotState[] = useMemo(() => {
    const doneCount = seriesResults.length;
    const genCount = seriesJobs.filter((j) => j.status === 'running').length;
    const waitCount = seriesJobs.filter((j) => j.status === 'pending').length;
    const planned = mode === 'board'
      ? (brief.trim() ? [{ title: '分镜套图', prompt: brief.trim() }] : [])
      : tasks.length ? tasks : Array.from({ length: count }, (_, i) => ({ title: `分镜 ${String(i + 1).padStart(2, '0')}`, prompt: '' }));
    const out: ShotState[] = [];
    planned.forEach((task, i) => {
      if (i < doneCount) out.push({ kind: 'done', task, record: seriesResults[i] });
      else if (i < doneCount + genCount) out.push({ kind: 'generating', task });
      else if (i < doneCount + genCount + waitCount) out.push({ kind: 'waiting', task });
      else out.push({ kind: 'planned', task });
    });
    return out;
  }, [seriesResults, seriesJobs, tasks, count, mode, brief]);

  const shotLabel = `分镜矩阵看板`;
  const plannedTotal = shots.length;

  return (
    <main className="w-full pt-16 bg-surface min-h-[calc(100vh-4rem)]">
      <div className="flex flex-col w-full">
        <div className="w-full px-gutter-canvas py-space-lg max-w-[1720px] mx-auto flex flex-col gap-space-lg">

          {/* Section 1: 故事脚本与系列设定工作台 */}
          <section className="w-full bg-surface-container-lowest/90 backdrop-blur-md rounded-2xl p-space-lg lg:p-space-xl border border-outline-variant/30 shadow-[0_4px_24px_rgba(85,95,75,0.05)] flex flex-col gap-space-lg">
            {/* 标题与状态 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-sm border-b border-outline-variant/20">
              <div className="flex items-center gap-space-sm">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                  <BookOpenText size={22} aria-hidden />
                </div>
                <div>
                  <div className="flex items-center gap-space-xs">
                    <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">故事脚本与系列设定工作台</h1>
                    <span className="px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm font-medium">连贯生成模式已开启</span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">设定完整叙事大纲，AI 智能分镜算法将锁定角色外貌特征、光影色温与画面笔触统一输出</p>
                </div>
              </div>
              <div className="flex items-center gap-space-xs text-on-surface-variant font-meta-sm text-meta-sm self-start sm:self-center">
                <span className="flex items-center gap-1 bg-surface-container-low px-2.5 py-1 rounded-lg">
                  <span className={`w-2 h-2 rounded-full ${busy ? 'bg-primary animate-pulse' : 'bg-primary'}`} />
                  统一特征锁: <span className="text-primary font-medium">{selectedStyle?.name || '主角色 & 树林调性'}</span>
                </span>
              </div>
            </div>

            {/* 左叙事编辑 / 右系统参数 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-stretch">
              {/* 左: 叙事编辑 */}
              <div className="lg:col-span-7 flex flex-col justify-between bg-surface-container-low/40 rounded-xl p-space-md border border-outline-variant/25">
                <div className="flex items-center justify-between mb-space-xs">
                  <label className="flex items-center gap-1.5 font-body-sm text-body-sm font-medium text-on-surface" htmlFor="series-story-prompt">
                    <Sparkles size={18} className="text-primary" aria-hidden />
                    系列故事梗概 / 分段分镜剧本
                  </label>
                  <div className="flex items-center gap-2">
                    <button type="button" className="text-primary hover:text-on-primary-fixed-variant text-body-sm font-meta-sm flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-surface-container" onClick={() => setBrief('秋日微风吹拂金色落叶，一只背着编织草袋的小狐狸从橡树洞轻快出发。在斑驳晨光中穿过落叶小径，在青苔岩石下意外拾得一颗金光闪烁的神秘松果。随着夕阳西斜，它与林间小雀同聚在壁炉木屋前，享用热烘坚果茶。')}>
                      灵感示例: 森林秋日拾果
                    </button>
                    <button type="button" className="text-on-surface-variant hover:text-error text-body-sm font-meta-sm transition-colors px-1 py-0.5" onClick={() => { setBrief(''); setTaskText(''); }}>清空</button>
                  </div>
                </div>
                <div className="relative flex-1">
                  <textarea
                    className="w-full h-36 lg:h-40 p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/40 focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface font-body-md text-body-md leading-relaxed resize-none transition-all placeholder:text-outline/60"
                    id="series-story-prompt"
                    maxLength={1000}
                    placeholder="请输入连贯故事梗概、电商分段卖点叙事、短视频分镜脚本等。例如：秋日微风吹拂金色森林，穿小背心的小狐狸在树洞整理草编背篓，漫步前往山谷清泉探寻发光的松果..."
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-outline-variant/20 text-on-surface-variant">
                  <div className="flex items-center gap-2 font-meta-sm text-meta-sm">
                    <span className="flex items-center gap-1 text-primary">
                      <Sparkles size={15} aria-hidden />
                      分段解析引擎: 自然分句模式
                    </span>
                    <span className="text-outline">·</span>
                    <span>支持多句自然句号切分分镜</span>
                  </div>
                  <span className="font-meta-sm text-meta-sm text-outline">{brief.length} / 1000 字</span>
                </div>
              </div>

              {/* 右: 系统参数 */}
              <div className="lg:col-span-5 flex flex-col justify-between gap-space-md bg-surface-container-low/40 rounded-xl p-space-md border border-outline-variant/25">
                {/* 场景模版 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-body-sm text-body-sm font-medium text-on-surface flex items-center gap-1">
                      <BookOpenText size={16} className="text-primary" aria-hidden />
                      应用场景模版
                    </span>
                    <span className="font-meta-sm text-meta-sm text-on-surface-variant">自动适配构图叙事逻辑</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {TEMPLATES.map((tpl) => {
                      const active = template === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          title={tpl.tip}
                          className={active
                            ? 'px-2.5 py-1.5 rounded-lg bg-primary text-on-primary font-medium text-body-sm text-center shadow-xs flex items-center justify-center gap-1'
                            : 'px-2.5 py-1.5 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-body-sm text-center border border-outline-variant/30 transition-colors'}
                          onClick={() => { setTemplate(tpl.id); setTaskText(''); }}
                        >
                          {tpl.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 幕数 + 风格锁定 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-body-sm text-body-sm font-medium text-on-surface flex items-center gap-1">
                      <Plus size={16} className="text-primary" aria-hidden />
                      镜头画幅数量
                    </span>
                    <div className="flex items-center justify-between bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-3 py-1.5">
                      <span className="font-meta-sm text-meta-sm text-on-surface-variant">连贯画幅</span>
                      <div className="flex items-center gap-1">
                        <button type="button" className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-container text-on-surface transition-colors" title="减少镜头" onClick={() => setCount((c) => Math.max(MIN_BATCH_COUNT, c - 1))} disabled={count <= MIN_BATCH_COUNT}>
                          <Minus size={14} aria-hidden />
                        </button>
                        <span className="font-meta-md text-meta-md font-semibold text-on-surface px-2">{count}</span>
                        <button type="button" className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-container text-on-surface transition-colors" title="增加镜头" onClick={() => setCount((c) => Math.min(MAX_BATCH_COUNT, c + 1))} disabled={count >= MAX_BATCH_COUNT}>
                          <Plus size={14} aria-hidden />
                        </button>
                      </div>
                      <span className="font-meta-sm text-meta-sm text-outline">步进 ({MIN_BATCH_COUNT}~{MAX_BATCH_COUNT})</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-body-sm text-body-sm font-medium text-on-surface flex items-center gap-1">
                      <Brush size={16} className="text-primary" aria-hidden />
                      主体特征锁定 / 基底
                    </span>
                    <button
                      type="button"
                      className="flex items-center justify-between bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-3 py-1.5 hover:border-primary/50 transition-colors text-left group"
                      title="在风格库选择锁定风格"
                      onClick={() => document.querySelector<HTMLAnchorElement>('nav a[data-path="styles"]')?.click()}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="w-3.5 h-3.5 rounded-full bg-[#E5B582] border border-outline-variant/30 flex-shrink-0" />
                        <span className="font-body-sm text-body-sm text-on-surface font-medium truncate">{selectedStyle?.name || '未锁定 (可选)'}</span>
                      </div>
                      <RefreshCw size={16} className="text-primary group-hover:text-on-surface transition-colors" aria-hidden />
                    </button>
                  </div>
                </div>

                {/* 统一画幅 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-body-sm text-body-sm font-medium text-on-surface flex items-center gap-1">
                      <BookOpenText size={16} className="text-primary" aria-hidden />
                      连贯性统一画幅
                    </span>
                    <span className="font-meta-sm text-meta-sm text-outline">全部镜头统一尺寸</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ASPECTS.map((aspect) => {
                      const active = config.aspectRatio === aspect.id;
                      return (
                        <button
                          key={aspect.id}
                          type="button"
                          className={active
                            ? 'flex flex-col items-center justify-center py-1 px-1 rounded-lg bg-secondary-container text-on-secondary-container border border-primary/30 text-center'
                            : 'flex flex-col items-center justify-center py-1 px-1 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant border border-outline-variant/30 text-center transition-colors'}
                          onClick={() => setConfig((current) => ({ ...current, aspectRatio: aspect.id }))}
                        >
                          <span className="font-meta-md text-meta-sm font-semibold leading-none">{aspect.label}</span>
                          <span className={`text-[10px] mt-0.5 ${active ? 'text-on-secondary-container/80' : 'text-outline'}`}>{aspect.tip}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* 底部动作栏 */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-space-sm pt-space-xs border-t border-outline-variant/20">
              <div className="flex items-center gap-space-xs text-on-surface-variant font-meta-sm text-meta-sm">
                <span className="flex items-center gap-1">
                  渲染精度: <strong className="text-on-surface font-medium">{config.quality === 'high' ? '高清 HD' : '标准'}</strong>
                </span>
                <span className="text-outline">·</span>
                <span>输出格式: <strong className="text-on-surface font-medium">{(config.outputFormat === 'auto' ? 'png' : config.outputFormat).toUpperCase()}</strong></span>
              </div>
              <div className="flex flex-wrap items-center gap-space-xs">
                <button type="button" className="flex items-center gap-1 px-space-md py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-body-sm text-body-sm transition-colors border border-outline-variant/30" onClick={() => { void splitStory(); }} disabled={busy}>
                  <Sparkles size={18} aria-hidden />
                  <span>{busy ? '拆解中...' : 'AI 拆解分镜'}</span>
                </button>
                <button type="button" className="flex items-center gap-1 px-space-md py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-body-sm text-body-sm transition-colors border border-outline-variant/30" disabled>
                  <Download size={18} aria-hidden />
                  <span>打包导出全部分镜</span>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-space-lg py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-medium text-body-md shadow-[0_2px_10px_rgba(65,91,47,0.25)] transition-all disabled:opacity-60"
                  onClick={() => { void submitBatch(); }}
                  disabled={submitting}
                >
                  <Sparkles size={20} aria-hidden />
                  <span>{submitting ? '提交中...' : '智能拆解并同步全系列分镜'}</span>
                  <span className="px-1.5 py-0.2 bg-white/20 rounded font-meta-sm text-[10px]">⌘ + Enter</span>
                </button>
              </div>
            </div>
          </section>

          {/* Section 2: 分镜矩阵看板 */}
          <section className="w-full flex flex-col gap-space-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{shotLabel}</h2>
                <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-meta-sm text-meta-sm">{plannedTotal} 幕连贯规划</span>
              </div>
              <div className="flex items-center gap-space-xs text-body-sm text-on-surface-variant font-meta-sm">
                <span className="flex items-center gap-1 text-primary font-medium">
                  <BookOpenText size={16} aria-hidden />
                  分镜卡片流
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-lg">
              {shots.map((shot, index) => {
                const num = String(index + 1).padStart(2, '0');
                if (shot.kind === 'done') {
                  return (
                    <article key={shot.record.id} className="flex flex-col bg-surface-container-lowest rounded-2xl shadow-[0_2px_16px_rgba(85,95,75,0.06)] hover:shadow-md transition-all border border-outline-variant/30 group overflow-hidden">
                      <div className="p-space-md border-b border-outline-variant/15 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-primary text-on-primary font-meta-sm text-meta-sm flex items-center justify-center font-bold">{num}</span>
                          <div>
                            <h3 className="font-body-md text-body-md font-semibold text-on-surface leading-tight truncate">{shot.task.title}</h3>
                            <span className="font-meta-sm text-meta-sm text-outline">已完成 · {shot.record.prompt.slice(0, 12)}</span>
                          </div>
                        </div>
                        <span className="font-meta-sm text-meta-sm text-primary font-medium flex items-center gap-1 bg-primary-fixed/40 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />已就绪
                        </span>
                      </div>
                      <div className="w-full aspect-video bg-surface-container-low relative group overflow-hidden">
                        <img alt={shot.task.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" src={shot.record.dataUrl} />
                        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-inverse-surface/75 text-inverse-on-surface font-meta-sm text-[10px]">
                          {config.requestSize} · {config.aspectRatio}
                        </div>
                        <div className="absolute inset-0 bg-inverse-surface/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-space-xs backdrop-blur-xs">
                          <button type="button" className="w-9 h-9 rounded-full bg-surface text-on-surface flex items-center justify-center hover:scale-110 transition-transform shadow-sm" title="全屏预览大图" onClick={() => window.open(shot.record.dataUrl, '_blank')}>
                            <ZoomIn size={18} aria-hidden />
                          </button>
                        </div>
                      </div>
                      <div className="p-space-md flex-1 flex flex-col justify-between gap-space-sm">
                        <div>
                          <label className="block font-meta-sm text-meta-sm text-outline mb-1">分镜画面提示词 (Prompt)</label>
                          <textarea className="w-full bg-surface-container-low/60 rounded-lg p-2 font-body-sm text-body-sm text-on-surface border border-outline-variant/30 focus:border-primary focus:bg-surface-container-lowest transition-colors resize-none leading-relaxed" rows={3} value={shot.task.prompt} readOnly />
                        </div>
                        <div className="flex items-center justify-between pt-space-xs border-t border-outline-variant/20 font-meta-sm text-meta-sm text-on-surface-variant">
                          <span>面部连续性锁定</span>
                        </div>
                      </div>
                    </article>
                  );
                }
                if (shot.kind === 'generating' || shot.kind === 'waiting') {
                  const generating = shot.kind === 'generating';
                  return (
                    <article key={`job-${index}`} className={`flex flex-col bg-surface-container-lowest rounded-2xl shadow-[0_2px_16px_rgba(85,95,75,0.06)] group overflow-hidden relative ${generating ? 'border-2 border-primary/40' : 'border border-outline-variant/30'}`}>
                      <div className={`p-space-md border-b border-outline-variant/15 flex items-center justify-between ${generating ? 'bg-primary/5' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-6 h-6 rounded-full font-meta-sm text-meta-sm flex items-center justify-center font-bold ${generating ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-container-high text-on-surface-variant'}`}>{num}</span>
                          <div>
                            <h3 className="font-body-md text-body-md font-semibold text-on-surface leading-tight truncate">{shot.task.title}</h3>
                            <span className={`font-meta-sm text-meta-sm ${generating ? 'text-primary font-medium' : 'text-outline'}`}>{generating ? '队列渲染中' : '等待队列'}</span>
                          </div>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full font-meta-sm text-meta-sm flex items-center gap-1 font-medium ${generating ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>
                          <span className={`w-2 h-2 rounded-full bg-primary ${generating ? 'animate-ping' : ''}`} />
                          {generating ? '渲染中' : '排队中'}
                        </span>
                      </div>
                      <div className="w-full aspect-video bg-surface-container-low relative flex flex-col items-center justify-center p-space-md overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-secondary-container/20 to-transparent animate-pulse" />
                        <div className="relative z-10 flex flex-col items-center">
                          <div className="w-14 h-14 rounded-full bg-surface-container-lowest/80 backdrop-blur-md shadow-md flex items-center justify-center text-primary mb-2">
                            <Sparkles className="animate-bounce" size={24} aria-hidden />
                          </div>
                          <p className="font-meta-sm text-meta-sm text-on-surface-variant">{generating ? '正在渲染本镜画面' : `等待前序镜头完成`}</p>
                        </div>
                      </div>
                      <div className="p-space-md flex-1 flex flex-col justify-between gap-space-sm">
                        <div>
                          <label className="block font-meta-sm text-meta-sm text-outline mb-1">分镜画面提示词 (Prompt)</label>
                          <textarea className="w-full bg-surface-container-low/60 rounded-lg p-2 font-body-sm text-body-sm text-on-surface border border-outline-variant/30 focus:border-primary transition-colors resize-none leading-relaxed" rows={3} value={shot.task.prompt} readOnly />
                        </div>
                        <div className="flex items-center justify-between pt-space-xs border-t border-outline-variant/20 font-meta-sm text-meta-sm text-on-surface-variant">
                          <span>按队列顺序生成</span>
                          <span className="text-outline">—</span>
                        </div>
                      </div>
                    </article>
                  );
                }
                // planned
                return (
                  <article key={`plan-${index}`} className="flex flex-col bg-surface-container-lowest/60 rounded-2xl shadow-[0_2px_16px_rgba(85,95,75,0.04)] border border-dashed border-outline-variant/40 group overflow-hidden">
                    <div className="p-space-md border-b border-outline-variant/15 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-surface-container-high text-on-surface-variant font-meta-sm text-meta-sm flex items-center justify-center font-bold">{num}</span>
                        <div>
                          <h3 className="font-body-md text-body-md font-semibold text-on-surface leading-tight truncate">{shot.task.title}</h3>
                          <span className="font-meta-sm text-meta-sm text-outline">待拆解 / 待提交</span>
                        </div>
                      </div>
                    </div>
                    <div className="w-full aspect-video bg-surface-container-low/40 relative flex items-center justify-center p-space-md">
                      <textarea
                        className="w-full h-full bg-transparent text-on-surface-variant font-body-sm text-body-sm resize-none border-0 outline-none placeholder:text-outline/50"
                        placeholder="本镜画面描述 (拆解后自动填入, 也可手写)"
                        value={shot.task.prompt}
                        onChange={(event) => {
                          const lines = (taskText || brief).split('\n');
                          while (lines.length <= index) lines.push('');
                          lines[index] = event.target.value;
                          setTaskText(lines.join('\n'));
                        }}
                      />
                    </div>
                    <div className="p-space-md flex-1 flex flex-col justify-between gap-space-sm">
                      <div className="flex items-center justify-between pt-space-xs font-meta-sm text-meta-sm text-on-surface-variant">
                        <span className="text-outline">提交后进入队列</span>
                        <button type="button" className="text-outline hover:text-error transition-colors flex items-center gap-1 py-0.5" onClick={() => setCount((c) => Math.max(MIN_BATCH_COUNT, c - 1))}>
                          <Trash2 size={14} aria-hidden />
                          <span>缩减规划</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </div>
      <ToastStack toasts={toasts} />
    </main>
  );
}
