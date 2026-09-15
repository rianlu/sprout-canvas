import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/shell/AppShell';
import { GalleryGrid } from '../pages/StitchGalleryGrid';
import { HelpDialog } from '../components/shell/HelpDialog';
import { QueueDrawer } from '../components/shell/QueueDrawer';
import { CreativeStudio } from '../pages/StitchCreativeStudio';
import { SeriesStudio } from '../pages/StitchSeriesStudio';
import { StylesLibrary } from '../pages/StitchStylesLibrary';
import { AdminPage } from '../pages/AdminPage';
import { WorkspaceLogin } from '../pages/WorkspaceLogin';
import { useAuth } from '../hooks/useAuth';
import { useGallery } from '../hooks/useGallery';
import { useQueue } from '../hooks/useQueue';
import { getServerConfig } from '../lib/api/config';
import { writeDraft } from '../lib/storage/drafts';
import type { QueueSubmitInput } from '../lib/api/queue';
import type { GenerationConfig, ResultRecord } from '../types/generation';
import type { ServerConfig } from '../types/provider';
import { getRecordDataUrl, writeWorkspaceDraft } from '../lib/storage/gallery-db';
import { recipeDraft, sourceImageDraft, styleTemplateSnapshot, type StudioDraft } from '../lib/image/recipe';
import type { StyleRecord } from '../../shared/style-contract.mjs';
import { sizePreset, resolveSize } from '../lib/api/generation';
import { randomId } from '../lib/random/id';
import type { SeriesCard } from '../lib/image/gallery';
import { isQueueActive } from '../lib/queue-presentation';

export type PageKey = 'studio' | 'series' | 'styles' | 'gallery' | 'admin';
const pageFromHash = (): PageKey => {
  const value = location.hash.slice(1).split('/')[0];
  return ['studio', 'series', 'styles', 'gallery', 'admin'].includes(value) ? value as PageKey : 'studio';
};

export function App() {
  const [page, setCurrentPage] = useState<PageKey>(pageFromHash);
  const setPage = useCallback((next: PageKey) => { setCurrentPage(next); if (location.hash !== `#${next}`) history.pushState(null, '', `#${next}`); }, []);
  useEffect(() => { const changed = () => setCurrentPage(pageFromHash()); window.addEventListener('popstate', changed); window.addEventListener('hashchange', changed); return () => { window.removeEventListener('popstate', changed); window.removeEventListener('hashchange', changed); }; }, []);
  const [studioRevision, setStudioRevision] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [configRetry, setConfigRetry] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState('');
  const auth = useAuth();
  const gallery = useGallery();

  const handleResult = useCallback(gallery.add, [gallery.add]);
  const queue = useQueue(handleResult, auth.authenticated, auth.userId);
  useEffect(() => { const failed = (event: Event) => setMessage((event as CustomEvent<string>).detail); window.addEventListener('sprout:storage-error', failed); return () => window.removeEventListener('sprout:storage-error', failed); }, []);

  // 同步创作能力, 读取失败时保留可重试的操作反馈.
  useEffect(() => {
    if (!auth.authenticated) return;
    let cancelled = false;
    async function check() {
      try {
        const config = await getServerConfig();
        if (!cancelled) { setConfigError(''); setServerConfig(config); }
      } catch {
        if (!cancelled) setConfigError('暂时无法读取创作设置, 请重试');
      }
    }
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auth.authenticated, configRetry]);

  const submit = useCallback(
    (input: QueueSubmitInput) => queue.submit(input, () => setQueueOpen(true)),
    [queue.submit],
  );

  const submitBatch = useCallback((inputs: QueueSubmitInput[]) => queue.submitBatch(inputs, () => setQueueOpen(true)), [queue.submitBatch]);
  const useAsReference = useCallback(async (record: ResultRecord, edit = false) => {
    try {
      const draft = await sourceImageDraft(record, edit);
      await writeWorkspaceDraft('studio-transfer', draft);
      writeDraft('studio_style', '');
      writeDraft('studio_prompt', draft.config?.prompt || '');
      writeDraft('studio_open_mask', edit ? '1' : '');
      setStudioRevision((value) => value + 1);
      setPage('studio');
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法读取作品'); }
  }, [setPage]);
  const useRecipe = useCallback(async (record: ResultRecord) => {
    try {
      const draft = await recipeDraft(record);
      await writeWorkspaceDraft('studio-transfer', draft);
      writeDraft('studio_style', '');
      writeDraft('studio_prompt', draft.config.prompt || '');
      setStudioRevision((value) => value + 1);
      setPage('studio');
    } catch (error) { setMessage(error instanceof Error ? error.message : '配方读取失败'); }
  }, [setPage]);

  const useStyle = useCallback(async (style: StyleRecord) => {
    const draft: StudioDraft = {
      config: { mode: 'text', prompt: style.prompt, imageCount: 1, refImages: [] },
      styleId: style.id, styleName: style.name, styleTemplate: styleTemplateSnapshot(style), refImage: null, sourceRecord: null, mask: null, maskDataUrl: '', tone: 'none',
    };
    await writeWorkspaceDraft('studio-transfer', draft);
    setStudioRevision((value) => value + 1);
    setPage('studio');
  }, [setPage]);

  const deriveSeries = useCallback(async (card: SeriesCard) => {
    try {
      const first = card.records[0];
      if (!first) throw new Error('系列中没有可用作品');
      const recipe = first.recipe;
      const preset = sizePreset(recipe?.size || '1280x720');
      const seriesId = randomId();
      const sceneIds = card.records.map(() => randomId());
      const config: GenerationConfig = {
        mode: 'reference', generationMode: 'images', imageModel: '', prompt: '', imageCount: 1,
        ...preset, requestSize: recipe?.size || '1280x720', sizeHint: resolveSize(preset.aspectRatio, preset.sizeTier).hint,
        quality: recipe?.quality || 'medium', outputFormat: recipe?.outputFormat || 'png',
        background: recipe?.background || 'auto', outputCompression: recipe?.outputCompression ?? 90, refImages: [],
      };
      const reference = { id: first.id, recordId: first.id, name: '原系列主体参考', dataUrl: await getRecordDataUrl(first), size: first.bytes || 0 };
      const overrides = Object.fromEntries(card.records.map((record, index) => [sceneIds[index], record.recipe ? { ...sizePreset(record.recipe.size), quality: record.recipe.quality, outputFormat: record.recipe.outputFormat, background: record.recipe.background, outputCompression: record.recipe.outputCompression } : {}]));
      await writeWorkspaceDraft('series', { version: 1, seriesId, reference, sceneIds, shotIds: [], overrides, config, stagedIds: [] });
      const drafts = {
        batch_transfer: '', batch_brief: card.masterPrompt,
        batch_tasks: card.records.map((record, index) => `分镜 ${index + 1}: ${record.prompt.replaceAll('\n', ' ')}`).join('\n'),
        batch_count: String(card.records.length), batch_template: first.template || 'picture-book',
        batch_style: '', batch_quality: config.quality, batch_output_format: config.outputFormat,
        batch_aspect_ratio: config.aspectRatio, batch_series_id: seriesId, batch_scene_ids: JSON.stringify(sceneIds), batch_shot_ids: '',
      };
      for (const [key, value] of Object.entries(drafts)) if (!writeDraft(key, value)) throw new Error('系列草稿未能保存, 请检查浏览器可用空间');
      setPage('series');
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法复用此系列'); }
  }, [setPage]);

  if (page === 'admin') return <AdminPage onBack={() => setPage('styles')} />;
  if (auth.loading || auth.error || !auth.authenticated) return <WorkspaceLogin loading={auth.loading} connectionError={auth.error} onLogin={auth.signIn} onRetry={() => void auth.refresh(true)} />;

  return (
    <AppShell
      page={page}
      onPageChange={setPage}
      onOpenHelp={() => setHelpOpen(true)}
      onSignOut={() => void auth.signOut().catch(() => setMessage('退出失败, 请重试'))}
      queueCount={queue.jobs.filter((job) => isQueueActive(job) || job.status === 'unsubmitted').length}
      onOpenQueue={() => setQueueOpen(true)}
    >
      {!auth.canGenerate && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[65] max-w-[90vw] rounded-xl bg-secondary-container text-on-secondary-container p-3 shadow-lg text-body-sm">访问码已停用或重置, 可领取已完成结果. <button type="button" className="underline" onClick={() => void auth.signOut()}>更换访问码</button></div>}
      {(message || configError || gallery.error || queue.error) && <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] max-w-[90vw] rounded-xl bg-error-container text-on-error-container p-3 shadow-lg text-body-sm flex gap-3"><span>{message || configError || gallery.error || queue.error}</span><button type="button" onClick={() => { setMessage(''); setConfigRetry((value) => value + 1); void gallery.refresh(); void queue.refresh(); }}>重试</button></div>}
      {page === 'studio' && (
        <CreativeStudio
          key={studioRevision}
          imageCapabilities={serverConfig?.imageCapabilities}
          onOpenStyles={() => setPage('styles')}
          onOpenGallery={() => { setPage('gallery'); window.scrollTo({ top: 0 }); }}
          onSubmitBatch={submitBatch}
          onCancel={queue.cancel}
          onUseRecipe={(record) => void useRecipe(record)}
          onRetry={queue.retry}
          results={gallery.records}
          jobs={queue.jobs}
        />
      )}
      {page === 'series' && (
        <SeriesStudio
          imageCapabilities={serverConfig?.imageCapabilities}
          onEditRecord={(record) => void useAsReference(record, true)}
          onUseAsRef={(record) => void useAsReference(record)}
          onUseRecipe={(record) => void useRecipe(record)}
          onSubmitBatch={submitBatch}
          onUpdate={queue.update}
          onPrioritize={queue.prioritize}
          onRetry={queue.retry}
          onCancel={queue.cancel}
          onSubmit={submit}
          results={gallery.records}
          jobs={queue.jobs}
        />
      )}
      {page === 'styles' && <StylesLibrary onUseInStudio={useStyle} />}
      {page === 'gallery' && (
        <GalleryGrid
          records={gallery.records}
          onClear={gallery.clear}
          onDelete={gallery.remove}
          onDeleteMany={gallery.removeMany}
          onUseRecipe={(record) => void useRecipe(record)}
          onUseSeries={(card) => void deriveSeries(card)}
          onUseAsRef={(record) => void useAsReference(record)}
          onEditRecord={(record) => void useAsReference(record, true)}
        />
      )}

      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        jobs={queue.jobs}
        onCancelJob={queue.cancel}
        onRetryJob={queue.retry}
        onPrioritizeJob={queue.prioritize}
        onArchive={queue.archive}
        onLoadMore={queue.loadMore}
        hasMore={queue.hasMore}
        loadingHistory={queue.loadingHistory}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </AppShell>
  );
}
