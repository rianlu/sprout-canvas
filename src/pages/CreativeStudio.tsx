import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { GenerationConfig, RectSelection, RefImage, ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { createRectMaskDataUrl } from '../lib/editor/mask';
import { randomId } from '../lib/random/id';
import { applyAnyImageStyleToPrompt, findImageStyle } from '../lib/styles/image-styles';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import type { QueueSubmitInput } from '../lib/api/queue';
import { ModeTabs } from '../components/studio/ModeTabs';
import { PromptWell } from '../components/studio/PromptWell';
import { StyleQuickPicker } from '../components/studio/StyleQuickPicker';
import { ReferencePanel } from '../components/studio/ReferencePanel';
import { ParamsPanel } from '../components/studio/ParamsPanel';
import { ResultStream } from '../components/studio/ResultStream';

interface CreativeStudioProps {
  onSubmit: (input: QueueSubmitInput) => Promise<QueueJob>;
  onRetry: (jobId: string) => Promise<QueueJob>;
  results: ResultRecord[];
  jobs: QueueJob[];
}

const STUDIO_STYLE_DRAFT_KEY = 'studio_style';
const STUDIO_PROMPT_DRAFT_KEY = 'studio_prompt';

export function CreativeStudio({ onSubmit, onRetry, results, jobs }: CreativeStudioProps) {
  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const [styleId, setStyleId] = useState(() => readDraft(STUDIO_STYLE_DRAFT_KEY));
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const railRef = useRef<HTMLDivElement>(null);
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
      editSelection: null,
    };
  });

  // 草稿持久化
  useEffect(() => { writeDraft(STUDIO_PROMPT_DRAFT_KEY, config.prompt); }, [config.prompt]);
  useEffect(() => { writeDraft(STUDIO_STYLE_DRAFT_KEY, styleId); }, [styleId]);

  // 比例/清晰度变化时同步实际尺寸
  useEffect(() => {
    setConfig((current) => {
      const size = resolveSize(current.aspectRatio, current.sizeTier);
      if (current.requestSize === size.size) return current;
      return { ...current, requestSize: size.size, sizeHint: size.hint };
    });
  }, [config.aspectRatio, config.sizeTier]);

  const selectedStyle = useMemo(() => findImageStyle(styleId), [styleId]);

  // 当前页可见的结果/任务 (单图 kind)
  const currentResults = useMemo(() => results.filter((record) => record.kind !== 'series' && submittedIds.includes(record.id)), [results, submittedIds]);
  const currentJobs = useMemo(() => jobs.filter((job) => {
    const context = job.clientContext;
    if (!context || context.kind !== 'single') return false;
    return submittedIds.includes(context.placeholderId || job.id);
  }), [jobs, submittedIds]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const patchConfig = useCallback((patch: Partial<GenerationConfig>) => {
    setConfig((current) => {
      if (patch.mode && patch.mode !== current.mode) {
        return { ...current, ...patch, refImages: patch.mode === 'text' ? [] : current.refImages, editSelection: patch.mode === 'text' ? null : current.editSelection };
      }
      return { ...current, ...patch };
    });
  }, []);

  const submit = useCallback(async () => {
    const prompt = config.prompt.trim();
    if (!prompt || submitting) return;
    if (config.mode === 'edit' && config.refImages.length === 0) {
      setToast({ type: 'error', message: '局部编辑需要先载入一张原图' });
      return;
    }
    setSubmitting(true);
    try {
      const style = findImageStyle(styleId);
      const snapshot: GenerationConfig = { ...config, prompt: applyAnyImageStyleToPrompt(prompt, style) };
      const effectivePrompt = snapshot.prompt;

      for (let index = 0; index < snapshot.imageCount; index += 1) {
        const placeholderId = randomId('task');
        const payload = await buildGenerationPayload(
          { ...snapshot, prompt: effectivePrompt },
          snapshot.mode === 'edit' && snapshot.editSelection
            ? (imageDataUrl: string) => createRectMaskDataUrl(imageDataUrl, snapshot.editSelection!)
            : undefined,
        );
        const refCount = Array.isArray((payload as { ref_images?: unknown }).ref_images)
          ? ((payload as { ref_images?: unknown[] }).ref_images as unknown[]).length
          : 0;
        const isEdit = snapshot.mode === 'edit' || refCount > 0;
        const endpoint: QueueSubmitInput['endpoint'] = isEdit ? '/v1/images/edits' : '/v1/images/generations';
        const job = await onSubmit({
          endpoint,
          body: JSON.stringify(payload),
          contentType: 'application/json',
          clientContext: {
            kind: 'single',
            placeholderId,
            prompt,
            mode: snapshot.mode,
            outputFormat: snapshot.outputFormat,
          },
        });
        setSubmittedIds((current) => [placeholderId, ...current]);
        setPendingIds((current) => [placeholderId, ...current]);
        if (!job?.id) throw new Error('任务提交异常');
      }
      setToast({ type: 'success', message: `已提交 ${snapshot.imageCount} 个生成任务` });
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : '提交失败, 请重试' });
    } finally {
      setSubmitting(false);
    }
  }, [config, styleId, submitting, onSubmit]);

  // ⌘/Ctrl + Enter 全局快捷提交
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  const dismiss = useCallback((placeholderId: string) => {
    setSubmittedIds((current) => current.filter((id) => id !== placeholderId));
    setPendingIds((current) => current.filter((id) => id !== placeholderId));
  }, []);

  const retryJob = useCallback(async (jobId: string, placeholderId: string) => {
    try {
      const job = await onRetry(jobId);
      if (job?.clientContext?.placeholderId) {
        setSubmittedIds((current) => [job.clientContext!.placeholderId, ...current]);
      } else {
        setSubmittedIds((current) => [placeholderId, ...current]);
      }
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : '重试失败' });
    }
  }, [onRetry]);

  const modeLabel = config.mode === 'text' ? '文生图' : config.mode === 'reference' ? '参考生成' : '局部编辑';

  return (
    <div className="studio-layout">
      <div ref={railRef} className="control-rail" aria-label="生成参数">
        <ModeTabs mode={config.mode} onModeChange={(mode) => patchConfig({ mode })} />

        <PromptWell
          value={config.prompt}
          onChange={(prompt) => setConfig((current) => ({ ...current, prompt }))}
          styleName={selectedStyle ? `${selectedStyle.name}` : null}
          onClearStyle={() => setStyleId('')}
        />

        <StyleQuickPicker
          styleId={styleId}
          onSelect={(id) => setStyleId(id)}
        />

        {config.mode !== 'text' && (
          <ReferencePanel
            images={config.refImages}
            onChange={(refImages) => setConfig((current) => ({ ...current, refImages }))}
            galleryRecords={results}
            maxImages={config.mode === 'edit' ? 1 : 6}
            singleMode={config.mode === 'edit'}
            maskSummary={config.mode === 'edit' && config.editSelection ? '已框选局部编辑区域' : null}
            onOpenMaskEditor={() => setToast({ type: 'info', message: '选区工具即将在下一阶段提供, 当前可在原图上重新框选' })}
          />
        )}

        <ParamsPanel
          config={config}
          onChange={patchConfig}
          onSubmit={() => { void submit(); }}
          submitting={submitting}
          promptEmpty={!config.prompt.trim()}
        />
      </div>

      <section aria-label="生成结果">
        <div className="result-stream-head">
          <div className="page-head-copy">
            <h1 className="t-headline-lg" style={{ margin: 0 }}>创作画卷</h1>
            <p>{modeLabel} · 提交后按队列顺序出图</p>
          </div>
        </div>
        <ResultStream
          records={currentResults}
          jobs={currentJobs}
          pendingIds={pendingIds}
          onRetry={(jobId, placeholderId) => { void retryJob(jobId, placeholderId); }}
          onDismiss={dismiss}
          onDelete={dismiss}
        />
      </section>

      {toast && (
        <div className={`toast ${toast.type}`} role="status" aria-live="polite">
          <Sparkles size={15} aria-hidden="true" />
          {toast.message}
        </div>
      )}
    </div>
  );
}
