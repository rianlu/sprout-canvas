import { useEffect, useMemo, useState } from 'react';
import type { GenerationConfig, RefImage, ResultRecord } from '../types/generation';
import { buildGenerationPayload, resolveSize } from '../lib/api/generation';
import { createRectMaskDataUrl } from '../lib/editor/mask';
import { randomId } from '../lib/random/id';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import { ModeSwitcher } from '../components/studio/ModeSwitcher';
import { PromptPanel } from '../components/studio/PromptPanel';
import { ReferenceUploader } from '../components/studio/ReferenceUploader';
import { RegionEditor } from '../components/editor/RegionEditor';
import { ResultGrid } from '../components/studio/ResultGrid';
import { Button } from '../components/ui/Button';
import type { QueueSubmitInput } from '../lib/api/queue';
import type { QueueJob } from '../types/queue';

interface CreativeStudioProps {
  onSubmit: (input: QueueSubmitInput) => Promise<QueueJob>;
  onRetry: (jobId: string) => Promise<QueueJob>;
  results: ResultRecord[];
  jobs: QueueJob[];
}

const MAX_BATCH = 8;

export function CreativeStudio({ onSubmit, onRetry, results, jobs }: CreativeStudioProps) {
  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const [editorVisible, setEditorVisible] = useState(true);
  const [config, setConfig] = useState<GenerationConfig>(() => {
    const size = resolveSize('1:1');
    return {
      mode: 'text',
      generationMode: 'images',
      imageModel: 'gpt-image-2',
      prompt: readDraft('studio_prompt'),
      imageCount: 1,
      aspectRatio: '1:1',
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
  const currentResults = useMemo(() => results.filter((record) => record.kind !== 'series' && submittedIds.includes(record.id)), [results, submittedIds]);
  const currentJobs = useMemo(() => jobs.filter((job) => {
    const context = job.clientContext;
    if (!context || context.kind !== 'single') return false;
    return submittedIds.includes(context.placeholderId || job.id);
  }), [jobs, submittedIds]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (config.mode === 'edit') setEditorVisible(true);
  }, [config.mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft('studio_prompt', config.prompt), 400);
    return () => window.clearTimeout(timer);
  }, [config.prompt]);

  function patch(next: Partial<GenerationConfig>) {
    const merged = { ...config, ...next };
    if (next.aspectRatio) {
      const size = resolveSize(next.aspectRatio);
      merged.requestSize = size.size;
      merged.sizeHint = size.hint;
    }
    if (next.mode === 'text') merged.refImages = [];
    setConfig(merged);
  }

  async function submit(snapshot: GenerationConfig) {
    if (!snapshot.prompt.trim()) throw new Error('请填写提示词');
    if ((snapshot.mode === 'reference' || snapshot.mode === 'edit') && snapshot.refImages.length === 0) throw new Error('请先添加参考图');
    if (snapshot.mode === 'edit' && (!snapshot.editSelection || snapshot.editSelection.width < 0.01 || snapshot.editSelection.height < 0.01)) throw new Error('请先框选要修改的区域');
    const batchCount = Math.max(1, Math.min(MAX_BATCH, Math.round(snapshot.imageCount) || 1));
    const payload = await buildGenerationPayload(snapshot, snapshot.editSelection ? (imageDataUrl) => createRectMaskDataUrl(imageDataUrl, snapshot.editSelection!) : undefined);
    const nextIds: string[] = [];
    for (let index = 0; index < batchCount; index += 1) {
      const id = randomId('result');
      nextIds.push(id);
      setSubmittedIds((current) => [id, ...current.filter((item) => item !== id)].slice(0, 24));
      await onSubmit({
        endpoint: '/v1/images/generations',
        body: JSON.stringify(payload),
        contentType: 'application/json',
        clientContext: { kind: 'single', placeholderId: id, prompt: snapshot.prompt, mode: snapshot.mode },
      });
    }
    return nextIds;
  }

  function clearCurrentInputs(mode: GenerationConfig['mode']) {
    setConfig((current) => ({
      ...current,
      prompt: '',
      refImages: mode === 'text' ? current.refImages : [],
      editSelection: mode === 'edit' ? null : current.editSelection,
    }));
  }

  async function handleSubmit() {
    const snapshot = config;
    setToast({ type: 'info', message: '正在提交到任务队列...' });
    try {
      const ids = await submit(snapshot);
      clearCurrentInputs(snapshot.mode);
      if (snapshot.mode === 'edit') setEditorVisible(false);
      setToast({ type: 'success', message: `已提交 ${ids.length} 个任务, 可以继续创作.` });
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : '提交失败, 请稍后重试' });
    }
  }

  const editImage = config.mode === 'edit' ? config.refImages[0] || null : null;
  const showEditEditor = config.mode === 'edit' && editorVisible;
  const showEditToggle = config.mode === 'edit' && submittedIds.length > 0 && Boolean(editImage);
  return (
    <div className="studio-page">
      <header className="studio-hero">
        <div>
          <span className="eyebrow">芽绘台</span>
          <h1>创作台</h1>
          <p>专注描述, 参考和局部编辑, 队列会在右下角统一处理.</p>
        </div>
      </header>

      <ModeSwitcher value={config.mode} onChange={(mode) => patch({ mode })} />

      <div className="studio-workbench">
        <section className="studio-composer">
          <PromptPanel config={config} onChange={patch} onSubmit={() => { void handleSubmit(); }} submitting={Boolean(toast && toast.type === 'info')} />
          {config.mode !== 'text' && <ReferenceUploader images={config.refImages} onChange={(refImages: RefImage[]) => patch({ refImages })} />}
        </section>


        <section className="studio-preview">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">Output</span>
              <h2>{showEditEditor ? '编辑选区' : '当前任务'}</h2>
            </div>
            <div className="preview-heading-actions">
              {showEditToggle && (
                <Button variant="ghost" onClick={() => setEditorVisible((value) => !value)}>
                  {editorVisible ? `查看任务 (${submittedIds.length})` : '重新框选'}
                </Button>
              )}
              <span>{showEditEditor ? '矩形框选' : `${currentResults.length}/${submittedIds.length} 完成`}</span>
            </div>
          </div>
          {showEditEditor ? <RegionEditor image={editImage} selection={config.editSelection || null} onSelectionChange={(editSelection) => patch({ editSelection })} /> : <ResultGrid records={currentResults} jobs={currentJobs} onRetry={(jobId, oldPlaceholder) => { void onRetry(jobId).then((job) => {
            const id = job.clientContext?.placeholderId || job.id;
            setSubmittedIds((current) => {
              const without = current.filter((item) => item !== id && item !== oldPlaceholder);
              return [id, ...without].slice(0, 24);
            });
          }).catch((error) => setToast({ type: 'error', message: error instanceof Error ? error.message : '重试失败' }));
        }} onDismiss={(placeholderId) => setSubmittedIds((current) => current.filter((item) => item !== placeholderId))} />}
        </section>
      </div>
      {toast && <div className={`toast ${toast.type}`} role="status" aria-live="polite">{toast.message}</div>}
    </div>
  );
}
