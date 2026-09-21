import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationConfig, RefImage, ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import type { ImageCapabilities } from '../types/provider';
import { prepareImageFile } from '../lib/image/compress';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { LOCK_UNSUPPORTED_IMAGE_OPTIONS, LOCKED_IMAGE_DEFAULTS } from '../lib/image/channel-limits';
import type { QueueSubmitInput } from '../lib/api/queue';
import { requestTextGeneration } from '../lib/api/text';
import { getStyles } from '../lib/api/styles';
import { MAX_REFERENCE_IMAGES } from '../../shared/generation-contract.mjs';
import { getCreditQuote } from '../lib/credits';
import { brushMaskToDataUrl, brushStrokeCount, hasEditableRegion, type BrushMaskData } from '../lib/editor/brush-mask';
import { MaskEditor } from '../components/editor/MaskEditor';
import { SplitToolDrawer } from '../components/tools/SplitToolDrawer';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { copyRecordImage, downloadRecord } from '../lib/image/gallery';
import { readWorkspaceDraft, writeWorkspaceDraft, registerWorkspaceSubmission, unconfirmedWorkspaceBatch } from '../lib/storage/gallery-db';
import { recoverSubmissionBatch } from '../lib/queue-recovery';
import { imageEditConfig, sourceImageDraft, studioReferenceImages, styleTemplateSnapshot, type StudioDraft, type StudioStyleTemplate } from '../lib/image/recipe';
import { StitchStudioRail, StitchCanvasStream, type CanvasEntry } from '../components/stitch-studio/StitchStudioRail';
import { selectStudioFeed } from '../lib/studio-feed';
import { readPromptHistory, togglePromptHistory, type PromptHistory } from '../lib/prompt-history';
import { PROMPT_POLISH_INSTRUCTIONS, validatePolishedPrompt } from '../../shared/prompt-polish.mjs';
import { ToastStack } from '../components/shell/QueueDrawer';
import { StitchGalleryViewer } from '../components/gallery/StitchGalleryViewer';

interface CreativeStudioProps {
  onOpenStyles: () => void;
  onOpenGallery: () => void;
  onSubmitBatch: (inputs: QueueSubmitInput[]) => Promise<QueueJob[]>;
  onCancel: (jobId: string) => Promise<void>;
  onUseRecipe: (record: ResultRecord) => void;
  onRetry: (jobId: string) => Promise<QueueJob>;
  results: ResultRecord[];
  jobs: QueueJob[];
  imageCapabilities?: ImageCapabilities;
}

const STUDIO_STYLE_DRAFT_KEY = 'studio_style';
const STUDIO_PROMPT_DRAFT_KEY = 'studio_prompt';

/**
 * 单图创作页 (照搬 Stitch 单图稿). DOM 类名原样, 逻辑层复用 v3.0.
 */
export function CreativeStudio({ onOpenStyles, onOpenGallery, onSubmitBatch, onCancel, onUseRecipe, onRetry, results, jobs, imageCapabilities }: CreativeStudioProps) {
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [retryingJobs, setRetryingJobs] = useState<Set<string>>(new Set());
  const submitLock = useRef(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [restoredMask, setRestoredMask] = useState('');
  const [sourceRecord, setSourceRecord] = useState<ResultRecord | null>(null);
  const [polishing, setPolishing] = useState(false);
  const polishLock = useRef(false);
  const [promptHistory, setPromptHistory] = useState<PromptHistory | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageLock = useRef(false);
  const imageSequence = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; imageSequence.current++; }; }, []);

  const [styleId, setStyleId] = useState(() => readDraft(STUDIO_STYLE_DRAFT_KEY) || 'default');
  const [styleName, setStyleName] = useState('');
  const [styleTemplate, setStyleTemplate] = useState<StudioStyleTemplate | null>(null);
  const [catalogTemplate, setCatalogTemplate] = useState<StudioStyleTemplate | null>(null);
  const [mask, setMask] = useState<BrushMaskData | null>(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(() => readDraft('studio_open_mask') === '1');
  const [refImage, setRefImage] = useState<RefImage | null>(() => {
    try {
      const raw = readDraft('studio_ref_image');
      if (raw) return JSON.parse(raw) as RefImage;
    } catch {
      /* ignore */
    }
    return null;
  });

  useEffect(() => {
    if (!imageCapabilities || !draftLoaded) return;
    setConfig((current) => {
      if (current.mode === 'edit') return current;
      const next = { ...current };
      if (!imageCapabilities.formats.includes(current.outputFormat as 'png' | 'jpeg' | 'webp')) next.outputFormat = imageCapabilities.formats[0];
      if (!imageCapabilities.customSizes && !['1:1', '3:2', '2:3', 'auto'].includes(current.aspectRatio)) {
        const size = resolveSize('1:1');
        next.aspectRatio = '1:1'; next.sizeTier = '1K'; next.requestSize = size.size; next.sizeHint = size.hint;
      }
      return next.outputFormat === current.outputFormat && next.aspectRatio === current.aspectRatio ? current : next;
    });
  }, [imageCapabilities, draftLoaded]);
  const [fullscreen, setFullscreen] = useState<ResultRecord | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitRecord, setSplitRecord] = useState<ResultRecord | null>(null);
  const [config, setConfig] = useState<GenerationConfig>(() => {
    const size = resolveSize('1:1');
    return {
      mode: 'text',
      generationMode: 'images',
      imageModel: 'gpt-image-2',
      prompt: readDraft(STUDIO_PROMPT_DRAFT_KEY),
      imageCount: 1,
      aspectRatio: '1:1',
      sizeTier: '1K',
      requestSize: size.size,
      sizeHint: size.hint,
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
      outputCompression: 90,
      refImages: [],
    };
  });

  const pushToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    const id = randomId();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await readWorkspaceDraft<StudioDraft>('studio');
      const transfer = await readWorkspaceDraft<StudioDraft>('studio-transfer');
      if (!alive) return;
      const draft = { ...stored, ...transfer, promptHistory: transfer ? null : readPromptHistory(stored?.promptHistory) };
      if (draft.config) setConfig((current) => {
        const next = { ...current, ...stored?.config, ...transfer?.config, prompt: transfer?.config?.prompt ?? stored?.config?.prompt ?? current.prompt };
        if (LOCK_UNSUPPORTED_IMAGE_OPTIONS) Object.assign(next, LOCKED_IMAGE_DEFAULTS);
        return next;
      });
      if (draft.styleId !== undefined) setStyleId(draft.styleId || 'default');
      setStyleName(draft.styleName || '');
      setStyleTemplate(draft.styleTemplate && draft.styleTemplate.id === draft.styleId ? draft.styleTemplate : null);
      if (draft.refImage !== undefined || draft.config?.refImages?.length) setRefImage(draft.refImage || studioReferenceImages(draft)[0] || null);
      setSourceRecord(draft.sourceRecord || null);
      if (draft.mask !== undefined) setMask(draft.mask);
      setRestoredMask(draft.maskDataUrl || '');
      setPromptHistory(draft.promptHistory);
      const transferredStyle = transfer?.styleId && transfer.styleId !== 'default' ? transfer.styleName || '提示词模板' : '';
      if (transferredStyle) setMaskEditorOpen(false);
      if (transfer) {
        await writeWorkspaceDraft('studio', { ...draft, config: { ...stored?.config, ...transfer.config } });
        await writeWorkspaceDraft('studio-transfer', undefined);
      }
      if (alive) {
        setDraftLoaded(true);
        if (transferredStyle) pushToast('success', `已载入 ${transferredStyle}, 可修改后开始绘制`);
      }
    })().catch((error) => { if (alive) { setDraftLoaded(true); pushToast('error', error instanceof Error ? error.message : '草稿读取失败'); } });
    return () => { alive = false; };
  }, [pushToast]);
  const currentDraft = useMemo<StudioDraft>(() => ({ config, styleId, styleName, styleTemplate, refImage, sourceRecord, mask, tone: 'none', maskDataUrl: restoredMask, promptHistory }), [config, styleId, styleName, styleTemplate, refImage, sourceRecord, mask, restoredMask, promptHistory]);
  const currentDraftRef = useRef(currentDraft);
  currentDraftRef.current = currentDraft;
  useEffect(() => {
    if (!draftLoaded) return;
    void writeWorkspaceDraft('studio', currentDraft).catch(() => pushToast('error', '草稿未能保存, 请检查本地空间'));
  }, [currentDraft, draftLoaded, pushToast]);

  useEffect(() => {
    if (!draftLoaded || styleId === 'default' || styleTemplate) return;
    let cancelled = false;
    void getStyles().then((catalog) => {
      const style = catalog.styles.find((item) => item.id === styleId);
      if (!cancelled && style) setCatalogTemplate({ ...styleTemplateSnapshot(style), name: styleName || style.name });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [draftLoaded, styleId, styleName, styleTemplate]);

  // 草稿持久化 (v2 兼容键名)
  useEffect(() => {
    writeDraft('studio_open_mask', '');
  }, []);
  useEffect(() => {
    writeDraft(STUDIO_PROMPT_DRAFT_KEY, config.prompt);
  }, [config.prompt]);
  useEffect(() => {
    writeDraft(STUDIO_STYLE_DRAFT_KEY, styleId);
  }, [styleId]);

  const handleConfigChange = useCallback((patch: Partial<GenerationConfig>) => {
    setConfig((current) => {
      if (current.mode === 'edit') return patch.prompt === undefined ? current : { ...current, prompt: patch.prompt };
      const next = { ...current, ...patch };
      if (patch.aspectRatio !== undefined || patch.sizeTier !== undefined) {
        const size = resolveSize(next.aspectRatio, next.sizeTier);
        next.requestSize = size.size; next.sizeHint = size.hint;
      }
      if (LOCK_UNSUPPORTED_IMAGE_OPTIONS) {
        next.quality = LOCKED_IMAGE_DEFAULTS.quality;
        next.outputFormat = LOCKED_IMAGE_DEFAULTS.outputFormat;
        next.background = LOCKED_IMAGE_DEFAULTS.background;
      } else {
        if (patch.background === 'transparent' && next.outputFormat === 'jpeg') next.outputFormat = 'png';
        if (patch.outputFormat === 'jpeg' && next.background === 'transparent') next.background = 'auto';
      }
      return next;
    });
  }, []);

  // 润色扩写 (真实 /api/text)
  const handlePolish = useCallback(async () => {
    if (polishLock.current || submitLock.current || !draftLoaded || config.mode === 'edit') return;
    if (!config.prompt.trim()) {
      pushToast('info', '先写下一点灵感再润色');
      return;
    }
    polishLock.current = true; setPolishing(true);
    const original = config.prompt;
    try {
      await writeWorkspaceDraft('studio', currentDraftRef.current);
      await requestTextGeneration(
        PROMPT_POLISH_INSTRUCTIONS, original, 'prompt', undefined,
        async (result) => {
          const polished = validatePolishedPrompt(result.text);
          const latest = currentDraftRef.current;
          if (!alive.current || latest.config?.mode === 'edit' || latest.config?.prompt !== original) {
            throw new Error('原草稿已切换, 润色结果已保留. 回到原文后可再次点击润色领取');
          }
          const history = polished === original ? latest.promptHistory || null : { before: original, after: polished, restored: false };
          const next: StudioDraft = { ...latest, config: { ...latest.config, prompt: polished }, promptHistory: history };
          const saved = await writeWorkspaceDraft('studio', next, { expected: latest });
          if (!saved) throw new Error('草稿已在其他页面变更, 未覆盖内容. 润色结果已保留');
          if (!alive.current || currentDraftRef.current.config?.prompt !== original || currentDraftRef.current.config?.mode === 'edit') return;
          currentDraftRef.current = { ...currentDraftRef.current, config: { ...currentDraftRef.current.config, prompt: polished }, promptHistory: history };
          setConfig((current) => ({ ...current, prompt: polished }));
          setPromptHistory(history);
          pushToast('success', polished === original ? '原文已清晰, 已保留原文' : '已润色, 可继续修改或撤销');
        },
      );
    } catch (error) {
      if (alive.current) pushToast('error', error instanceof Error ? error.message : '润色失败, 请检查网络后重试');
    } finally {
      polishLock.current = false;
      if (alive.current) setPolishing(false);
    }
  }, [config.prompt, config.mode, draftLoaded, pushToast]);

  const handleTogglePolish = useCallback(() => {
    const draft = currentDraftRef.current;
    if (polishLock.current || submitLock.current || !draft.promptHistory || draft.config?.mode === 'edit') return;
    const next = togglePromptHistory(draft.promptHistory, draft.config?.prompt || '');
    currentDraftRef.current = { ...draft, config: { ...draft.config, prompt: next.prompt }, promptHistory: next.history };
    setConfig((current) => ({ ...current, prompt: next.prompt }));
    setPromptHistory(next.history);
  }, []);

  const maxReferences = Math.min(MAX_REFERENCE_IMAGES, imageCapabilities?.maxReferences ?? MAX_REFERENCE_IMAGES);
  const referenceImages = useMemo(() => studioReferenceImages({ refImage, config }), [refImage, config]);

  // All input methods append in order; only an explicit replacement changes an existing image.
  const handleUploadRefs = useCallback(
    async (files: File[], replaceId?: string) => {
      if (!files.length || imageLock.current || submitLock.current || maskEditorOpen) return;
      const previous = currentDraftRef.current;
      const references = studioReferenceImages(previous);
      if (replaceId && !references.some((reference) => reference.id === replaceId)) return;
      if (previous.config?.mode === 'edit' && !replaceId) return;
      if (replaceId && files.length !== 1) { pushToast('error', '更换图片时请选择一张图片'); return; }
      if (!replaceId && references.length + files.length > maxReferences) {
        pushToast('error', `最多使用 ${maxReferences} 张参考图, 当前还可添加 ${Math.max(0, maxReferences - references.length)} 张`);
        return;
      }
      const sequence = ++imageSequence.current;
      imageLock.current = true; setImageBusy(true);
      try {
        const prepared: RefImage[] = [];
        for (const file of files) prepared.push({ id: randomId(), ...await prepareImageFile(file, { preserveOriginal: true }) });
        if (!alive.current || imageSequence.current !== sequence) return;
        const next = replaceId ? references.map((reference) => reference.id === replaceId ? prepared[0] : reference) : [...references, ...prepared];
        const source = next[0].recordId ? (previous.sourceRecord?.id === next[0].recordId ? previous.sourceRecord : results.find((record) => record.id === next[0].recordId) || null) : null;
        currentDraftRef.current = { ...currentDraftRef.current, refImage: next[0], sourceRecord: source, mask: null, maskDataUrl: '', config: { ...currentDraftRef.current.config, mode: 'reference', refImages: next } };
        setRefImage(next[0]);
        setSourceRecord(source);
        setConfig((current) => ({ ...current, mode: 'reference', refImages: next }));
        setMask(null);
        setRestoredMask('');
      } catch (error) {
        if (alive.current && imageSequence.current === sequence) pushToast('error', error instanceof Error ? error.message : '图片读取失败, 请换一张试试');
      } finally {
        if (imageSequence.current === sequence) { imageLock.current = false; if (alive.current) setImageBusy(false); }
      }
    },
    [pushToast, maskEditorOpen, maxReferences, results],
  );

  const handleRemoveRef = useCallback((id?: string) => {
    if (imageLock.current || submitLock.current) return;
    const draft = currentDraftRef.current;
    const next = id ? studioReferenceImages(draft).filter((reference) => reference.id !== id) : [];
    const first = next[0] || null;
    const source = first?.recordId ? (draft.sourceRecord?.id === first.recordId ? draft.sourceRecord : results.find((record) => record.id === first.recordId) || null) : null;
    const mode = next.length ? 'reference' : 'text';
    currentDraftRef.current = { ...draft, refImage: first, sourceRecord: source, mask: null, maskDataUrl: '', config: { ...draft.config, mode, refImages: next } };
    setRefImage(first); setSourceRecord(source); setMask(null); setRestoredMask('');
    setConfig((current) => ({ ...current, mode, refImages: next }));
  }, [results]);

  // 提交 (buildGenerationPayload 走真实协议: ref_images + maskFactory)
  const handleSubmit = useCallback(async () => {
    if (!config.prompt.trim() || submitLock.current || imageLock.current || !draftLoaded || !imageCapabilities || submitting || polishing || maskEditorOpen || fullscreen || splitOpen) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const creditQuote = getCreditQuote();
      const unconfirmed = await unconfirmedWorkspaceBatch('studio', currentDraft);
      if (unconfirmed.length) {
        const recovered = await recoverSubmissionBatch(unconfirmed, creditQuote);
        await onSubmitBatch(recovered.inputs);
        pushToast('success', recovered.recreated ? `已使用当前访问码重新提交 ${recovered.inputs.length} 张图片` : `已确认原批次的 ${unconfirmed.length} 张任务, 不会重复提交`);
        return;
      }
      const isEdit = config.mode === 'edit';
      if (!isEdit && !imageCapabilities.formats.includes(config.outputFormat === 'auto' ? 'png' : config.outputFormat)) throw new Error('当前通道不支持所选生成格式, 请重新选择');
      const count = isEdit ? 1 : config.imageCount;
      const requestIds = Array.from({ length: count }, () => randomId());
      if (isEdit && (!refImage || !(mask || restoredMask))) throw new Error('请先涂抹并保存需要修改的区域');
      if (isEdit && refImage && !await hasEditableRegion(mask || { strokes: [], width: 0, height: 0 }, refImage.dataUrl, restoredMask)) throw new Error('蒙版没有需要修改的区域, 请重新涂抹');
      const styledPrompt = isEdit
        ? `在输入原图上进行局部编辑, 仅修改蒙版指定区域, 保持原图画幅, 构图和画风, 尽量保留未涂抹区域的内容与细节.\n修改要求: ${config.prompt}`
        : config.prompt;
      const refImages = isEdit ? [refImage!] : referenceImages;
      if (refImages.length > maxReferences) throw new Error(`最多使用 ${maxReferences} 张参考图, 请先移除多余图片`);
      const payload = await buildGenerationPayload(
        {
          ...config,
          mode: isEdit ? 'edit' : refImage ? 'reference' : 'text',
          prompt: styledPrompt,
          imageCount: 1,
          refImages,
        },
        isEdit ? (mask ? (imageDataUrl: string) => brushMaskToDataUrl(mask, imageDataUrl) : restoredMask ? async () => restoredMask : undefined) : undefined,
      );
      const batchId = randomId();
      const editSource = isEdit ? sourceRecord : null;
      const inputs: QueueSubmitInput[] = requestIds.map((requestId) => ({
        requestId, request: payload, creditQuote,
        ...(editSource?.recipe?.providerId ? { providerId: editSource.recipe.providerId } : {}),
        clientContext: {
          kind: editSource?.kind || 'single', placeholderId: randomId(), prompt: config.prompt,
          mode: isEdit ? 'edit' : refImage ? 'reference' : 'text',
          batchId, version: editSource ? (editSource.version || 1) + 1 : 1,
          styleId: isEdit ? editSource?.recipe?.styleId : styleId === 'default' ? undefined : styleId,
          styleName: isEdit ? editSource?.recipe?.styleName : styleId === 'default' ? undefined : styleName,
          tone: 'none',
          ...(editSource ? { parentId: editSource.id } : {}),
          ...(editSource?.kind === 'series' ? { seriesId: editSource.seriesId, sceneId: editSource.sceneId, sceneIndex: editSource.sceneIndex, template: editSource.template, masterPrompt: editSource.masterPrompt } : {}),
        },
      }));
      const revision = await writeWorkspaceDraft('studio', currentDraft);
      await registerWorkspaceSubmission('studio', currentDraft, requestIds, { revision });
      await onSubmitBatch(inputs);
      pushToast('success', `已提交 ${count} 张, 完成后自动保存到本地展馆`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : '提交失败，请重试');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }, [
    config,
    currentDraft,
    imageCapabilities,
    styleId,
    styleName,

    refImage,
    referenceImages,
    maxReferences,
    mask,
    onSubmitBatch,
    draftLoaded,
    restoredMask,
    sourceRecord,
    pushToast,
    submitting,
    polishing,
    maskEditorOpen,
    fullscreen,
    splitOpen,
  ]);

  // ⌘+Enter
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSubmit]);

  const canvasEntries = useMemo<CanvasEntry[]>(() => selectStudioFeed(jobs, results, config.mode === 'edit' ? sourceRecord?.sceneId : undefined).map((entry) => {
    if (entry.kind === 'result') return entry;
    const job = entry.job;
    return {
      kind: 'job', key: entry.key,
      job: {
        id: job.id,
        credit: job.credit,
        recoveryPoints: job.interruptionReason === 'pending-restart' && !job.outcomeUnknown ? job.credit?.points : undefined,
        recoveryUnlimited: job.interruptionReason === 'pending-restart' && !job.outcomeUnknown ? job.credit?.unlimited : undefined,
        settlementPending: job.settlementPending,
        delivery: job.delivery,
        status: job.status === 'succeeded' ? 'receiving' : job.status === 'submitting' || job.status === 'unsubmitted' ? job.status : job.status === 'running' ? 'running' : job.status === 'pending' ? 'queued' : 'failed',
        prompt: job.clientContext?.prompt ?? '',
        timing: job,
        position: job.yourPosition,
        error: job.error,
        createdAt: job.queuedAt,
        canRetry: job.canRetry,
        retrying: retryingJobs.has(job.id),
      },
    };
  }), [jobs, results, retryingJobs, config.mode, sourceRecord?.sceneId]);

  const selectedTemplate = styleId && styleId !== 'default'
    ? styleTemplate || (catalogTemplate?.id === styleId ? catalogTemplate : null) || { id: styleId, name: styleName || '已载入模板', image: '', author: '', category: '' }
    : null;

  const maskStrokes = mask ? brushStrokeCount(mask) : restoredMask ? 1 : 0;

  const handleDownload = useCallback((record: ResultRecord) => {
    void downloadRecord(record).catch(() => pushToast('error', '下载失败, 请检查本地原图'));
  }, [pushToast]);
  const handleCopy = useCallback((record: ResultRecord) => {
    return copyRecordImage(record)
      .then(() => pushToast('success', '已复制原图'))
      .catch((error) => pushToast('error', error instanceof Error ? error.message : '复制失败, 请改用下载'));
  }, [pushToast]);

  const handleUseAsRef = useCallback(async (record: ResultRecord, edit = false) => {
    const sequence = ++imageSequence.current;
    imageLock.current = true; setImageBusy(true);
    try {
      const draft = await sourceImageDraft(record, edit);
      if (!alive.current || imageSequence.current !== sequence) return;
      currentDraftRef.current = { ...currentDraftRef.current, ...draft, promptHistory: null };
      setPromptHistory(null);
      setRefImage(draft.refImage || null);
      setSourceRecord(draft.sourceRecord || null);
      setConfig((current) => ({ ...current, ...draft.config }));
      setStyleId('default');
      setStyleName('');
      setStyleTemplate(null);
      setMask(null);
      setRestoredMask('');
      setFullscreen(null);
      if (edit) setMaskEditorOpen(true);
    } finally {
      if (imageSequence.current === sequence) { imageLock.current = false; if (alive.current) setImageBusy(false); }
    }
  }, []);

  const switchToEdit = useCallback(() => {
    if (imageLock.current || polishLock.current || submitLock.current || config.mode === 'edit') return;
    const first = referenceImages[0];
    if (!first) return;
    const source = first.recordId ? (sourceRecord?.id === first.recordId ? sourceRecord : results.find((record) => record.id === first.recordId) || null) : null;
    const nextConfig: GenerationConfig = { ...config, ...imageEditConfig(source), prompt: config.prompt, refImages: referenceImages };
    currentDraftRef.current = { ...currentDraftRef.current, config: nextConfig, refImage: first, sourceRecord: source, mask: null, maskDataUrl: '', styleId: 'default', styleName: '', styleTemplate: null, tone: 'none', promptHistory: null };
    setRefImage(first); setSourceRecord(source); setConfig(nextConfig);
    setMask(null); setRestoredMask('');
    setStyleId('default'); setStyleName(''); setStyleTemplate(null); setPromptHistory(null);
  }, [config, referenceImages, sourceRecord, results]);

  const openMaskEditor = useCallback(() => {
    if (imageLock.current || polishLock.current || submitLock.current || config.mode !== 'edit' || !refImage) return;
    setMaskEditorOpen(true);
  }, [config.mode, refImage]);

  const railRef = useRef<HTMLDivElement>(null);

  if (!draftLoaded) return <main className="stitch-page px-gutter-canvas"><p role="status" className="py-space-xl text-on-surface-variant">正在恢复创作草稿...</p></main>;

  return (
    <main className="w-full pt-16 bg-surface min-h-[calc(100vh-4rem)]">
      <div className="flex flex-col w-full">
        <div className="w-full px-gutter-canvas py-space-lg max-w-[1720px] mx-auto">
          <div className="studio-layout relative">
            <div ref={railRef} className="studio-rail">
              <StitchStudioRail
                onNewCreation={() => {
                  imageSequence.current++; imageLock.current = false; setImageBusy(false);
                  setConfig((current) => ({ ...current, mode: 'text', prompt: '', refImages: [] }));
                  setRefImage(null); setSourceRecord(null); setMask(null); setRestoredMask(''); setMaskEditorOpen(false);
                  setStyleId('default'); setStyleName(''); setStyleTemplate(null);
                  setPromptHistory(null);
                  writeDraft('studio_ref_image', ''); writeDraft('studio_open_mask', '');
                }}
                onOpenStyles={onOpenStyles}
                prompt={config.prompt}
                onPromptChange={(value) => { if (!polishLock.current) handleConfigChange({ prompt: value }); }}
                onPolish={() => {
                  void handlePolish();
                }}
                polishing={polishing}
                promptHistory={promptHistory}
                onTogglePolish={handleTogglePolish}
                imageBusy={imageBusy}
                selectedTemplate={selectedTemplate}
                onUnpinStyle={() => { setStyleId('default'); setStyleName(''); setStyleTemplate(null); }}
                refImage={refImage}
                referenceImages={referenceImages}
                maxReferences={maxReferences}
                onRemoveRef={handleRemoveRef}
                imageCapabilities={imageCapabilities}
                onUploadRefs={(files, replaceId) => {
                  void handleUploadRefs(files, replaceId);
                }}
                onOpenMaskEditor={openMaskEditor}
                onSwitchToEdit={switchToEdit}
                onSwitchToReference={() => {
                  const first = referenceImages[0] || refImage;
                  const source = first?.recordId ? (sourceRecord?.id === first.recordId ? sourceRecord : results.find((record) => record.id === first.recordId) || null) : null;
                  currentDraftRef.current = { ...currentDraftRef.current, refImage: first, sourceRecord: source, mask: null, maskDataUrl: '', config: { ...config, mode: 'reference', refImages: referenceImages } };
                  setRefImage(first); setSourceRecord(source); setMask(null); setRestoredMask('');
                  setConfig((current) => ({ ...current, mode: 'reference', refImages: referenceImages }));
                }}
                sourceRecord={sourceRecord}
                maskStrokes={maskStrokes}
                config={config}
                onConfigChange={handleConfigChange}
                onSubmit={() => {
                  void handleSubmit();
                }}
                submitting={submitting}
              />
            </div>

            <StitchCanvasStream
              entries={canvasEntries}
              onOpenGallery={onOpenGallery}
              onDownload={handleDownload}
              onCopy={handleCopy}
              onOpenMask={(record) => {
                void handleUseAsRef(record, true).catch((error) => pushToast('error', error instanceof Error ? error.message : '无法读取本地原图'));
              }}
              onFullscreen={setFullscreen}
              onCancelJob={(jobId) => {
                void onCancel(jobId).catch(() => pushToast('error', '取消失败，任务可能已完成'));
              }}
              onRetryJob={(jobId) => {
                setRetryingJobs((current) => new Set(current).add(jobId));
                void onRetry(jobId)
                  .catch((error) => pushToast('error', error instanceof Error ? error.message : '重试提交失败, 请重试'))
                  .finally(() => setRetryingJobs((current) => { const next = new Set(current); next.delete(jobId); return next; }));
              }}
              onEditPrompt={(prompt) => {
                if (polishLock.current) return;
                setPromptHistory(null);
                handleConfigChange({ prompt });
                railRef.current?.scrollIntoView({ behavior: 'smooth' });
                railRef.current?.querySelector('textarea')?.focus();
              }}
            />
          </div>
        </div>
      </div>

      {/* 局部重绘工作区 (MaskEditor 复用, 深色遮罩层照稿) */}
      {maskEditorOpen && refImage && (
        <MaskEditor
          key={refImage.id}
          open={maskEditorOpen}
          image={refImage}
          initialMask={mask}
          initialMaskDataUrl={restoredMask}
          regionPrompt={config.prompt}
          onClose={() => setMaskEditorOpen(false)}
          onApply={async (nextMask, prompt, maskDataUrl = '') => {
            const nextConfig: GenerationConfig = { ...config, prompt, mode: 'edit', refImages: referenceImages };
            const nextDraft: StudioDraft = { ...currentDraftRef.current, config: nextConfig, refImage, sourceRecord, mask: nextMask, maskDataUrl, styleId: 'default', styleName: '', styleTemplate: null, tone: 'none', promptHistory: null };
            await writeWorkspaceDraft('studio', nextDraft);
            if (!alive.current) return;
            currentDraftRef.current = nextDraft;
            setMask(nextMask);
            setRestoredMask(maskDataUrl);
            setConfig(nextConfig);
            setStyleId('default'); setStyleName(''); setStyleTemplate(null); setPromptHistory(null);
            setMaskEditorOpen(false);
            pushToast('success', '蒙版已保存并应用');
          }}
        />
      )}

      {/* 作品详情 */}
      {fullscreen && (
        <StitchGalleryViewer
          cards={[{ kind: 'single', record: fullscreen }]}
          initialIndex={0}
          onClose={() => setFullscreen(null)}
          onUseAsRef={(record) => void handleUseAsRef(record).catch(() => pushToast('error', '无法读取本地原图'))}
          onEditRecord={(record) => void handleUseAsRef(record, true).catch(() => pushToast('error', '无法读取本地原图'))}
          onSplit={(record) => { setFullscreen(null); setSplitRecord(record); setSplitOpen(true); }}
          onUseRecipe={onUseRecipe}
          onNotify={pushToast}
        />
      )}

      <SplitToolDrawer
        open={splitOpen}
        onClose={() => { setSplitOpen(false); setSplitRecord(null); }}
        galleryRecords={results}
        initialRecord={splitRecord}
        onUseAsReference={(record) => {
          imageSequence.current++; imageLock.current = false; setImageBusy(false);
          currentDraftRef.current = { ...currentDraftRef.current, refImage: record, sourceRecord: null, mask: null, maskDataUrl: '', config: { ...currentDraftRef.current.config, mode: 'reference', refImages: [] } };
          setRefImage(record); setSourceRecord(null); setMask(null); setRestoredMask('');
          setConfig((current) => ({ ...current, mode: 'reference', refImages: [] }));
          setSplitOpen(false); setSplitRecord(null); pushToast('success', '已设为参考图');
        }}
      />

      <ToastStack toasts={toasts} />
    </main>
  );
}
