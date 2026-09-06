import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationConfig, RefImage, ResultRecord, StudioMode } from '../types/generation';
import type { QueueJob } from '../types/queue';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { cancelQueueJob } from '../lib/api/queue';
import type { QueueSubmitInput } from '../lib/api/queue';
import { requestTextGeneration } from '../lib/api/text';
import { brushMaskToDataUrl, brushStrokeCount, type BrushMaskData } from '../lib/editor/brush-mask';
import { MaskEditor } from '../components/editor/MaskEditor';
import { SplitToolDrawer } from '../components/tools/SplitToolDrawer';
import { randomId } from '../lib/random/id';
import { findImageStyle, applyAnyImageStyleToPrompt } from '../lib/styles/image-styles';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { imageFileExtension } from '../lib/image/format';
import { StitchStudioRail, StitchCanvasStream, type QueueJobView } from '../components/stitch-studio/StitchStudioRail';
import { ToastStack } from '../components/shell/QueueDrawer';

interface CreativeStudioProps {
  onSubmit: (input: QueueSubmitInput) => Promise<QueueJob>;
  onRetry: (jobId: string) => Promise<QueueJob>;
  results: ResultRecord[];
  jobs: QueueJob[];
}

const STUDIO_STYLE_DRAFT_KEY = 'studio_style';
const STUDIO_PROMPT_DRAFT_KEY = 'studio_prompt';

const QUICK_STYLES = [
  { id: 'default', label: '默认自然' },
  { id: 'minimal-illustration', label: '极简插画' },
  { id: 'retro-film', label: '复古胶片' },
  { id: 'soft-3d', label: '3D柔光' },
  { id: 'vector-graphics', label: '矢量图形' },
];

/** 渲染调性 (PRD v3.1): prompt 注入实现, 不动上游协议 */
const TONE_SUFFIX: Record<string, string> = {
  soft: '，柔和自然的光影，温润真实的摄影质感',
  vivid: '，色调鲜活明艳，高对比富有张力',
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

/**
 * 单图创作页 (照搬 Stitch 单图稿). DOM 类名原样, 逻辑层复用 v3.0.
 */
export function CreativeStudio({ onSubmit, onRetry, results, jobs }: CreativeStudioProps) {
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [tone, setTone] = useState<'soft' | 'vivid'>('soft');
  const [styleId, setStyleId] = useState(() => readDraft(STUDIO_STYLE_DRAFT_KEY));
  const [mask, setMask] = useState<BrushMaskData | null>(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [refImage, setRefImage] = useState<RefImage | null>(() => {
    try {
      const raw = readDraft('studio_ref_image');
      if (raw) return JSON.parse(raw) as RefImage;
    } catch { /* ignore */ }
    return null;
  });
  const [filter, setFilter] = useState<'all' | 'today' | 'starred'>('all');
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
      quality: 'auto',
      background: 'auto',
      outputFormat: 'auto',
      outputCompression: 90,
      refImages: [],
    };
  });

  const pushToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    const id = randomId();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200);
  }, []);

  // 草稿持久化 (v2 兼容键名)
  useEffect(() => { writeDraft(STUDIO_PROMPT_DRAFT_KEY, config.prompt); }, [config.prompt]);
  useEffect(() => { writeDraft(STUDIO_STYLE_DRAFT_KEY, styleId); }, [styleId]);

  useEffect(() => {
    const size = resolveSize(config.aspectRatio, config.sizeTier);
    setConfig((current) => ({ ...current, requestSize: size.size, sizeHint: size.hint }));
  }, [config.aspectRatio, config.sizeTier]);

  const handleConfigChange = useCallback((patch: Partial<GenerationConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  }, []);

  // 润色扩写 (真实 /api/text)
  const handlePolish = useCallback(async () => {
    if (!config.prompt.trim()) { pushToast('info', '先写下一点灵感再润色'); return; }
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
  const handleReplaceRef = useCallback(async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setRefImage({ id: randomId(), name: file.name, dataUrl, size: file.size });
      setConfig((current) => ({ ...current, mode: 'image' as StudioMode }));
      setMask(null);
    } catch {
      pushToast('error', '图片读取失败，请换一张试试');
    }
  }, [pushToast]);

  // 提交 (buildGenerationPayload 走真实协议: ref_images + maskFactory)
  const handleSubmit = useCallback(async () => {
    if (!config.prompt.trim()) return;
    setSubmitting(true);
    try {
      const isEdit = Boolean(mask && refImage);
      const style = styleId && styleId !== 'default' ? findImageStyle(styleId) : null;
      const styledPrompt = (style ? applyAnyImageStyleToPrompt(config.prompt, style) : config.prompt) + (TONE_SUFFIX[tone] ?? '');
      const refImages: RefImage[] = refImage ? [{ id: randomId(), name: refImage.name, dataUrl: refImage.dataUrl, size: refImage.size }] : [];
      const payload = await buildGenerationPayload(
        { ...config, mode: isEdit ? 'edit' : config.mode, prompt: styledPrompt, imageCount: 1, refImages },
        mask ? (imageDataUrl: string) => brushMaskToDataUrl(mask, imageDataUrl) : undefined,
      );
      const input: QueueSubmitInput = {
        endpoint: isEdit ? '/v1/images/edits' : '/v1/images/generations',
        body: JSON.stringify(payload),
        contentType: 'application/json',
        clientContext: {
          kind: 'single',
          placeholderId: randomId(),
          prompt: config.prompt,
          mode: isEdit ? 'edit' : config.mode,
          outputFormat: config.outputFormat,
        },
      };
      await onSubmit(input);
      pushToast('success', '已加入队列，渲染完成后自动入列');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }, [config, styleId, tone, refImage, mask, onSubmit, pushToast]);

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

  const jobViews: QueueJobView[] = useMemo(() => jobs
    .filter((j) => ['running', 'queued', 'pending', 'failed'].includes(j.status))
    .filter((j) => (j.clientContext?.kind ?? 'single') === 'single')
    .map((j) => ({
      id: j.id,
      status: j.status === 'running' ? 'running' : j.status === 'failed' ? 'failed' : 'queued',
      prompt: j.clientContext?.prompt ?? '',
      elapsedMs: j.elapsedMs,
      position: j.yourPosition,
      error: j.error,
    })), [jobs]);

  const pinnedStyleName = useMemo(() => {
    if (!styleId || styleId === 'default') return null;
    const style = findImageStyle(styleId);
    if (style) return style.name;
    const quick = QUICK_STYLES.find((s) => s.id === styleId);
    return quick ? quick.label : null;
  }, [styleId]);

  const maskStrokes = mask ? brushStrokeCount(mask) : 0;

  const handleDownload = useCallback((record: ResultRecord) => {
    const ext = imageFileExtension(record.dataUrl, record.outputFormat);
    triggerDownload(record.dataUrl, `sprout-${record.id}.${ext}`);
  }, []);

  const handleUseAsRef = useCallback(async (record: ResultRecord) => {
    setRefImage({ id: record.id, name: `作品-${record.id.slice(-3)}.png`, dataUrl: record.dataUrl, size: 0 });
    setConfig((current) => ({ ...current, mode: 'image' as StudioMode }));
    setMask(null);
  }, []);

  const railRef = useRef<HTMLDivElement>(null);

  return (
    <main className="w-full pt-16 bg-surface min-h-[calc(100vh-4rem)]">
      <div className="flex flex-col w-full">
        <div className="w-full px-gutter-canvas py-space-lg max-w-[1720px] mx-auto">
          <div className="flex flex-col lg:flex-row gap-space-lg items-start relative">
            <div ref={railRef}>
              <StitchStudioRail
                prompt={config.prompt}
                onPromptChange={(value) => handleConfigChange({ prompt: value })}
                onPolish={() => { void handlePolish(); }}
                polishing={polishing}
                pinnedStyleName={pinnedStyleName}
                onUnpinStyle={() => setStyleId('')}
                quickStyles={QUICK_STYLES}
                activeStyleId={styleId}
                onPickStyle={(id) => setStyleId(id)}
                refImage={refImage}
                onReplaceRef={(file) => { void handleReplaceRef(file); }}
                onOpenMaskEditor={() => {
                  if (!refImage) { pushToast('info', '先上传参考图才能涂抹蒙版'); return; }
                  setMaskEditorOpen(true);
                }}
                maskStrokes={maskStrokes}
                tone={tone}
                onToneChange={setTone}
                config={config}
                onConfigChange={handleConfigChange}
                onSubmit={() => { void handleSubmit(); }}
                submitting={submitting}
              />
            </div>

            <StitchCanvasStream
              jobs={jobViews}
              results={results}
              filter={filter}
              onFilterChange={setFilter}
              onDownload={handleDownload}
              onUseAsRef={(record) => { void handleUseAsRef(record); }}
              onOpenMask={(record) => {
                void handleUseAsRef(record).then(() => setMaskEditorOpen(true));
              }}
              onFullscreen={setFullscreen}
              onCancelJob={(jobId) => { void cancelQueueJob(jobId).catch(() => pushToast('error', '取消失败，任务可能已完成')); }}
              onRetryJob={(jobId) => { void onRetry(jobId).catch(() => pushToast('error', '重试失败')); }}
              onEditPrompt={() => railRef.current?.scrollIntoView({ behavior: 'smooth' })}
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
          onClose={() => setMaskEditorOpen(false)}
          onApply={(nextMask) => {
            setMask(nextMask);
            setMaskEditorOpen(false);
            pushToast('success', '蒙版已应用');
          }}
        />
      )}

      {/* 全屏查看 */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/80 backdrop-blur-md flex items-center justify-center p-space-lg"
          onClick={() => setFullscreen(null)}
          role="dialog"
          aria-label="全屏查看"
        >
          <img src={fullscreen.dataUrl} alt={fullscreen.prompt.slice(0, 60)} className="max-w-full max-h-[90vh] rounded-xl shadow-[0_24px_64px_rgba(85,95,75,0.20)]" />
        </div>
      )}

      <SplitToolDrawer
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        galleryRecords={results}
        onUseAsReference={(record) => { setRefImage({ id: record.id, name: `作品-${record.id.slice(-3)}.png`, dataUrl: record.dataUrl, size: 0 }); setConfig((current) => ({ ...current, mode: 'image' as StudioMode })); setSplitOpen(false); pushToast('success', '已设为参考图'); }}
      />

      <ToastStack toasts={toasts} />
    </main>
  );
}
