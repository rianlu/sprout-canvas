import { useEffect, useMemo, useRef, useState } from 'react';
import { SERIES_PRESETS, buildSeriesSplitPrompt, parseSeriesPlan, scenePrompt } from '../../shared/series-planning.mjs';
import type { AspectRatio, GenerationConfig, RefImage, ResultRecord, SeriesTemplate } from '../types/generation';
import type { QueueJob } from '../types/queue';
import type { ImageCapabilities } from '../types/provider';
import type { QueueSubmitInput } from '../lib/api/queue';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
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

export const TEMPLATES = SERIES_PRESETS;
export const MAX_BATCH_COUNT = 8;
export const MIN_BATCH_COUNT = 3;
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
interface SeriesDraft { version: 1; seriesId: string; reference: RefImage | null; sceneIds: string[]; shotIds: string[]; overrides: Record<string, Partial<GenerationConfig>>; stagedIds: string[]; config?: GenerationConfig; brief?: string; taskText?: string; template?: SeriesTemplate; count?: number }
type ShotState = { kind: 'done' | 'generating' | 'waiting' | 'planned' | 'failed' | 'submitting' | 'unsubmitted' | 'receiving'; task: BatchTask; record?: ResultRecord; job?: QueueJob };
function readIds(key: string): string[] { try { const ids: unknown = JSON.parse(readDraft(key) || '[]'); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } }
function parseTaskLines(text: string): BatchTask[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.search(/[:：]/);
    return separator < 0 ? { title: line.slice(0, 28), prompt: line } : { title: line.slice(0, separator), prompt: line.slice(separator + 1).trim() };
  });
}

export function useSeriesStudio({ onSubmit, onSubmitBatch, onUpdate, results, jobs, imageCapabilities }: SeriesActions) {
  const [template, rawSetTemplate] = useState<SeriesTemplate>(() => TEMPLATES.find((item) => item.id === readDraft('batch_template'))?.id || 'picture-book');
  const [brief, setBrief] = useState(() => readDraft('batch_brief'));
  const [taskText, setTaskText] = useState(() => readDraft('batch_tasks'));
  const [count, setCount] = useState(() => Math.min(8, Math.max(3, Number(readDraft('batch_count') || '4') || 4)));
  const [config, setConfig] = useState<GenerationConfig>(() => {
    const aspectRatio = (readDraft('batch_aspect_ratio') || '16:9') as AspectRatio;
    const size = resolveSize(aspectRatio);
    const quality = ['auto', 'low', 'medium', 'high'].includes(readDraft('batch_quality')) ? readDraft('batch_quality') as GenerationConfig['quality'] : 'medium';
    const outputFormat = ['png', 'jpeg', 'webp'].includes(readDraft('batch_output_format')) ? readDraft('batch_output_format') as GenerationConfig['outputFormat'] : 'png';
    return { mode: 'text', generationMode: 'images', imageModel: '', prompt: '', imageCount: 1, aspectRatio, sizeTier: '1K', requestSize: size.size, sizeHint: size.hint, quality, background: 'auto', outputFormat, outputCompression: 90, refImages: [] };
  });
  const [seriesId, setSeriesId] = useState(() => readDraft('batch_series_id'));
  const [sceneIds, setSceneIds] = useState(() => readIds('batch_scene_ids'));
  const [shotIds, setShotIds] = useState(() => readIds('batch_shot_ids'));
  const [reference, setReference] = useState<RefImage | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<GenerationConfig>>>({});
  const [staged, setStaged] = useState<QueueSubmitInput[]>([]);
  const [stagedIds, setStagedIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<SceneEdit | null>(null);
  const [view, setView] = useState<'grid' | 'timeline'>('grid');
  const [preview, setPreview] = useState<ResultRecord | null>(null);
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const lock = useRef(false);
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
  const seriesResults = useMemo(() => latestSceneVersions(allSeriesResults), [allSeriesResults]);
  const seriesJobs = useMemo(() => jobs.filter((job) => job.clientContext?.seriesId === seriesId), [jobs, seriesId]);
  const activeJobs = seriesJobs.some(isQueueActive);
  const metadata = useImageMetadata(seriesResults);
  const missingStaged = staged.filter((input) => !seriesJobs.some((job) => job.requestId === input.requestId && job.status !== 'unsubmitted') && !seriesResults.some((record) => record.requestId === input.requestId));
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
      if (draft && draft.seriesId === readDraft('batch_series_id') && readDraft('batch_transfer') !== '1') {
        if (draft.brief !== undefined) setBrief(draft.brief);
        if (draft.taskText !== undefined) setTaskText(draft.taskText);
        setReference(draft.reference); setOverrides(draft.overrides || {});
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
  const currentDraft = useMemo<SeriesDraft>(() => ({ version: 1, seriesId, reference, sceneIds, shotIds, overrides, config, stagedIds, brief, taskText, template, count }), [seriesId, reference, sceneIds, shotIds, overrides, config, stagedIds, brief, taskText, template, count]);
  useEffect(() => {
    if (!ready) return;
    void writeWorkspaceDraft('series', currentDraft).catch(() => pushToast('error', '系列草稿保存失败, 请检查本地空间'));
    for (const [key, value] of Object.entries({ batch_template: template, batch_brief: brief, batch_tasks: taskText, batch_style: '', batch_count: String(count), batch_aspect_ratio: config.aspectRatio, batch_quality: config.quality, batch_output_format: config.outputFormat, batch_series_id: seriesId, batch_scene_ids: JSON.stringify(sceneIds), batch_shot_ids: JSON.stringify(shotIds) })) writeDraft(key, value);
  }, [ready, currentDraft, template, brief, taskText, count, config, seriesId, sceneIds, shotIds]);

  function updateTask(index: number, prompt: string) { const next = [...tasks]; next[index] = { ...next[index], prompt }; setTaskText(next.map((task) => `${task.title}: ${task.prompt.replaceAll('\n', ' ')}`).join('\n')); }
  function resetSeries() { if (lock.current) return; setBrief(''); setTaskText(''); setSeriesId(''); setSceneIds([]); setShotIds([]); setStaged([]); setStagedIds([]); setOverrides({}); setReference(null); setEditing(null); setPreview(null); }
  function setTemplate(value: SeriesTemplate) { if (lock.current || activeJobs || canContinue || value === template) return; rawSetTemplate(value); setTaskText(''); setSeriesId(''); setSceneIds([]); setShotIds([]); setStaged([]); setStagedIds([]); setOverrides({}); }
  async function uploadReference(file: File) { try { setReference({ id: randomId(), ...await prepareImageFile(file) }); } catch (error) { pushToast('error', error instanceof Error ? error.message : '参考图读取失败'); } }
  async function splitStory() {
    if (lock.current || !ready || editing || preview || activeJobs || canContinue) return false;
    if (!brief.trim()) { pushToast('error', '请先填写故事梗概或分段分镜剧本'); return false; }
    if (tasks.some((task) => task.prompt.trim()) && !window.confirm('重新拆解会替换当前分镜提示词, 包括手动修改的内容. 是否继续?')) return false;
    lock.current = true; setBusy(true);
    try {
      const response = await requestTextGeneration(buildSeriesSplitPrompt(template, count), `系列梗概: ${brief}\n从梗概中提取主体与画面风格要求, 保持全系列一致.`, 'series', count);
      const parsed = parseSeriesPlan(response.text, count);
      setTaskText(parsed.map((task) => `${task.title}: ${task.prompt.replaceAll('\n', ' ')}`).join('\n'));
      pushToast('success', `已拆解 ${parsed.length} 幕, 请逐镜检查后确认生成图片`);
      return true;
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : '分镜拆解失败, 请重试');
      return false;
    } finally { lock.current = false; setBusy(false); }
  }

  async function createInput(index: number, task: BatchTask, identity: { seriesId: string; sceneId: string; placeholderId: string; requestId: string }, referenceJobId?: string, override?: Partial<GenerationConfig>, refOverride?: RefImage[]) {
    const creditQuote = getCreditQuote();
    const previous = allSeriesResults.filter((item) => item.sceneId === identity.sceneId).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
    const settings = { ...config, ...overrides[identity.sceneId], ...override };
    const size = resolveSize(settings.aspectRatio, settings.sizeTier);
    const prompt = scenePrompt({ brief, prompt: task.prompt, index, count });
    const request = await buildGenerationPayload({ ...settings, requestSize: size.size, sizeHint: size.hint, prompt, refImages: refOverride ?? (reference ? [reference] : []) });
    return { requestId: identity.requestId, request, creditQuote, ...(referenceJobId ? { referenceJobId } : {}), clientContext: { kind: 'series', placeholderId: identity.placeholderId, prompt: task.prompt, mode: request.references.length || referenceJobId ? 'reference' : 'text', seriesId: identity.seriesId, sceneId: identity.sceneId, sceneIndex: index, version: (previous?.version || 0) + 1, parentId: previous?.id, template, masterPrompt: brief.trim() } } satisfies QueueSubmitInput;
  }

  async function submitBatch(redraw = false) {
    if (lock.current || !ready || editing || preview || (activeJobs && !canContinue) || (redraw && (activeJobs || canContinue))) return;
    if (!canContinue && tasks.some((task) => !task.prompt.trim())) { pushToast('error', '请先完成并检查所有分镜提示词, 再确认生成'); return; }
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
        if (!redraw && shots[index]?.record) { nextShotIds[index] = shots[index].record!.id; continue; }
        let anchor = index > 0 ? requestIds[0] : undefined;
        let refs: RefImage[] | undefined;
        if (index > 0 && !redraw && shots[0]?.record) {
          const record = shots[0].record;
          refs = [{ id: record.id, recordId: record.id, name: '首镜主体参考.png', dataUrl: await getRecordDataUrl(record), size: record.bytes || 0 }];
          anchor = undefined;
        }
        inputs.push({ ...await createInput(index, task, { seriesId: nextSeriesId, sceneId: nextSceneIds[index], placeholderId: nextShotIds[index], requestId: requestIds[index] }, anchor, undefined, refs), creditQuote: quote });
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

  async function redrawShot(index: number, override?: Partial<GenerationConfig>, promptOverride?: string) {
    const shot = shots[index];
    if (lock.current || !shot || ['generating', 'waiting', 'submitting', 'unsubmitted', 'receiving'].includes(shot.kind)) return;
    if (!(promptOverride ?? shot.task.prompt).trim()) { pushToast('error', '请先填写并检查本镜提示词'); return; }
    lock.current = true; setSubmitting(true);
    try {
      const nextSceneId = sceneIds[index] || randomId();
      const identity = { seriesId: seriesId || randomId(), sceneId: nextSceneId, placeholderId: randomId(), requestId: randomId() };
      const anchor = shot.record || seriesResults[0];
      const refs = anchor ? [{ id: anchor.id, recordId: anchor.id, name: '主体参考.png', dataUrl: await getRecordDataUrl(anchor), size: anchor.bytes || 0 }] : undefined;
      const input = await createInput(index, { ...shot.task, prompt: promptOverride ?? shot.task.prompt }, identity, undefined, override, refs);
      const nextSceneIds = tasks.map((_, i) => i === index ? nextSceneId : sceneIds[i] || randomId());
      const nextShotIds = tasks.map((_, i) => i === index ? identity.placeholderId : shotIds[i] || '');
      const nextOverrides = override ? { ...overrides, [nextSceneId]: { ...overrides[nextSceneId], ...override } } : overrides;
      const nextTaskText = promptOverride === undefined ? taskText : tasks.map((task, i) => `${task.title}: ${(i === index ? promptOverride : task.prompt).replaceAll('\n', ' ')}`).join('\n');
      setSeriesId(identity.seriesId); setSceneIds(nextSceneIds); setShotIds(nextShotIds); setOverrides(nextOverrides); setTaskText(nextTaskText);
      const draft: SeriesDraft = { ...currentDraft, seriesId: identity.seriesId, sceneIds: nextSceneIds, shotIds: nextShotIds, overrides: nextOverrides, taskText: nextTaskText };
      const revision = await writeWorkspaceDraft('series', draft);
      await registerWorkspaceSubmission('series', draft, [input.requestId], { revision, append: true });
      await onSubmit(input);
      pushToast('success', `第 ${index + 1} 镜已加入重绘队列`);
    } catch (error) { pushToast('error', error instanceof Error ? error.message : '单镜重绘失败'); }
    finally { lock.current = false; setSubmitting(false); }
  }
  function beginEdit(index: number) {
    if (lock.current || ['generating', 'submitting', 'unsubmitted', 'receiving'].includes(shots[index]?.kind)) return;
    const settings = { ...config, ...overrides[sceneIds[index]] };
    setEditing({ index, prompt: tasks[index].prompt, aspectRatio: settings.aspectRatio, quality: settings.quality, outputFormat: settings.outputFormat });
  }
  async function saveEdit() {
    if (!editing || !editing.prompt.trim()) return;
    const { index, prompt, ...settings } = editing;
    const shot = shots[index];
    try {
      if (['generating', 'submitting', 'unsubmitted', 'receiving'].includes(shot.kind)) throw new Error('本镜正在提交或处理, 请等待完成后再调整');
      const previousRevision = shot.job?.status === 'pending' ? await writeWorkspaceDraft('series', currentDraft) : undefined;
      if (shot.job?.status === 'pending') {
        const input = await getOutboxInput(shot.job.requestId);
        if (!input) throw new Error('此浏览器没有待执行任务的原始配方');
        const updated = await createInput(index, { ...shot.task, prompt }, { seriesId, sceneId: input.clientContext.sceneId!, placeholderId: input.clientContext.placeholderId, requestId: input.requestId }, input.referenceJobId, settings);
        updated.clientContext.version = input.clientContext.version || 1;
        await onUpdate(shot.job.id, updated);
      }
      const sceneId = sceneIds[index] || randomId();
      const nextSceneIds = tasks.map((_, i) => i === index ? sceneId : sceneIds[i] || randomId());
      const nextOverrides = { ...overrides, [sceneId]: settings };
      const nextTaskText = tasks.map((task, i) => `${task.title}: ${(i === index ? prompt : task.prompt).replaceAll('\n', ' ')}`).join('\n');
      setSceneIds(nextSceneIds); setOverrides(nextOverrides); setTaskText(nextTaskText); setEditing(null);
      if (shot.job?.status === 'pending') {
        const draft: SeriesDraft = { ...currentDraft, sceneIds: nextSceneIds, overrides: nextOverrides, taskText: nextTaskText };
        const revision = await writeWorkspaceDraft('series', draft);
        await registerWorkspaceSubmission('series', draft, [shot.job.requestId], { revision, append: true, previousRevision });
      }
      if (shot.record && shot.job?.status !== 'pending') await redrawShot(index, settings, prompt);
      else pushToast('success', shot.job?.status === 'pending' ? '排队分镜已更新' : '本镜设置已保存');
    } catch (error) { pushToast('error', error instanceof Error ? error.message : '本镜设置保存失败'); }
  }
  async function exportSeries() { try { await downloadRecords(seriesResults, `sprout-series-${seriesId}`); pushToast('success', `已打包 ${seriesResults.length} 幕`); } catch { pushToast('error', '打包失败, 请检查本地原图'); } }
  function removeShot(index: number) { setTaskText(tasks.filter((_, i) => i !== index).map((task) => `${task.title}: ${task.prompt}`).join('\n')); setSceneIds((old) => old.filter((_, i) => i !== index)); setShotIds((old) => old.filter((_, i) => i !== index)); setCount((old) => Math.max(3, old - 1)); }
  return { ready, template, setTemplate, brief, setBrief, taskText, setTaskText, count, setCount, config, setConfig, tasks, busy, submitting, toasts, pushToast, seriesId, seriesResults, allSeriesResults, activeJobs, canContinue, submissionCount: canContinue ? missingStaged.length : shots.filter((shot) => !shot.record).length, metadata, view, setView, preview, setPreview, shots, shotIds, splitStory, submitBatch, exportSeries, updateTask, removeShot, resetSeries, redrawShot, reference, setReference, uploadReference, editing, setEditing, beginEdit, saveEdit };
}
