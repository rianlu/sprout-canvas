import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSeriesSplitPrompt, parseSeriesPlan, scenePrompt, MIN_SERIES_COUNT, MAX_SERIES_COUNT, MAX_SERIES_BRIEF_LENGTH } from '../../shared/series-planning.mjs';
import { MAX_REFERENCE_IMAGES } from '../../shared/generation-contract.mjs';
import type { AspectRatio, GenerationConfig, RefImage, ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import type { ImageCapabilities } from '../types/provider';
import type { QueueSubmitInput } from '../lib/api/queue';
import { buildGenerationPayload, resolveSize, sizePreset } from '../lib/api/generation';
import { requestTextGeneration } from '../lib/api/text';
import { getCreditQuote } from '../lib/credits';
import { recoverSubmissionBatch } from '../lib/queue-recovery';
import { getOutboxInput, getRecordDataUrl, readWorkspaceDraft, writeWorkspaceDraft, registerWorkspaceSubmission } from '../lib/storage/gallery-db';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { downloadRecords, latestSceneVersions } from '../lib/image/gallery';
import { prepareImageFile } from '../lib/image/compress';
import { useImageMetadata } from './useImageMetadata';
import { isQueueActive } from '../lib/queue-presentation';

export const MAX_BATCH_COUNT = MAX_SERIES_COUNT;
export const MIN_BATCH_COUNT = MIN_SERIES_COUNT;
export const ASPECTS: { id: AspectRatio; label: string; tip: string }[] = [
  { id: '16:9', label: '16:9', tip: '宽景分镜' }, { id: '3:4', label: '3:4', tip: '画册立轴' },
  { id: '1:1', label: '1:1', tip: '方形插画' }, { id: '9:16', label: '9:16', tip: '移动全屏' },
];
export function seriesAspects(customSizes = true, current?: AspectRatio) {
  const standard: typeof ASPECTS = [
    { id: '1:1', label: '1:1', tip: '方形插画' }, { id: '3:2', label: '3:2', tip: '标准横图' },
    { id: '2:3', label: '2:3', tip: '标准竖图' }, { id: 'auto', label: '自动', tip: '自动画幅' },
  ];
  if (!customSizes) return standard;
  const options = [...ASPECTS];
  if (current && !options.some((option) => option.id === current)) options.push(standard.find((option) => option.id === current) || { id: current, label: current, tip: '原始画幅' });
  return options;
}
interface BatchTask { title: string; prompt: string }
export interface SceneEdit { index: number; prompt: string; aspectRatio: AspectRatio; quality: GenerationConfig['quality']; outputFormat: GenerationConfig['outputFormat'] }
export interface SeriesActions {
  onSubmit: (input: QueueSubmitInput) => Promise<QueueJob>;
  onSubmitBatch: (inputs: QueueSubmitInput[]) => Promise<QueueJob[]>;
  onUpdate: (jobId: string, input: QueueSubmitInput) => Promise<QueueJob>;
  results: ResultRecord[]; jobs: QueueJob[];
  imageCapabilities?: ImageCapabilities;
}
interface SeriesDraft { version: 1; seriesId: string; references: RefImage[]; reference?: RefImage | null; sceneIds: string[]; shotIds: string[]; overrides: Record<string, Partial<GenerationConfig>>; stagedIds: string[]; config?: GenerationConfig; brief?: string; taskText?: string; count?: number }
function syncLegacyDraft(draft: SeriesDraft) {
  const { config, brief, taskText, count, seriesId, sceneIds, shotIds } = draft;
  if (!config) return;
  for (const [key, value] of Object.entries({ batch_template: '', batch_brief: brief || '', batch_tasks: taskText || '', batch_style: '', batch_count: String(count || 4), batch_aspect_ratio: config.aspectRatio, batch_quality: config.quality, batch_output_format: config.outputFormat, batch_series_id: seriesId, batch_scene_ids: JSON.stringify(sceneIds), batch_shot_ids: JSON.stringify(shotIds) })) writeDraft(key, value);
}
type ShotState = { kind: 'done' | 'generating' | 'waiting' | 'planned' | 'failed' | 'submitting' | 'unsubmitted' | 'receiving'; task: BatchTask; record?: ResultRecord; job?: QueueJob };
function readIds(key: string): string[] { try { const ids: unknown = JSON.parse(readDraft(key) || '[]'); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } }
function parseTaskLines(text: string): BatchTask[] {
  try {
    const tasks: unknown = JSON.parse(text);
    if (Array.isArray(tasks) && tasks.every((task) => task && typeof task.title === 'string' && typeof task.prompt === 'string')) return tasks;
  } catch { /* Existing drafts store one scene per line. */ }
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.search(/[:：]/);
    return separator < 0 ? { title: line.slice(0, 28), prompt: line } : { title: line.slice(0, separator), prompt: line.slice(separator + 1).trim() };
  });
}

export function useSeriesStudio({ onSubmit, onSubmitBatch, onUpdate, results, jobs, imageCapabilities }: SeriesActions) {
  const [brief, setBrief] = useState(() => readDraft('batch_brief'));
  const [taskText, setTaskText] = useState(() => readDraft('batch_tasks'));
  const [count, rawSetCount] = useState(() => Math.min(8, Math.max(3, Number(readDraft('batch_count') || '4') || 4)));
  const [config, setConfig] = useState<GenerationConfig>(() => {
    const aspectRatio = (readDraft('batch_aspect_ratio') || '16:9') as AspectRatio;
    const size = resolveSize(aspectRatio);
    const quality = ['auto', 'low', 'medium', 'high'].includes(readDraft('batch_quality')) ? readDraft('batch_quality') as GenerationConfig['quality'] : 'auto';
    const outputFormat = ['png', 'jpeg', 'webp'].includes(readDraft('batch_output_format')) ? readDraft('batch_output_format') as GenerationConfig['outputFormat'] : 'png';
    return { mode: 'text', generationMode: 'images', imageModel: '', prompt: '', imageCount: 1, aspectRatio, sizeTier: '1K', requestSize: size.size, sizeHint: size.hint, quality, background: 'auto', outputFormat, outputCompression: 90, refImages: [] };
  });
  const [seriesId, setSeriesId] = useState(() => readDraft('batch_series_id'));
  const [sceneIds, setSceneIds] = useState(() => readIds('batch_scene_ids'));
  const [shotIds, setShotIds] = useState(() => readIds('batch_shot_ids'));
  const [references, setReferences] = useState<RefImage[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Partial<GenerationConfig>>>({});
  const [staged, setStaged] = useState<QueueSubmitInput[]>([]);
  const [stagedIds, setStagedIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [editing, setEditing] = useState<SceneEdit | null>(null);
  const [view, setView] = useState<'grid' | 'timeline'>('grid');
  const [preview, setPreview] = useState<ResultRecord | null>(null);
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const lock = useRef(false);
  const alive = useRef(true);
  const referenceSequence = useRef(0);
  const referenceLock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; referenceSequence.current++; }; }, []);
  useEffect(() => {
    if (!imageCapabilities || !ready) return;
    setConfig((current) => {
      const next = { ...current };
      if (!imageCapabilities.formats.includes(current.outputFormat as 'png' | 'jpeg' | 'webp')) next.outputFormat = imageCapabilities.formats[0];
      if (!imageCapabilities.customSizes && !['1:1', '3:2', '2:3', 'auto'].includes(current.aspectRatio)) next.aspectRatio = '1:1';
      return next.outputFormat === current.outputFormat && next.aspectRatio === current.aspectRatio ? current : next;
    });
  }, [imageCapabilities, ready]);
  function pushToast(type: 'info' | 'success' | 'error', message: string) { const id = randomId(); setToasts((old) => [...old, { id, type, message }]); window.setTimeout(() => setToasts((old) => old.filter((item) => item.id !== id)), 5000); }
  const tasks = useMemo(() => { const parsed = parseTaskLines(taskText); return Array.from({ length: count }, (_, index) => parsed[index] || { title: `分镜 ${index + 1}`, prompt: '' }); }, [taskText, count]);
  const allSeriesResults = useMemo(() => results.filter((record) => record.kind === 'series' && record.seriesId === seriesId), [results, seriesId]);
  const seriesResults = useMemo(() => latestSceneVersions(allSeriesResults).filter((record) => !sceneIds.length || !record.sceneId || sceneIds.includes(record.sceneId)), [allSeriesResults, sceneIds]);
  const seriesJobs = useMemo(() => jobs.filter((job) => job.clientContext?.seriesId === seriesId), [jobs, seriesId]);
  const activeJobs = seriesJobs.some(isQueueActive);
  const metadata = useImageMetadata(seriesResults);
  const missingStaged = staged.filter((input) => !seriesJobs.some((job) => job.requestId === input.requestId && job.status !== 'unsubmitted') && !allSeriesResults.some((record) => record.requestId === input.requestId));
  const canContinue = missingStaged.length > 0;
  const shots: ShotState[] = tasks.map((task, index) => {
    const sceneId = sceneIds[index];
    const record = seriesResults.find((item) => sceneId ? item.sceneId === sceneId : item.id === shotIds[index]);
    const job = seriesJobs.filter((item) => sceneId ? item.clientContext?.sceneId === sceneId : item.clientContext?.placeholderId === shotIds[index]).sort((a, b) => (b.clientContext?.version || 1) - (a.clientContext?.version || 1) || b.queuedAt - a.queuedAt)[0];
    let kind: ShotState['kind'] = record ? 'done' : 'planned';
    if (job && (!record || (job.clientContext?.version || 1) >= (record.version || 1))) {
      if (job.status === 'submitting' || job.status === 'unsubmitted') kind = job.status;
      else if (job.status === 'running') kind = 'generating';
      else if (job.status === 'pending') kind = 'waiting';
      else if (['failed', 'expired', 'interrupted'].includes(job.status)) kind = 'failed';
      else if (job.status === 'succeeded' && !job.acknowledgedAt && record?.jobId !== job.id && record?.requestId !== job.requestId) kind = 'receiving';
    }
    return { kind, task, record, job };
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const draft = await readWorkspaceDraft<SeriesDraft>('series');
      if (!alive) return;
      if (draft && readDraft('batch_transfer') !== '1') {
        setSeriesId(draft.seriesId);
        if (draft.count) rawSetCount(Math.min(MAX_BATCH_COUNT, Math.max(MIN_BATCH_COUNT, draft.count)));
        if (draft.brief !== undefined) setBrief(draft.brief);
        if (draft.taskText !== undefined) setTaskText(draft.taskText);
        setReferences(draft.references || (draft.reference ? [draft.reference] : [])); setOverrides(draft.overrides || {});
        if (draft.config) setConfig(draft.config);
        setSceneIds(draft.sceneIds); setShotIds(draft.shotIds);
        setStagedIds(draft.stagedIds || []);
        const inputs = [];
        for (const id of draft.stagedIds || []) { const input = await getOutboxInput(id); if (input) inputs.push(input); }
        if (alive) setStaged(inputs);
      }
      writeDraft('batch_transfer', '');
      if (alive) setReady(true);
    })().catch((error) => { if (alive) { setReady(true); pushToast('error', error instanceof Error ? error.message : '系列草稿读取失败'); } });
    return () => { alive = false; };
  }, []);
  const currentDraft = useMemo<SeriesDraft>(() => ({ version: 1, seriesId, references, sceneIds, shotIds, overrides, config, stagedIds, brief, taskText, count }), [seriesId, references, sceneIds, shotIds, overrides, config, stagedIds, brief, taskText, count]);
  const currentDraftRef = useRef(currentDraft);
  const explicitDraft = useRef<SeriesDraft | null>(null);
  currentDraftRef.current = currentDraft;
  useEffect(() => {
    if (!ready) return;
    const saved = explicitDraft.current;
    explicitDraft.current = null;
    // A confirmed edit can already have completed and cleared its draft before React renders it.
    if (saved && Object.entries(saved).every(([key, value]) => Object.is(currentDraft[key as keyof SeriesDraft], value))) return;
    void writeWorkspaceDraft('series', currentDraft).catch(() => pushToast('error', '系列草稿保存失败, 请检查本地空间'));
    syncLegacyDraft(currentDraft);
  }, [ready, currentDraft, brief, taskText, count, config, seriesId, sceneIds, shotIds]);

  function updateTask(index: number, prompt: string) { const next = [...tasks]; next[index] = { ...next[index], prompt }; setTaskText(JSON.stringify(next)); }
  function resetSeries() { if (lock.current) return; referenceSequence.current++; referenceLock.current = false; setReferenceBusy(false); setBrief(''); setTaskText(''); setSeriesId(''); setSceneIds([]); setShotIds([]); setStaged([]); setStagedIds([]); setOverrides({}); setReferences([]); setEditing(null); setPreview(null); }
  const maxReferences = Math.min(MAX_REFERENCE_IMAGES, imageCapabilities?.maxReferences ?? MAX_REFERENCE_IMAGES);
  async function uploadReferences(files: File[], replaceId?: string) {
    if (!files.length || !ready || lock.current || activeJobs || canContinue || referenceLock.current) return;
    const previous = currentDraftRef.current.references;
    if (replaceId && !previous.some((reference) => reference.id === replaceId)) return;
    if (replaceId && files.length !== 1) { pushToast('error', '更换图片时请选择一张图片'); return; }
    if (!replaceId && previous.length + files.length > maxReferences) { pushToast('error', `最多使用 ${maxReferences} 张参考图, 当前还可添加 ${Math.max(0, maxReferences - previous.length)} 张`); return; }
    const sequence = ++referenceSequence.current;
    referenceLock.current = true;
    setReferenceBusy(true);
    try {
      const prepared: RefImage[] = [];
      for (const file of files) prepared.push({ id: randomId(), ...await prepareImageFile(file, { preserveOriginal: true }) });
      if (!alive.current || referenceSequence.current !== sequence) return;
      const next = replaceId ? previous.map((reference) => reference.id === replaceId ? prepared[0] : reference) : [...previous, ...prepared];
      currentDraftRef.current = { ...currentDraftRef.current, references: next };
      setReferences(next);
    } catch (error) {
      if (alive.current && referenceSequence.current === sequence) pushToast('error', error instanceof Error ? error.message : '参考图读取失败');
    } finally { if (referenceSequence.current === sequence) { referenceLock.current = false; if (alive.current) setReferenceBusy(false); } }
  }
  function removeReference(id?: string) {
    if (!ready || lock.current || activeJobs || canContinue || referenceLock.current) return;
    const next = id ? currentDraftRef.current.references.filter((reference) => reference.id !== id) : [];
    currentDraftRef.current = { ...currentDraftRef.current, references: next };
    setReferences(next);
  }
  async function splitStory() {
    if (lock.current || !ready || referenceLock.current || editing || preview || activeJobs || canContinue) return false;
    if (!brief.trim() || brief.length > MAX_SERIES_BRIEF_LENGTH) { pushToast('error', `请填写创作需求或分镜剧本, 最多 ${MAX_SERIES_BRIEF_LENGTH} 字`); return false; }
    if (tasks.some((task) => task.prompt.trim()) && !window.confirm('重新拆解会替换当前分镜提示词, 包括手动修改的内容. 是否继续?')) return false;
    lock.current = true; setBusy(true);
    const original = currentDraftRef.current;
    try {
      await writeWorkspaceDraft('series', original);
      await requestTextGeneration(buildSeriesSplitPrompt(count), `系列梗概: ${brief}\n从梗概中提取主体与画面风格要求, 保持全系列一致.`, 'series', count, async (response) => {
        const parsed = parseSeriesPlan(response.text, count);
        if (!alive.current || currentDraftRef.current !== original) throw new Error('原系列草稿已切换, 拆解结果已保留. 回到原梗概后可再次点击拆解领取');
        const next: SeriesDraft = { ...original, taskText: JSON.stringify(parsed), seriesId: randomId(), sceneIds: parsed.map(() => randomId()), shotIds: [], overrides: {}, stagedIds: [] };
        const revision = await writeWorkspaceDraft('series', next, { expected: original });
        if (!revision) throw new Error('系列草稿已在其他页面变更, 未覆盖内容. 拆解结果已保留');
        if (!alive.current || currentDraftRef.current !== original) return;
        currentDraftRef.current = next;
        setTaskText(next.taskText!); setSeriesId(next.seriesId); setSceneIds(next.sceneIds); setShotIds([]); setOverrides({}); setStaged([]); setStagedIds([]);
        pushToast('success', `已拆解 ${parsed.length} 幕, 请逐镜检查后确认生成图片`);
      });
      return true;
    } catch (error) {
      if (alive.current) pushToast('error', error instanceof Error ? error.message : '分镜拆解失败, 请重试');
      return false;
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  async function createInput(index: number, task: BatchTask, identity: { seriesId: string; sceneId: string; placeholderId: string; requestId: string }, referenceJobId?: string, override?: Partial<GenerationConfig>, continuityReference?: RefImage) {
    const creditQuote = getCreditQuote();
    const previous = allSeriesResults.filter((item) => item.sceneId === identity.sceneId).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
    const settings = { ...config, ...overrides[identity.sceneId], ...override };
    const size = resolveSize(settings.aspectRatio, settings.sizeTier);
    if (references.length > maxReferences) throw new Error(`最多使用 ${maxReferences} 张参考图, 请先移除多余图片`);
    const prompt = scenePrompt({ brief, prompt: task.prompt, index, count, referenceCount: references.length, hasContinuityReference: Boolean(referenceJobId || continuityReference) });
    const request = await buildGenerationPayload({ ...settings, requestSize: override?.requestSize || overrides[identity.sceneId]?.requestSize || size.size, sizeHint: size.hint, prompt, refImages: references });
    const version = Math.max(previous?.version || 0, ...seriesJobs.filter((job) => job.clientContext?.sceneId === identity.sceneId).map((job) => job.clientContext?.version || 1)) + 1;
    return { requestId: identity.requestId, request, creditQuote, ...(referenceJobId ? { referenceJobId } : {}), ...(continuityReference ? { referenceImage: { id: continuityReference.id, name: continuityReference.name, dataUrl: continuityReference.dataUrl, recordId: continuityReference.recordId } } : {}), clientContext: { kind: 'series', placeholderId: identity.placeholderId, prompt: task.prompt, mode: request.references.length || referenceJobId || continuityReference ? 'reference' : 'text', seriesId: identity.seriesId, sceneId: identity.sceneId, sceneIndex: index, version, parentId: previous?.id, masterPrompt: brief.trim() } } satisfies QueueSubmitInput;
  }

  function confirmUnknown(affected: ShotState[]) {
    const unknown = affected.filter((shot) => shot.kind === 'failed' && shot.job?.outcomeUnknown);
    return !unknown.length || window.confirm(`有 ${unknown.length} 幕上次生成结果未知, 原点数需管理员核实. 重新绘制会创建新任务并按当前额度计费, 是否继续?`);
  }

  async function submitBatch(redraw = false) {
    if (lock.current || !ready || referenceLock.current || editing || preview || (activeJobs && !canContinue) || (redraw && (activeJobs || canContinue))) return;
    if (!canContinue && tasks.some((task) => !task.prompt.trim())) { pushToast('error', '请先完成并检查所有分镜提示词, 再确认生成'); return; }
    if (redraw && !confirmUnknown(shots)) return;
    if (!redraw && !canContinue && !shots[0]?.record && shots[0]?.kind !== 'planned') { pushToast('error', '请先重试并完成首镜, 再生成后续分镜'); return; }
    lock.current = true; setSubmitting(true);
    try {
      const quote = getCreditQuote();
      if (!redraw && missingStaged.length) {
        const recovered = await recoverSubmissionBatch(missingStaged, quote);
        if (recovered.recreated) {
          const replacements = new Map(missingStaged.map((input, index) => [input.requestId, recovered.inputs[index]]));
          const placeholders = new Map(missingStaged.map((input, index) => [input.clientContext.placeholderId, recovered.inputs[index].clientContext.placeholderId]));
          setStaged((current) => current.map((input) => replacements.get(input.requestId) || input));
          setStagedIds((current) => current.map((id) => replacements.get(id)?.requestId || id));
          setShotIds((current) => current.map((id) => placeholders.get(id) || id));
        }
        await onSubmitBatch(recovered.inputs);
        pushToast('success', `已继续提交 ${missingStaged.length} 幕`);
        return;
      }
      const planned = tasks;
      const nextSeriesId = seriesId || randomId();
      const nextSceneIds = planned.map((_, index) => sceneIds[index] || randomId());
      const nextShotIds = planned.map(() => randomId());
      const requestIds = planned.map(() => randomId());
      const inputs: QueueSubmitInput[] = [];
      for (const [index, task] of planned.entries()) {
        if (!redraw && shots[index]?.kind !== 'planned') { nextShotIds[index] = shots[index]?.record?.id || shotIds[index] || ''; continue; }
        let anchor = index > 0 ? requestIds[0] : undefined;
        let continuityReference: RefImage | undefined;
        if (index > 0 && !redraw && shots[0]?.record) {
          const record = shots[0].record;
          continuityReference = { id: record.id, recordId: record.id, name: '首镜主体参考.png', dataUrl: await getRecordDataUrl(record), size: record.bytes || 0 };
          anchor = undefined;
        }
        inputs.push({ ...await createInput(index, task, { seriesId: nextSeriesId, sceneId: nextSceneIds[index], placeholderId: nextShotIds[index], requestId: requestIds[index] }, anchor, undefined, continuityReference), creditQuote: quote });
      }
      if (!inputs.length) { pushToast('info', '所有分镜均已完成, 可选择单镜或整套重绘'); return; }
      setSeriesId(nextSeriesId); setSceneIds(nextSceneIds); setShotIds(nextShotIds); setStaged(inputs); setStagedIds(inputs.map((input) => input.requestId));
      const draft: SeriesDraft = { ...currentDraft, seriesId: nextSeriesId, sceneIds: nextSceneIds, shotIds: nextShotIds, stagedIds: inputs.map((input) => input.requestId) };
      const revision = await writeWorkspaceDraft('series', draft);
      await registerWorkspaceSubmission('series', draft, inputs.map((input) => input.requestId), { revision });
      writeDraft('batch_series_id', nextSeriesId); writeDraft('batch_scene_ids', JSON.stringify(nextSceneIds)); writeDraft('batch_shot_ids', JSON.stringify(nextShotIds));
      await onSubmitBatch(inputs);
      pushToast('success', `已提交 ${inputs.length} 幕, 后续分镜会参考首镜主体`);
    } catch (error) { pushToast('error', `${error instanceof Error ? error.message : '提交失败'}. 未受理分镜可继续提交.`); }
    finally { lock.current = false; setSubmitting(false); }
  }

  function sceneSettings(index: number, changed: Partial<GenerationConfig> = {}): Partial<GenerationConfig> {
    const shot = shots[index];
    const recipe = shot?.job?.recipe || shot?.record?.recipe;
    const defaults = { ...config, ...overrides[sceneIds[index]] };
    const current = recipe ? { ...defaults, ...sizePreset(recipe.size), requestSize: recipe.size, quality: recipe.quality, outputFormat: recipe.outputFormat, background: recipe.background, outputCompression: recipe.outputCompression } : { ...defaults, requestSize: overrides[sceneIds[index]]?.requestSize || resolveSize(defaults.aspectRatio, defaults.sizeTier).size };
    const aspectRatio = changed.aspectRatio || current.aspectRatio;
    return { aspectRatio, sizeTier: current.sizeTier, requestSize: aspectRatio === current.aspectRatio ? current.requestSize : resolveSize(aspectRatio, current.sizeTier).size, quality: changed.quality || current.quality, outputFormat: changed.outputFormat || current.outputFormat, background: current.background, outputCompression: current.outputCompression };
  }

  async function submitShot(index: number, override?: Partial<GenerationConfig>, promptOverride?: string) {
      const shot = shots[index];
      const settings = sceneSettings(index, override);
      const nextSceneId = sceneIds[index] || randomId();
      const identity = { seriesId: seriesId || randomId(), sceneId: nextSceneId, placeholderId: randomId(), requestId: randomId() };
      const anchor = shot.record || shots[0]?.record;
      const referenceJobId = !anchor && index > 0 && ['waiting', 'generating'].includes(shots[0]?.kind) ? shots[0].job?.id : undefined;
      if (index > 0 && !anchor && !referenceJobId) throw new Error('请先生成或重试首镜, 再绘制后续分镜');
      const continuityReference = anchor ? { id: anchor.id, recordId: anchor.id, name: '分镜衔接参考.png', dataUrl: await getRecordDataUrl(anchor), size: anchor.bytes || 0 } : undefined;
      const input: QueueSubmitInput = await createInput(index, { ...shot.task, prompt: promptOverride ?? shot.task.prompt }, identity, referenceJobId, settings, continuityReference);
      if (shot.kind === 'failed' && shot.job && !shot.job.localOnly) input.retryOf = shot.job.id;
      const nextSceneIds = tasks.map((_, i) => i === index ? nextSceneId : sceneIds[i] || randomId());
      const nextShotIds = tasks.map((_, i) => i === index ? identity.placeholderId : shotIds[i] || '');
      const nextOverrides = { ...overrides, [nextSceneId]: settings };
      const nextTaskText = promptOverride === undefined ? taskText : JSON.stringify(tasks.map((task, i) => i === index ? { ...task, prompt: promptOverride } : task));
      setSeriesId(identity.seriesId); setSceneIds(nextSceneIds); setShotIds(nextShotIds); setOverrides(nextOverrides); setTaskText(nextTaskText);
      const draft: SeriesDraft = { ...currentDraft, seriesId: identity.seriesId, sceneIds: nextSceneIds, shotIds: nextShotIds, overrides: nextOverrides, taskText: nextTaskText };
      const revision = await writeWorkspaceDraft('series', draft);
      await registerWorkspaceSubmission('series', draft, [input.requestId], { revision, append: true });
      await onSubmit(input);
      if (alive.current) pushToast('success', `第 ${index + 1} 镜已加入重绘队列`);
  }

  async function redrawShot(index: number, override?: Partial<GenerationConfig>, promptOverride?: string) {
    const shot = shots[index];
    if (lock.current || referenceLock.current || !shot || ['generating', 'waiting', 'submitting', 'unsubmitted', 'receiving'].includes(shot.kind)) return;
    if (!(promptOverride ?? shot.task.prompt).trim()) { pushToast('error', '请先填写并检查本镜提示词'); return; }
    if (!confirmUnknown([shot])) return;
    lock.current = true; setSubmitting(true);
    try {
      await submitShot(index, override, promptOverride);
    } catch (error) { pushToast('error', error instanceof Error ? error.message : '单镜重绘失败'); }
    finally { lock.current = false; setSubmitting(false); }
  }
  function beginEdit(index: number) {
    if (lock.current || ['generating', 'submitting', 'unsubmitted', 'receiving'].includes(shots[index]?.kind)) return;
    const settings = { ...config, ...sceneSettings(index) };
    setEditing({ index, prompt: tasks[index].prompt, aspectRatio: settings.aspectRatio, quality: settings.quality, outputFormat: settings.outputFormat });
  }
  async function saveEdit() {
    if (lock.current || !editing || !editing.prompt.trim()) return;
    const { index, prompt, ...changed } = editing;
    const shot = shots[index];
    const settings = sceneSettings(index, changed);
    lock.current = true;
    try {
      if (['generating', 'submitting', 'unsubmitted', 'receiving'].includes(shot.kind)) throw new Error('本镜正在提交或处理, 请等待完成后再调整');
      if (shot.job?.status !== 'pending' && (shot.record || shot.kind === 'failed')) {
        if (shot.kind === 'failed' && !shot.job?.canRetry) throw new Error('本镜暂时无法重新生成, 请先在我的任务中查看处理状态');
        if (!confirmUnknown([shot])) return;
        setSubmitting(true);
        await submitShot(index, settings, prompt);
        if (alive.current) setEditing(null);
        return;
      }
      const previousRevision = shot.job?.status === 'pending' ? await writeWorkspaceDraft('series', currentDraft) : undefined;
      if (shot.job?.status === 'pending') {
        const input = await getOutboxInput(shot.job.requestId);
        if (!input) throw new Error('此浏览器没有待执行任务的原始配方');
        const originalSize = sizePreset(input.request.size);
        const updated: QueueSubmitInput = { ...input, request: { ...input.request, prompt: scenePrompt({ brief: input.clientContext.masterPrompt ?? brief, prompt, index: input.clientContext.sceneIndex ?? index, count, referenceCount: input.request.references.length, hasContinuityReference: Boolean(input.referenceJobId || input.referenceImage) }), size: changed.aspectRatio === originalSize.aspectRatio ? input.request.size : resolveSize(changed.aspectRatio, originalSize.sizeTier).size, quality: changed.quality, outputFormat: changed.outputFormat === 'auto' ? 'png' : changed.outputFormat }, clientContext: { ...input.clientContext, prompt } };
        await onUpdate(shot.job.id, updated);
      }
      const sceneId = sceneIds[index] || randomId();
      const nextSceneIds = tasks.map((_, i) => i === index ? sceneId : sceneIds[i] || randomId());
      const nextOverrides = { ...overrides, [sceneId]: settings };
      const nextTaskText = JSON.stringify(tasks.map((task, i) => i === index ? { ...task, prompt } : task));
      const draft: SeriesDraft = { ...currentDraft, sceneIds: nextSceneIds, overrides: nextOverrides, taskText: nextTaskText };
      const revision = await writeWorkspaceDraft('series', draft);
      if (alive.current) {
        if (shot.job?.status === 'pending') { explicitDraft.current = draft; syncLegacyDraft(draft); }
        setSceneIds(nextSceneIds); setOverrides(nextOverrides); setTaskText(nextTaskText); setEditing(null);
      }
      if (shot.job?.status === 'pending') {
        await registerWorkspaceSubmission('series', draft, [shot.job.requestId], { revision, append: true, previousRevision });
      }
      if (alive.current) pushToast('success', shot.job?.status === 'pending' ? '排队分镜已更新' : '本镜设置已保存');
    } catch (error) { if (alive.current) pushToast('error', error instanceof Error ? error.message : '本镜设置保存失败'); }
    finally { lock.current = false; if (alive.current) setSubmitting(false); }
  }
  async function exportSeries() { try { await downloadRecords(seriesResults, `sprout-series-${seriesId}`); pushToast('success', `已打包 ${seriesResults.length} 幕`); } catch { pushToast('error', '打包失败, 请检查本地原图'); } }
  function removeShot(index: number) {
    if (lock.current || activeJobs || canContinue || count <= MIN_BATCH_COUNT) return;
    setTaskText(JSON.stringify(tasks.filter((_, i) => i !== index)));
    setSceneIds((old) => old.filter((_, i) => i !== index)); setShotIds((old) => old.filter((_, i) => i !== index));
    setOverrides((old) => Object.fromEntries(Object.entries(old).filter(([id]) => id !== sceneIds[index])));
    rawSetCount(count - 1);
  }
  function setCount(update: (count: number) => number) {
    if (lock.current || activeJobs || canContinue) return;
    const next = Math.min(MAX_BATCH_COUNT, Math.max(MIN_BATCH_COUNT, update(count)));
    if (next < count) removeShot(count - 1);
    else rawSetCount(next);
  }
  return { ready, brief, setBrief, taskText, setTaskText, count, setCount, config, setConfig, tasks, busy, submitting, referenceBusy, toasts, pushToast, seriesId, seriesResults, allSeriesResults, activeJobs, canContinue, submissionCount: canContinue ? missingStaged.length : shots.filter((shot) => shot.kind === 'planned').length, metadata, view, setView, preview, setPreview, shots, shotIds, splitStory, submitBatch, exportSeries, updateTask, removeShot, resetSeries, redrawShot, references, maxReferences, removeReference, uploadReferences, editing, setEditing, beginEdit, saveEdit };
}
