import { useRef } from 'react';
import { BookOpenText, Download, Minus, Plus, RefreshCw, Sparkles, Trash2, ZoomIn } from '../components/ui/icons';
import type { ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import { resolveSize } from '../lib/api/generation';
import { StitchIcon } from '../components/ui/StitchIcon';
import { StitchGalleryViewer } from '../components/gallery/StitchGalleryViewer';
import { ToastStack } from '../components/shell/QueueDrawer';
import { SceneEditor } from '../components/series/SceneEditor';
import { SeriesReferences } from '../components/series/SeriesReferences';
import { RecordImage } from '../components/gallery/RecordImage';
import { useSeriesStudio, seriesAspects, MIN_BATCH_COUNT, MAX_BATCH_COUNT, type SeriesActions } from '../hooks/useSeriesStudio';
import { MAX_SERIES_BRIEF_LENGTH, MAX_SCENE_PROMPT_LENGTH } from '../../shared/series-planning.mjs';
import { useCredits } from '../lib/credits';
import { CreditStatus } from '../components/ui/CreditStatus';
import { CreditCost } from '../components/ui/CreditCost';
import { deliveryMessage, personalQueuePosition } from '../lib/queue-presentation';
import { QueueElapsed } from '../components/queue/QueueElapsed';

export interface SeriesStudioProps extends SeriesActions {
  onEditRecord: (record: ResultRecord) => void;
  onUseRecipe: (record: ResultRecord) => void;
  onUseAsRef: (record: ResultRecord) => void;
  onRetry: (jobId: string) => Promise<QueueJob>;
  onCancel: (jobId: string) => Promise<void>;
  onPrioritize: (jobId: string) => Promise<void>;
}

export function SeriesStudio(props: SeriesStudioProps) {
  const { prices } = useCredits();
  const { onEditRecord, onUseRecipe, onRetry, onCancel, onPrioritize } = props;
  const { ready, brief, setBrief, count, setCount, config, setConfig, busy, submitting, referenceBusy, toasts, pushToast, seriesId, seriesResults, allSeriesResults, activeJobs, canContinue, submissionCount, metadata, view, setView, preview, setPreview, shots, shotIds, splitStory, submitBatch, exportSeries, updateTask, removeShot, resetSeries, redrawShot, references, maxReferences, removeReference, uploadReferences, editing, setEditing, beginEdit, saveEdit } = useSeriesStudio(props);
  const storyboardRef = useRef<HTMLElement>(null);
  const shotLabel = '分镜看板';
  const plannedTotal = shots.length;
  const filledPrompts = shots.filter((shot) => shot.task.prompt.trim()).length;
  const hasCompletePlan = filledPrompts === plannedTotal;
  const remainingCount = shots.filter((shot) => shot.kind === 'planned').length;
  const failedCount = shots.filter((shot) => shot.kind === 'failed').length;
  const receiptErrorCount = shots.filter((shot) => shot.job?.status === 'succeeded' && shot.job.delivery?.phase === 'error').length;
  const missingFirst = shots[0]?.kind === 'failed' && !shots[0]?.record;
  const planLocked = busy || submitting || referenceBusy || activeJobs || canContinue;
  const formats = props.imageCapabilities?.formats || ['png', 'jpeg', 'webp'];
  const activityLabel = shots.some((shot) => shot.kind === 'submitting') ? '分镜正在提交' : shots.some((shot) => shot.kind === 'generating') ? '分镜正在绘制' : shots.some((shot) => shot.kind === 'waiting') ? '分镜正在排队, 轮到后自动开始' : '正在领取分镜作品';
  async function planStory() {
    if (await splitStory()) {
      requestAnimationFrame(() => storyboardRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    }
  }
  if (!ready) return <main className="stitch-page px-gutter-canvas"><p role="status" className="py-space-xl text-on-surface-variant">正在恢复系列草稿...</p></main>;
  return (
    <main className="stitch-page w-full bg-surface">
      <div className="flex flex-col w-full pb-space-2xl">
        <div className="w-full px-gutter-canvas flex flex-col gap-space-xl pt-space-md">
          {/* Section 1: 故事脚本与系列设定工作台 */}
          <section className="w-full bg-surface-container-lowest/90 backdrop-blur-md rounded-2xl p-space-lg lg:p-space-xl border border-outline-variant/30 shadow-[0_4px_24px_rgba(85,95,75,0.05)] flex flex-col gap-space-lg">
            {/* 标题与状态 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-sm border-b border-outline-variant/20">
              <div className="flex items-center gap-space-sm">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                  <BookOpenText size={22} aria-hidden />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-space-xs">
                    <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">
                      系列创作与生成设置
                    </h1>
                    <span className="px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm font-medium">
                      先拆解, 再确认生成
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                    写下创作需求或分镜剧本, AI 按内容策划, 检查修改后再确认生成
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-space-xs text-on-surface-variant font-meta-sm text-meta-sm self-start sm:self-center">
                <span className="flex items-center gap-1 bg-surface-container-low px-2.5 py-1 rounded-lg">
                  <span className={`w-2 h-2 rounded-full ${busy ? 'bg-primary motion-safe:animate-pulse' : 'bg-primary'}`} />
                  后续分镜参考首镜
                </span>
              </div>
            </div>

            {/* 左叙事编辑 / 右系统参数 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-stretch">
              {/* 左: 叙事编辑 */}
              <div className="lg:col-span-7 flex flex-col justify-between bg-surface-container-low/40 rounded-xl p-space-md border border-outline-variant/25">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-space-xs">
                  <label
                    className="flex items-center gap-1.5 font-body-sm text-body-sm font-medium text-on-surface"
                    htmlFor="series-story-prompt"
                  >
                    <Sparkles size={18} className="text-primary" aria-hidden />
                    创作需求 / 故事梗概 / 分镜剧本
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-primary hover:text-on-primary-fixed-variant text-body-sm font-meta-sm flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-surface-container"
                      disabled={planLocked}
                      onClick={() =>
                        setBrief(
                          '秋日微风吹拂金色落叶，一只背着编织草袋的小狐狸从橡树洞轻快出发。在斑驳晨光中穿过落叶小径，在青苔岩石下意外拾得一颗金光闪烁的神秘松果。随着夕阳西斜，它与林间小雀同聚在壁炉木屋前，享用热烘坚果茶。',
                        )
                      }
                    >
                      灵感示例: 森林秋日拾果
                    </button>
                    <button
                      type="button"
                      className="text-on-surface-variant hover:text-error text-body-sm font-meta-sm transition-colors px-1 py-0.5"
                      onClick={resetSeries}
                      disabled={busy || submitting}
                    >
                      新建系列
                    </button>
                  </div>
                </div>
                <div className="relative flex-1 min-h-52">
                  <textarea
                    className="w-full h-52 lg:h-full p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/40 focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface font-body-md text-body-md leading-relaxed resize-none transition-all placeholder:text-outline/60"
                    id="series-story-prompt"
                    maxLength={MAX_SERIES_BRIEF_LENGTH}
                    placeholder="描述想做的一组图片, 写明主题, 用途, 主体和画风要求. 也可以直接粘贴完整分镜剧本. 有参考图时, 可说明图 1, 图 2 各自的用途."
                    value={brief}
                    disabled={planLocked}
                    onChange={(event) => setBrief(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        if (!event.repeat && !event.nativeEvent.isComposing) void planStory();
                      }
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t border-outline-variant/20 text-on-surface-variant">
                  <div className="flex items-center gap-2 font-meta-sm text-meta-sm">
                    <span className="flex items-center gap-1 text-primary">
                      <Sparkles size={15} aria-hidden />
                      AI 拆解分镜
                    </span>
                    <span className="text-outline">·</span>
                    <span>支持逐镜编辑画面提示词</span>
                  </div>
                  <span className="font-meta-sm text-meta-sm text-outline">{brief.length} / {MAX_SERIES_BRIEF_LENGTH} 字</span>
                </div>
              </div>

              {/* 右: 系统参数 */}
              <div className="lg:col-span-5 flex flex-col justify-between gap-space-md bg-surface-container-low/40 rounded-xl p-space-md border border-outline-variant/25">
                <div className="flex flex-col gap-1.5">
                  <span className="font-body-sm text-body-sm font-medium text-on-surface flex items-center gap-1">
                    <Plus size={16} className="text-primary" aria-hidden />
                    分镜数量
                  </span>
                  <div className="flex items-center justify-between bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-3 py-1.5">
                    <span className="font-meta-sm text-meta-sm text-on-surface-variant">画面数量</span>
                    <div className="flex items-center gap-1">
                      <button type="button" className="w-7 h-7 rounded flex items-center justify-center hover:bg-surface-container text-on-surface disabled:opacity-40" title="减少镜头" onClick={() => setCount((c) => c - 1)} disabled={planLocked || count <= MIN_BATCH_COUNT}><Minus size={14} /></button>
                      <span className="font-meta-md text-meta-md font-semibold text-on-surface px-2">{count}</span>
                      <button type="button" className="w-7 h-7 rounded flex items-center justify-center hover:bg-surface-container text-on-surface disabled:opacity-40" title="增加镜头" onClick={() => setCount((c) => c + 1)} disabled={planLocked || count >= MAX_BATCH_COUNT}><Plus size={14} /></button>
                    </div>
                    <span className="font-meta-sm text-meta-sm text-outline">{MIN_BATCH_COUNT}-{MAX_BATCH_COUNT} 幕</span>
                  </div>
                </div>

                <SeriesReferences references={references} maxReferences={maxReferences} disabled={planLocked} busy={referenceBusy} onUpload={uploadReferences} onRemove={removeReference} />

                {/* 统一画幅 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-body-sm text-body-sm font-medium text-on-surface flex items-center gap-1">
                      <BookOpenText size={16} className="text-primary" aria-hidden />
                      默认画幅
                    </span>
                    <span className="font-meta-sm text-meta-sm text-outline">可逐镜单独调整</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {seriesAspects(props.imageCapabilities?.customSizes, config.aspectRatio).map((aspect) => {
                      const active = config.aspectRatio === aspect.id;
                      return (
                        <button
                          key={aspect.id}
                          type="button"
                          aria-pressed={active}
                          disabled={planLocked}
                          className={
                            active
                              ? 'flex flex-col items-center justify-center py-1 px-1 rounded-lg bg-secondary-container text-on-secondary-container border border-primary/30 text-center'
                              : 'flex flex-col items-center justify-center py-1 px-1 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant border border-outline-variant/30 text-center transition-colors'
                          }
                          onClick={() => {
                            const size = resolveSize(aspect.id, config.sizeTier);
                            setConfig((current) => ({
                              ...current,
                              aspectRatio: aspect.id,
                              requestSize: size.size,
                              sizeHint: size.hint,
                            }));
                          }}
                        >
                          <span className="font-meta-md text-meta-sm font-semibold leading-none">{aspect.label}</span>
                          <span
                            className={`text-[10px] mt-0.5 ${active ? 'text-on-secondary-container/80' : 'text-outline'}`}
                          >
                            {aspect.tip}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* 底部动作栏 */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-space-sm pt-space-xs border-t border-outline-variant/20">
              <div className="flex flex-wrap items-center gap-space-xs text-on-surface-variant font-meta-sm text-meta-sm">
                <span className="flex items-center gap-1">
                  <StitchIcon name="verified" size={16} className="text-primary" />
                  默认质量:{' '}
                  <strong className="text-on-surface font-medium">
                    <select aria-label="系列生成质量" disabled={planLocked} className="bg-transparent disabled:opacity-60" value={config.quality} onChange={(event) => setConfig((current) => ({ ...current, quality: event.target.value as typeof current.quality }))}><option value="auto">自动</option><option value="low">快速</option><option value="medium">标准</option><option value="high">精细</option></select>
                  </strong>
                </span>
                <span className="text-outline">·</span>
                <span>
                  输出格式:{' '}
                  <strong className="text-on-surface font-medium">
                    {formats.length === 1 ? <span aria-label="系列输出格式">{formats[0].toUpperCase()}</span> : <select aria-label="系列输出格式" disabled={planLocked} className="bg-transparent disabled:opacity-60" value={config.outputFormat} onChange={(event) => setConfig((current) => ({ ...current, outputFormat: event.target.value as typeof current.outputFormat }))}>{formats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select>}
                  </strong>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-space-xs">
                {seriesResults.length > 0 && <button
                  type="button"
                  className="flex items-center gap-1 px-space-md py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-body-sm text-body-sm transition-colors border border-outline-variant/30 disabled:opacity-50"
                  onClick={() => {
                    void submitBatch(true);
                  }}
                  disabled={planLocked || !hasCompletePlan || !seriesResults.length}
                >
                  <StitchIcon name="replay" size={18} />
                  <span>批量重新绘制</span>
                  <CreditCost count={plannedTotal} />
                </button>}
                {seriesResults.length > 0 && <button
                  type="button"
                  className="flex items-center gap-1 px-space-md py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-body-sm text-body-sm transition-colors border border-outline-variant/30 disabled:opacity-50"
                  onClick={() => void exportSeries()}
                  disabled={!seriesResults.length}
                >
                  <StitchIcon name="file_download" size={18} />
                  <span>打包导出全部分镜</span>
                </button>}
                <button
                  type="button"
                  className="flex items-center gap-2 px-space-lg py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-medium text-body-md shadow-[0_2px_10px_rgba(65,91,47,0.25)] transition-all disabled:opacity-60"
                  onClick={() => void planStory()}
                  disabled={planLocked || !brief.trim()}
                >
                  <StitchIcon name={busy ? 'progress_activity' : 'edit_note'} size={20} className={busy ? 'motion-safe:animate-spin' : ''} />
                  <span>{busy ? '正在拆解分镜...' : filledPrompts ? '重新拆解分镜' : '智能拆解分镜'}</span>
                  <CreditCost kind="text" />
                </button>
              </div>
            </div>
            {(activeJobs || canContinue) && <p className="font-meta-sm text-meta-sm text-on-surface-variant">本批次已确认. 排队中的分镜可在下方卡片中调整, 生成设置不会随默认值变化.</p>}
          </section>

          {/* Section 2: 分镜矩阵看板 */}
          <section ref={storyboardRef} aria-label="分镜检查与生成" className="w-full flex flex-col gap-space-md scroll-mt-36 lg:scroll-mt-24">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-space-xs">
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{shotLabel}</h2>
                <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-meta-sm text-meta-sm">
                  {receiptErrorCount ? `${receiptErrorCount} 幕领取待重试` : activeJobs ? '分镜处理中' : canContinue ? '剩余分镜待续交' : failedCount ? `${failedCount} 幕生成异常` : remainingCount === 0 ? `${plannedTotal} 幕已完成` : hasCompletePlan ? `${remainingCount} 幕待确认` : `${filledPrompts}/${plannedTotal} 幕已填写`}
                </span>
              </div>
              <div className="flex items-center gap-space-xs text-body-sm text-on-surface-variant font-meta-sm">
                <button
                  type="button"
                  className={`flex items-center gap-1 hover:text-primary ${view === 'timeline' ? 'text-primary font-medium' : ''}`}
                  onClick={() => setView('timeline')}
                  aria-pressed={view === 'timeline'}
                >
                  <StitchIcon name="view_timeline" size={16} />
                  <span>时间轴视图</span>
                </button>
                <span className="text-outline">|</span>
                <button
                  type="button"
                  className={`flex items-center gap-1 hover:text-primary ${view === 'grid' ? 'text-primary font-medium' : ''}`}
                  onClick={() => setView('grid')}
                  aria-pressed={view === 'grid'}
                >
                  <StitchIcon name="grid_view" size={16} />
                  <span>分镜卡片流</span>
                </button>
              </div>
            </div>
            <div
              className={
                view === 'grid'
                  ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-lg'
                  : 'stitch-series-timeline flex gap-space-lg overflow-x-auto pb-4'
              }
            >
              {shots.map((shot, index) => {
                const number = String(index + 1).padStart(2, '0');
                const done = shot.kind === 'done' && shot.record;
                const running = shot.kind === 'generating';
                const waiting = shot.kind === 'waiting';
                const failed = shot.kind === 'failed';
                const sending = shot.kind === 'submitting';
                const unconfirmed = shot.kind === 'unsubmitted';
                const receiving = shot.kind === 'receiving';
                const transferring = sending || receiving;
                const receiptError = shot.job?.status === 'succeeded' && shot.job.delivery?.phase === 'error';
                const working = running || sending || receiving && Boolean(shot.job?.delivery) && !receiptError;
                const receipt = deliveryMessage(shot.job?.delivery);
                const transferLabel = sending ? '正在提交画稿' : unconfirmed ? '提交待确认' : receipt.title;
                const awaitingReview = shot.kind === 'planned' && Boolean(shot.task.prompt.trim());
                const info = shot.record ? metadata[shot.record.id] : undefined;
                return (
                  <article
                    key={shotIds[index] || `plan-${index}`}
                    className={`stitch-shot-card flex flex-col rounded-2xl group overflow-hidden min-w-0 ${view === 'timeline' ? 'shrink-0 w-80' : ''} ${running ? 'bg-surface-container-lowest border-2 border-primary/40 shadow-[0_2px_16px_rgba(85,95,75,0.06)]' : done ? 'bg-surface-container-lowest border border-outline-variant/30 shadow-[0_2px_16px_rgba(85,95,75,0.06)] hover:shadow-md' : failed ? 'bg-surface-container-lowest border border-error/30' : 'bg-surface-container-lowest/80 border border-dashed border-outline-variant/50 shadow-[0_2px_12px_rgba(85,95,75,0.03)]'}`}
                  >
                    <div
                      className={`p-space-md border-b border-outline-variant/15 flex flex-wrap items-center justify-between gap-2 ${running ? 'bg-primary/5' : ''}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-6 h-6 shrink-0 rounded-full font-meta-sm text-meta-sm flex items-center justify-center font-bold ${done ? 'bg-primary text-on-primary' : running ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-container-high text-on-surface-variant'}`}
                        >
                          {number}
                        </span>
                        <div className="min-w-0">
                          <h3
                            className="font-body-md text-body-md font-semibold text-on-surface leading-tight truncate"
                            title={shot.task.title}
                          >
                            {shot.task.title}
                          </h3>
                        </div>
                      </div>
                      <span
                        className={`ml-auto px-2 py-0.5 rounded-full font-meta-sm text-meta-sm flex items-center gap-1 shrink-0 ${receiptError ? 'bg-error-container text-on-error-container' : done ? 'bg-primary-fixed/40 text-primary' : running ? 'bg-secondary-container text-on-secondary-container' : failed ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-outline'}`}
                      >
                        <StitchIcon
                          name={receiptError ? 'error' : done ? 'check_circle' : working ? 'progress_activity' : failed ? 'error' : 'schedule'}
                          size={13}
                          className={working ? 'motion-safe:animate-spin' : ''}
                        />
                        {receiptError ? receipt.title : transferring || unconfirmed ? transferLabel : done
                          ? '已就绪'
                          : running
                            ? '构想生成中'
                            : waiting
                              ? '等待队列中'
                              : failed
                                ? '生成失败'
                                : awaitingReview ? '待确认' : '待规划'}
                      </span>
                    </div>
                    <div
                      className={`w-full relative ${done ? 'aspect-video overflow-hidden bg-surface-container-low' : `${shot.kind === 'planned' ? 'min-h-24' : 'min-h-36'} bg-surface-container-low/50 flex flex-col items-center justify-center p-space-md`}`}
                    >
                      {done && shot.record ? (
                        <>
                          <RecordImage
                            alt={shot.task.title}
                            className="w-full h-full object-contain"
                            record={shot.record}
                          />
                          <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-inverse-surface/75 text-inverse-on-surface font-meta-sm text-[10px]">
                            {info ? `${info.size} · ${info.ratio}` : '读取画幅中'}
                          </div>
                          <div className="absolute inset-0 bg-inverse-surface/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-space-xs">
                            <button
                              type="button"
                              className="w-9 h-9 rounded-full bg-surface text-on-surface flex items-center justify-center hover:scale-110 shadow-sm"
                              title="全屏预览大图"
                              onClick={() => setPreview(shot.record!)}
                            >
                              <StitchIcon name="zoom_in" size={18} />
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              className="h-9 px-2 rounded-full bg-surface text-on-surface flex items-center justify-center gap-1.5 hover:scale-105 disabled:opacity-50 shadow-sm"
                              title="重新绘制本镜"
                              onClick={() => void redrawShot(index)}
                            >
                              <StitchIcon name="replay" size={18} />
                              <CreditCost />
                            </button>
                            <button
                              type="button"
                              className="w-9 h-9 rounded-full bg-surface text-on-surface flex items-center justify-center hover:scale-110 shadow-sm"
                              title="局部修改"
                              onClick={() => onEditRecord(shot.record!)}
                            >
                              <StitchIcon name="brush" size={18} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          {running && (
                            <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-secondary-container/20 to-transparent motion-safe:animate-pulse" />
                          )}
                          <div
                            className={`relative rounded-full flex items-center justify-center mb-2 ${running ? 'w-14 h-14 border-[3px] border-primary/20 text-primary' : 'w-10 h-10 bg-surface-container text-outline'}`}
                          >
                            <StitchIcon
                              name={
                                working
                                  ? 'progress_activity'
                                  : failed || receiptError
                                    ? 'error'
                                    : waiting || receiving
                                      ? 'hourglass_top'
                                      : 'movie_edit'
                              }
                              size={running ? 30 : 20}
                              className={working ? 'motion-safe:animate-spin' : failed || receiptError ? 'text-error' : ''}
                            />
                          </div>
                          <span className="relative font-meta-sm text-meta-sm text-on-surface text-center break-words max-w-full">
                            {sending ? '正在上传并等待确认' : receiving ? receipt.detail : unconfirmed ? '可继续提交, 已受理的任务不会重复生成' : running
                              ? '正在合成分镜画面与风格质感'
                              : waiting
                                ? personalQueuePosition(shot.job?.yourPosition || 0)
                                : failed
                                  ? shot.job?.error || '生成失败, 请重试'
                                  : awaitingReview ? '检查下方提示词, 确认后开始生成' : '填写画面提示词, 或由 AI 智能拆解'}
                          </span>
                          {(running || waiting) && shot.job && (
                            <span className="relative font-meta-sm text-meta-sm text-outline mt-0.5">
                              <QueueElapsed job={shot.job} />
                            </span>
                          )}
                          {waiting && (
                            <button
                              type="button"
                              title="置顶自己的待执行任务"
                              onClick={() => { if (shot.job) void onPrioritize(shot.job.id).catch((error) => pushToast('error', error.message)); }}
                              className="mt-2 px-3 py-1 rounded-lg bg-surface-container-high text-primary font-meta-sm text-meta-sm flex items-center gap-1"
                            >
                              <StitchIcon name="bolt" size={14} />
                              在我的队列中置顶
                            </button>
                          )}
                          {failed && (
                            <button
                              type="button"
                              disabled={!shot.job?.canRetry}
                              className="mt-2 px-3 py-1 rounded-lg bg-error-container text-on-error-container font-meta-sm text-meta-sm inline-flex items-center gap-1.5"
                              onClick={() => {
                                if (shot.job)
                                  void onRetry(shot.job.id).catch((error) => pushToast('error', error instanceof Error ? error.message : '重试失败'));
                              }}
                            >
                              重新尝试<CreditCost points={shot.job?.interruptionReason === 'pending-restart' ? shot.job.credit?.points : undefined} unlimited={shot.job?.interruptionReason === 'pending-restart' ? shot.job.credit?.unlimited : undefined} />
                            </button>
                          )}
                          {failed && shot.record && <button type="button" className="mt-2 font-meta-sm text-meta-sm text-primary hover:underline" onClick={() => setPreview(shot.record!)}>查看上一版图片</button>}
                          {receiving && shot.job?.delivery?.phase === 'error' && (
                            <button type="button" className="mt-2 px-3 py-1 rounded-lg bg-surface-container-high text-primary font-meta-sm text-meta-sm" onClick={() => { if (shot.job) void onRetry(shot.job.id).catch((error) => pushToast('error', error.message)); }}>重试领取</button>
                          )}
                          {unconfirmed && (
                            <button type="button" className="mt-2 px-3 py-1 rounded-lg bg-surface-container-high text-primary font-meta-sm text-meta-sm inline-flex items-center gap-1.5" disabled={submitting || !shot.job?.canRetry} onClick={() => { if (shot.job) void onRetry(shot.job.id).catch((error) => pushToast('error', error.message)); }}>继续提交<CreditCost /></button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="p-space-md flex-1 flex flex-col justify-between gap-space-sm">
                      <CreditStatus credit={shot.job?.credit} pending={shot.job?.settlementPending} />
                      <div>
                        <label
                          className="block font-meta-sm text-meta-sm text-outline mb-1"
                          htmlFor={`scene-prompt-${index}`}
                        >
                          分镜画面提示词
                        </label>
                        <textarea
                          id={`scene-prompt-${index}`}
                          maxLength={MAX_SCENE_PROMPT_LENGTH}
                          className="w-full bg-surface-container-low/60 rounded-lg p-2 font-body-sm text-body-sm text-on-surface border border-outline-variant/30 focus:border-primary focus:bg-surface-container-lowest transition-colors resize-y leading-relaxed"
                          rows={awaitingReview ? 6 : 3}
                          placeholder="输入本镜画面描述..."
                          value={shot.task.prompt}
                          readOnly={busy || submitting || running || waiting || transferring || unconfirmed || failed}
                          onChange={(event) => updateTask(index, event.target.value)}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-space-xs border-t border-outline-variant/20 font-meta-sm text-meta-sm text-on-surface-variant">
                        {receiptError && done ? (
                          <button type="button" className="text-primary hover:underline" onClick={() => { if (shot.job) void onRetry(shot.job.id).catch((error) => pushToast('error', error.message)); }}>重试领取</button>
                        ) : done ? (
                          <>
                            <span className="flex items-center gap-1 min-w-0">
                              <StitchIcon name="palette" size={14} className="text-primary" />
                              <span className="truncate">沿用系列画面要求</span>
                            </span>
                            <button
                              type="button"
                              className="text-primary hover:underline font-medium shrink-0 inline-flex items-center gap-1.5"
                              disabled={busy || submitting}
                              onClick={() => beginEdit(index)}
                            >
                              调整并重绘<CreditCost />
                            </button>
                          </>
                        ) : transferring || unconfirmed ? (
                          <span className="text-on-surface-variant">{sending ? '等待提交确认' : receiving ? '图片已生成, 等待领取完成' : '请继续确认本次提交'}</span>
                        ) : running ? (
                          <>
                            <span className="flex items-center gap-1 text-primary">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
                              画面笔触生成中...
                            </span>
                            <span className="text-outline" title="已经开始生成, 请等待本镜完成">暂不可修改</span>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={shot.job?.status === 'unsubmitted' || busy || submitting || failed && !shot.job?.canRetry}
                              title={waiting ? '修改尚未执行的分镜' : '设置本镜画幅, 质量和格式'}
                              onClick={() => beginEdit(index)}
                              className="flex items-center gap-1 hover:text-primary disabled:opacity-50"
                            >
                              <StitchIcon name="tune" size={14} />
                              {failed ? '调整并重试' : '调节本镜参数'}
                            </button>
                            <button
                              type="button"
                              disabled={
                                busy || submitting || running || (!waiting && (activeJobs || canContinue || count <= MIN_BATCH_COUNT))
                              }
                              className="text-outline hover:text-error flex items-center gap-1 disabled:opacity-40"
                              onClick={() => {
                                if (waiting && shot.job) {
                                  void onCancel(shot.job.id).catch(() =>
                                    pushToast('error', '取消失败, 任务可能已开始'),
                                  );
                                  return;
                                }
                                removeShot(index);
                              }}
                            >
                              <StitchIcon name="delete_outline" size={14} />
                              {waiting ? '取消排队' : '移除此镜'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div role="region" aria-label="分镜确认与生成" className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-md p-space-md rounded-xl bg-surface-container-lowest border border-outline-variant/30">
              <div className="min-w-0">
                <p role="status" className="font-body-md text-body-md font-medium text-on-surface">
                  {busy ? '正在拆解分镜提示词...' : canContinue ? '已确认的分镜尚有未提交项' : receiptErrorCount ? `${receiptErrorCount} 幕作品领取待重试` : activeJobs ? activityLabel : failedCount ? `${failedCount} 幕生成异常, 请在对应卡片中处理` : remainingCount === 0 ? `已完成 ${plannedTotal} 张分镜图片` : hasCompletePlan ? `${remainingCount} 幕分镜已准备好, 请检查后确认` : `请补全分镜提示词 (${filledPrompts}/${plannedTotal})`}
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  {canContinue ? '继续提交剩余分镜, 已提交的任务不会重复生成.' : receiptErrorCount ? '图片已经生成. 重试只领取原结果, 不重复生图或扣点.' : activeJobs ? '可在我的任务中查看排队和生成状态.' : failedCount ? '可重试原任务, 或调整提示词后重新生成. 已保存的旧版本仍保留在展馆.' : remainingCount === 0 ? '可下载整套图片, 或继续调整并重绘单镜.' : '可直接修改每幕提示词和本镜参数, 确认后才开始生成图片.'}
                </p>
              </div>
              <button
                type="button"
                className="flex items-center justify-center gap-2 shrink-0 px-space-lg py-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-medium text-body-md shadow-[0_2px_10px_rgba(65,91,47,0.25)] transition-colors disabled:opacity-50"
                onClick={() => void submitBatch()}
                disabled={busy || submitting || referenceBusy || (!canContinue && (activeJobs || !hasCompletePlan || remainingCount === 0 || missingFirst))}
              >
                <StitchIcon name="spa" size={20} />
                <span>{submitting ? '提交中...' : canContinue ? '继续提交剩余分镜' : receiptErrorCount ? '分镜领取待重试' : activeJobs ? '分镜处理中...' : missingFirst || failedCount && !remainingCount ? '请先处理异常分镜' : remainingCount === 0 ? '全部分镜已生成' : `确认并生成 ${remainingCount} 张图片`}</span>
                {(canContinue || !activeJobs) && submissionCount > 0 && <CreditCost count={submissionCount} />}
              </button>
            </div>
          </section>
        </div>
      </div>
      {editing && <SceneEditor estimatedPoints={(shots[editing.index]?.record || shots[editing.index]?.kind === 'failed') && shots[editing.index]?.job?.status !== 'pending' ? prices?.image : 0} value={editing} onChange={setEditing} onClose={() => setEditing(null)} onSave={saveEdit} imageCapabilities={props.imageCapabilities} actionLabel={shots[editing.index]?.job?.status === 'pending' ? '更新排队任务' : shots[editing.index]?.kind === 'failed' ? '保存并重新生成' : shots[editing.index]?.record ? '保存并重绘本镜' : '保存本镜设置'} />}
      {preview && (
        <StitchGalleryViewer
          cards={[{ kind: 'series', seriesId, masterPrompt: brief, records: seriesResults, versions: allSeriesResults, latestAt: Math.max(...seriesResults.map((record) => record.createdAt)) }]}
          initialIndex={0}
          initialSceneIndex={Math.max(0, seriesResults.findIndex((record) => record.id === preview.id))}
          onClose={() => setPreview(null)}
          onUseAsRef={props.onUseAsRef}
          onEditRecord={onEditRecord}
          onUseRecipe={onUseRecipe}
          onNotify={pushToast}
        />
      )}
      <ToastStack toasts={toasts} />
    </main>
  );
}
