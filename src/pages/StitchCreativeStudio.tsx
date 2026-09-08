import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationConfig, RefImage, ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import type { ImageCapabilities } from '../types/provider';
import { prepareImageFile } from '../lib/image/compress';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import type { QueueSubmitInput } from '../lib/api/queue';
import { requestTextGeneration } from '../lib/api/text';
import { brushMaskToDataUrl, brushStrokeCount, hasEditableRegion, type BrushMaskData } from '../lib/editor/brush-mask';
import { MaskEditor } from '../components/editor/MaskEditor';
import { SplitToolDrawer } from '../components/tools/SplitToolDrawer';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { downloadRecord } from '../lib/image/gallery';
import { readWorkspaceDraft, writeWorkspaceDraft, registerWorkspaceSubmission } from '../lib/storage/gallery-db';
import { imageEditConfig, sourceImageDraft, type StudioDraft } from '../lib/image/recipe';
import { StitchStudioRail, StitchCanvasStream, type QueueJobView } from '../components/stitch-studio/StitchStudioRail';
import { ToastStack } from '../components/shell/QueueDrawer';
import { StitchGalleryViewer } from '../components/gallery/StitchGalleryViewer';

interface CreativeStudioProps {
  onOpenStyles: () => void;
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

/** 渲染调性 (PRD v3.1): prompt 注入实现, 不动上游协议 */
const TONE_SUFFIX: Record<string, string> = {
  soft: '，柔和自然的光影，温润真实的摄影质感',
  vivid: '，色调鲜活明艳，高对比富有张力',
};

/**
 * 单图创作页 (照搬 Stitch 单图稿). DOM 类名原样, 逻辑层复用 v3.0.
 */
export function CreativeStudio({ onOpenStyles, onSubmitBatch, onCancel, onUseRecipe, onRetry, results, jobs, imageCapabilities }: CreativeStudioProps) {
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [retryingJobs, setRetryingJobs] = useState<Set<string>>(new Set());
  const submitLock = useRef(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [restoredMask, setRestoredMask] = useState('');
  const [sourceRecord, setSourceRecord] = useState<ResultRecord | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [tone, setTone] = useState<'soft' | 'vivid' | 'none'>('soft');
  const [styleId, setStyleId] = useState(() => readDraft(STUDIO_STYLE_DRAFT_KEY) || 'default');
  const [styleName, setStyleName] = useState('');
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
  const [filter, setFilter] = useState<'all' | 'today'>('all');
  const [fullscreen, setFullscreen] = useState<ResultRecord | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
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
      quality: 'medium',
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
      const draft = { ...stored, ...transfer };
      if (draft.config) setConfig((current) => ({ ...current, ...stored?.config, ...transfer?.config, prompt: transfer?.config?.prompt ?? stored?.config?.prompt ?? current.prompt }));
      if (draft.styleId !== undefined) setStyleId(draft.styleId || 'default');
      setStyleName(draft.styleName || '');
      if (draft.refImage !== undefined) setRefImage(draft.refImage);
      setSourceRecord(draft.sourceRecord || null);
      if (draft.mask !== undefined) setMask(draft.mask);
      if (draft.tone) setTone(draft.tone);
      setRestoredMask(draft.maskDataUrl || '');
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
  const currentDraft = useMemo<StudioDraft>(() => ({ config, styleId, styleName, refImage, sourceRecord, mask, tone, maskDataUrl: restoredMask }), [config, styleId, styleName, refImage, sourceRecord, mask, tone, restoredMask]);
  useEffect(() => {
    if (!draftLoaded) return;
    void writeWorkspaceDraft('studio', currentDraft).catch(() => pushToast('error', '草稿未能保存, 请检查本地空间'));
  }, [currentDraft, draftLoaded, pushToast]);

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
      if (patch.background === 'transparent' && next.outputFormat === 'jpeg') next.outputFormat = 'png';
      if (patch.outputFormat === 'jpeg' && next.background === 'transparent') next.background = 'auto';
      return next;
    });
  }, []);

  // 润色扩写 (真实 /api/text)
  const handlePolish = useCallback(async () => {
    if (!config.prompt.trim()) {
      pushToast('info', '先写下一点灵感再润色');
      return;
    }
    setPolishing(true);
    try {
      const result = await requestTextGeneration(
        '你是中文提示词润色助手。把用户的画面描述润色为更具体、更有画面感的一句话(60字内)，保持原意与原语言，只输出润色结果。',
        config.prompt,
      );
      const polished = result?.text?.trim();
      if (polished) {
        setConfig((current) => ({ ...current, prompt: polished }));
        pushToast('success', '已润色，可继续调整');
      } else {
        pushToast('error', '润色服务暂不可用，请稍后再试');
      }
    } catch {
      pushToast('error', '润色失败，请检查网络后重试');
    } finally {
      setPolishing(false);
    }
  }, [config.prompt, pushToast]);

  // 参考图
  const handleReplaceRef = useCallback(
    async (file: File) => {
      try {
        const prepared = await prepareImageFile(file, { preserveOriginal: true });
        setRefImage({ id: randomId(), ...prepared });
        setSourceRecord(null);
        setConfig((current) => ({ ...current, mode: 'reference', refImages: [] }));
        setMask(null);
        setRestoredMask('');
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : '图片读取失败, 请换一张试试');
      }
    },
    [pushToast],
  );

  // 提交 (buildGenerationPayload 走真实协议: ref_images + maskFactory)
  const handleSubmit = useCallback(async () => {
    if (!config.prompt.trim() || submitLock.current || !draftLoaded || !imageCapabilities || submitting || polishing || maskEditorOpen || fullscreen || splitOpen) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const isEdit = config.mode === 'edit';
      if (!isEdit && !imageCapabilities.formats.includes(config.outputFormat === 'auto' ? 'png' : config.outputFormat)) throw new Error('当前通道不支持所选生成格式, 请重新选择');
      const count = isEdit ? 1 : config.imageCount;
      const requestIds = Array.from({ length: count }, () => randomId());
      const revision = await writeWorkspaceDraft('studio', currentDraft);
      await registerWorkspaceSubmission('studio', currentDraft, requestIds, { revision });
      if (isEdit && (!refImage || !(mask || restoredMask))) throw new Error('请先涂抹并保存需要修改的区域');
      if (isEdit && refImage && !await hasEditableRegion(mask || { strokes: [], width: 0, height: 0 }, refImage.dataUrl, restoredMask)) throw new Error('蒙版没有需要修改的区域, 请重新涂抹');
      const styledPrompt = isEdit
        ? `在输入原图上进行局部编辑, 仅修改蒙版指定区域, 保持原图画幅, 构图和画风, 尽量保留未涂抹区域的内容与细节.\n修改要求: ${config.prompt}`
        : config.prompt + (TONE_SUFFIX[tone] ?? '');
      const refImages: RefImage[] = refImage
        ? [refImage, ...config.refImages.filter((ref) => ref.id !== refImage.id)]
        : [];
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
        requestId, request: payload,
        ...(editSource?.recipe?.providerId ? { providerId: editSource.recipe.providerId } : {}),
        clientContext: {
          kind: editSource?.kind || 'single', placeholderId: randomId(), prompt: config.prompt,
          mode: isEdit ? 'edit' : refImage ? 'reference' : 'text',
          batchId, version: editSource ? (editSource.version || 1) + 1 : 1,
          styleId: isEdit ? editSource?.recipe?.styleId : styleId === 'default' ? undefined : styleId,
          styleName: isEdit ? editSource?.recipe?.styleName : styleId === 'default' ? undefined : styleName,
          tone: isEdit ? editSource?.recipe?.tone || 'none' : tone,
          ...(editSource ? { parentId: editSource.id } : {}),
          ...(editSource?.kind === 'series' ? { seriesId: editSource.seriesId, sceneId: editSource.sceneId, sceneIndex: editSource.sceneIndex, template: editSource.template, masterPrompt: editSource.masterPrompt } : {}),
        },
      }));
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
    tone,
    refImage,
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

  const jobViews: QueueJobView[] = useMemo(
    () =>
      jobs
        .filter((j) => !j.supersededBy)
        .filter((j) => !(j.localOnly && j.retryOf && jobs.some((source) => source.id === j.retryOf)))
        .filter((j) => ['running', 'pending', 'failed', 'interrupted', 'expired', 'unsubmitted'].includes(j.status))
        .filter((j) => (j.clientContext?.kind ?? 'single') === 'single' || (config.mode === 'edit' && sourceRecord?.sceneId && j.clientContext?.sceneId === sourceRecord.sceneId))
        .map((j) => ({
          id: j.id,
          status: j.status === 'running' ? 'running' : j.status === 'pending' ? 'queued' : 'failed',
          prompt: j.clientContext?.prompt ?? '',
          elapsedMs: j.elapsedMs,
          position: j.yourPosition,
          error: j.error,
          createdAt: j.queuedAt,
          canRetry: j.canRetry,
          retrying: retryingJobs.has(j.id),
        })),
    [jobs, retryingJobs, config.mode, sourceRecord?.sceneId],
  );

  const pinnedStyleName = styleId && styleId !== 'default' ? styleName || '已载入模板' : null;

  const maskStrokes = mask ? brushStrokeCount(mask) : restoredMask ? 1 : 0;

  const handleDownload = useCallback((record: ResultRecord) => {
    void downloadRecord(record).catch(() => pushToast('error', '下载失败, 请检查本地原图'));
  }, [pushToast]);

  const handleUseAsRef = useCallback(async (record: ResultRecord, edit = false) => {
    const draft = await sourceImageDraft(record, edit);
    setRefImage(draft.refImage || null);
    setSourceRecord(draft.sourceRecord || null);
    setConfig((current) => ({ ...current, ...draft.config }));
    setStyleId('default');
    setStyleName('');
    setTone('none');
    setMask(null);
    setRestoredMask('');
    setFullscreen(null);
    if (edit) setMaskEditorOpen(true);
  }, []);

  const openMaskEditor = useCallback(() => {
    if (!refImage) { pushToast('info', '先上传图片才能涂抹蒙版'); return; }
    if (config.mode !== 'edit') {
      setConfig((current) => ({ ...current, ...imageEditConfig(sourceRecord) }));
      setStyleId('default');
      setStyleName('');
      setTone('none');
    }
    setMaskEditorOpen(true);
  }, [refImage, config.mode, sourceRecord, pushToast]);

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
                  setConfig((current) => ({ ...current, mode: 'text', prompt: '', refImages: [] }));
                  setRefImage(null); setSourceRecord(null); setMask(null); setRestoredMask(''); setMaskEditorOpen(false);
                  setStyleId('default'); setStyleName('');
                  writeDraft('studio_ref_image', ''); writeDraft('studio_open_mask', '');
                }}
                onOpenStyles={onOpenStyles}
                prompt={config.prompt}
                onPromptChange={(value) => handleConfigChange({ prompt: value })}
                onPolish={() => {
                  void handlePolish();
                }}
                polishing={polishing}
                pinnedStyleName={pinnedStyleName}
                onUnpinStyle={() => { setStyleId('default'); setStyleName(''); }}
                refImage={refImage}
                onRemoveRef={() => { setRefImage(null); setSourceRecord(null); setMask(null); setRestoredMask(''); setConfig((current) => ({ ...current, mode: 'text', refImages: [] })); }}
                imageCapabilities={imageCapabilities}
                onReplaceRef={(file) => {
                  void handleReplaceRef(file);
                }}
                onOpenMaskEditor={openMaskEditor}
                onSwitchToReference={() => { setMask(null); setRestoredMask(''); setConfig((current) => ({ ...current, mode: 'reference' })); }}
                sourceRecord={sourceRecord}
                maskStrokes={maskStrokes}
                tone={tone}
                onToneChange={setTone}
                config={config}
                onConfigChange={handleConfigChange}
                onSubmit={() => {
                  void handleSubmit();
                }}
                submitting={submitting}
              />
            </div>

            <StitchCanvasStream
              jobs={jobViews}
              results={results}
              editingSceneId={config.mode === 'edit' ? sourceRecord?.sceneId : undefined}
              filter={filter}
              onFilterChange={setFilter}
              onDownload={handleDownload}
              onUseAsRef={(record) => {
                void handleUseAsRef(record).catch(() => pushToast('error', '无法读取本地原图'));
              }}
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
                handleConfigChange({ prompt });
                railRef.current?.scrollIntoView({ behavior: 'smooth' });
                railRef.current?.querySelector('textarea')?.focus();
              }}
              onOpenSplit={() => setSplitOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* 局部重绘工作区 (MaskEditor 复用, 深色遮罩层照稿) */}
      {refImage && (
        <MaskEditor
          open={maskEditorOpen}
          image={refImage}
          initialMask={mask}
          initialMaskDataUrl={restoredMask}
          regionPrompt={config.prompt}
          onClose={() => setMaskEditorOpen(false)}
          onApply={async (nextMask, prompt, maskDataUrl = '') => {
            await writeWorkspaceDraft('studio', { config: { ...config, prompt, mode: 'edit' }, refImage, sourceRecord, mask: nextMask, tone, maskDataUrl });
            setMask(nextMask);
            setRestoredMask(maskDataUrl);
            setConfig((current) => ({ ...current, prompt, mode: 'edit' }));
            setMaskEditorOpen(false);
            pushToast('success', '蒙版已保存并应用');
          }}
        />
      )}

      {/* 全屏查看 */}
      {fullscreen && (
        <StitchGalleryViewer
          cards={[{ kind: 'single', record: fullscreen }]}
          initialIndex={0}
          onClose={() => setFullscreen(null)}
          onUseAsRef={(record) => void handleUseAsRef(record).catch(() => pushToast('error', '无法读取本地原图'))}
          onEditRecord={(record) => void handleUseAsRef(record, true).catch(() => pushToast('error', '无法读取本地原图'))}
          onUseRecipe={onUseRecipe}
          onNotify={pushToast}
        />
      )}

      <SplitToolDrawer
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        galleryRecords={results}
        onUseAsReference={(record) => {
          setRefImage(record); setSourceRecord(null); setMask(null); setRestoredMask('');
          setConfig((current) => ({ ...current, mode: 'reference', refImages: [] }));
          setSplitOpen(false); pushToast('success', '已设为参考图');
        }}
      />

      <ToastStack toasts={toasts} />
    </main>
  );
}
