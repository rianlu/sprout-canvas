import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/shell/AppShell';
import { GalleryGrid } from '../pages/StitchGalleryGrid';
import { HelpDialog } from '../components/shell/HelpDialog';
import { QueueDrawer } from '../components/shell/QueueDrawer';
import { CreativeStudio } from '../pages/StitchCreativeStudio';
import { SeriesStudio } from '../pages/StitchSeriesStudio';
import { StylesLibrary } from '../pages/StitchStylesLibrary';
import { useAuth } from '../hooks/useAuth';
import { useGallery } from '../hooks/useGallery';
import { useQueue } from '../hooks/useQueue';
import { getServerConfig } from '../lib/api/config';
import { writeDraft } from '../lib/storage/drafts';
import type { QueueSubmitInput } from '../lib/api/queue';
import type { GenerationConfig, ResultRecord } from '../types/generation';
import type { ServerConfig } from '../types/provider';
import { getRecordDataUrl, writeWorkspaceDraft } from '../lib/storage/gallery-db';
import { recipeDraft, sourceImageDraft, type StudioDraft } from '../lib/image/recipe';
import { findImageStyle } from '../lib/styles/image-styles';
import { sizePreset, resolveSize } from '../lib/api/generation';
import { randomId } from '../lib/random/id';
import type { SeriesCard } from '../lib/image/gallery';

export type PageKey = 'studio' | 'series' | 'styles' | 'gallery';

function LoginScreen({ onLogin, loading, passwordRequired = true }: { onLogin: (password: string) => Promise<void>; loading: boolean; passwordRequired?: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="min-h-screen bg-surface flex items-center justify-center px-gutter-canvas">
      <section className="w-full max-w-sm bg-surface-container-lowest/90 backdrop-blur-xl rounded-2xl p-space-xl shadow-[0_12px_36px_rgba(85,95,75,0.10)] border border-outline-variant/30 flex flex-col gap-space-lg">
        <div className="flex flex-col items-center gap-space-sm text-center">
          <img
            alt="芽绘台 SproutCanvas Logo"
            className="h-14 w-auto object-contain"
            src="/assets/stitch/gallery-00.png"
          />
          <div className="flex flex-col gap-1">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">进入工作台</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">芽绘台 SproutCanvas · 自然心流创作</p>
          </div>
        </div>
        <form
          className="flex flex-col gap-space-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void onLogin(password).catch(() => setError('密码不正确或服务异常'));
          }}
        >
          {passwordRequired && <div className="relative bg-surface-container-low rounded-xl px-space-md py-2 flex items-center gap-2 border border-outline-variant/30 focus-within:border-primary transition-colors">
            <input
              type="password"
              className="w-full bg-transparent border-0 outline-none font-body-md text-body-md text-on-surface placeholder:text-outline"
              placeholder="访问密码"
              aria-label="访问密码"
              autoFocus
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError('');
              }}
            />
          </div>}
          {error && (
            <p className="font-body-sm text-body-sm text-error text-center" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-headline-sm text-headline-sm shadow-[0_4px_16px_rgba(65,91,47,0.28)] hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:hover:translate-y-0"
            disabled={loading || (passwordRequired && !password)}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        <p className="font-meta-sm text-meta-sm text-outline text-center">自托管的图像生成工作台 · 密码由服务端配置</p>
      </section>
    </main>
  );
}

export function App() {
  const [page, setCurrentPage] = useState<PageKey>(() => ['studio', 'series', 'styles', 'gallery'].includes(location.hash.slice(1)) ? location.hash.slice(1) as PageKey : 'studio');
  const setPage = useCallback((next: PageKey) => { setCurrentPage(next); if (location.hash !== `#${next}`) history.pushState(null, '', `#${next}`); }, []);
  useEffect(() => { const changed = () => { const value = location.hash.slice(1); if (['studio', 'series', 'styles', 'gallery'].includes(value)) setCurrentPage(value as PageKey); }; window.addEventListener('popstate', changed); return () => window.removeEventListener('popstate', changed); }, []);
  const [studioRevision, setStudioRevision] = useState(0);
  const [styleTarget, setStyleTarget] = useState<'studio' | 'series'>('studio');
  const [queueOpen, setQueueOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState('');
  const auth = useAuth();
  const gallery = useGallery();

  const handleResult = useCallback(gallery.add, [gallery.add]);
  const queue = useQueue(handleResult, auth.authenticated);
  useEffect(() => { const failed = (event: Event) => setMessage((event as CustomEvent<string>).detail); window.addEventListener('sprout:storage-error', failed); return () => window.removeEventListener('sprout:storage-error', failed); }, []);

  // 后端就绪状态 (顶栏状态点)
  useEffect(() => {
    if (!auth.authenticated) return;
    let cancelled = false;
    async function check() {
      try {
        const config = await getServerConfig();
        if (!cancelled) { setReady(true); setServerConfig(config); }
      } catch {
        if (!cancelled) setReady(false);
      }
    }
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auth.authenticated]);

  const submit = useCallback(
    async (input: QueueSubmitInput) => {
      const job = await queue.submit(input);
      setQueueOpen(true);
      return job;
    },
    [queue.submit],
  );

  const submitBatch = useCallback(async (inputs: QueueSubmitInput[]) => {
    setQueueOpen(true);
    return queue.submitBatch(inputs);
  }, [queue.submitBatch]);
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

  const useStyle = useCallback(async (styleId: string) => {
    const style = findImageStyle(styleId);
    if (!style) throw new Error('该风格已不存在, 请重新选择');
    if (styleTarget === 'series') {
      if (!writeDraft('batch_style', style.id)) throw new Error('画风未能保存, 请检查浏览器可用空间');
      setPage('series');
      return;
    }
    const draft: StudioDraft = {
      config: { mode: 'text', prompt: style.template, imageCount: 1, refImages: [] },
      styleId: style.id, refImage: null, sourceRecord: null, mask: null, maskDataUrl: '', tone: 'none',
    };
    await writeWorkspaceDraft('studio-transfer', draft);
    setStudioRevision((value) => value + 1);
    setPage('studio');
  }, [setPage, styleTarget]);

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
        batch_style: recipe?.styleId || '', batch_quality: config.quality, batch_output_format: config.outputFormat,
        batch_aspect_ratio: config.aspectRatio, batch_series_id: seriesId, batch_scene_ids: JSON.stringify(sceneIds), batch_shot_ids: '',
      };
      for (const [key, value] of Object.entries(drafts)) if (!writeDraft(key, value)) throw new Error('系列草稿未能保存, 请检查浏览器可用空间');
      setPage('series');
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法复用此系列'); }
  }, [setPage]);

  if (auth.loading) {
    return (
      <main className="min-h-screen bg-surface flex items-center justify-center">
        <p className="font-body-sm text-body-sm text-on-surface-variant">正在加载...</p>
      </main>
    );
  }
  if (auth.error) return <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface"><p role="alert">{auth.error}</p><button type="button" onClick={() => void auth.refresh()} className="px-4 py-2 rounded-xl bg-primary text-on-primary">重新连接</button></main>;
  if (!auth.authenticated) return <LoginScreen loading={auth.loading} onLogin={auth.signIn} passwordRequired={auth.required} />;

  return (
    <AppShell
      page={page}
      onPageChange={(nextPage) => {
        if (nextPage === 'styles') setStyleTarget('studio');
        setPage(nextPage);
      }}
      ready={ready}
      statusText={!ready ? '连接服务中' : serverConfig?.imageChannels?.some((channel) => channel.status === 'available') ? '生图通道可用' : serverConfig?.imageChannels?.some((channel) => channel.status === 'degraded' || channel.status === 'cooldown') ? '通道需检查' : '已连接 · 通道待验证'}
      onOpenHelp={() => setHelpOpen(true)}
      onSignOut={() => void auth.signOut().catch(() => setMessage('退出失败, 请重试'))}
      queueCount={queue.jobs.filter((job) => ['running', 'pending', 'unsubmitted'].includes(job.status)).length}
      onOpenQueue={() => setQueueOpen(true)}
    >
      {(message || gallery.error || queue.error) && <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] max-w-[90vw] rounded-xl bg-error-container text-on-error-container p-3 shadow-lg text-body-sm flex gap-3"><span>{message || gallery.error || queue.error}</span><button type="button" onClick={() => { setMessage(''); void gallery.refresh(); void queue.refresh(); }}>重试</button></div>}
      {page === 'studio' && (
        <CreativeStudio
          key={studioRevision}
          imageCapabilities={serverConfig?.imageCapabilities}
          onOpenStyles={() => {
            setStyleTarget('studio');
            setPage('styles');
          }}
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
          onOpenStyles={() => {
            setStyleTarget('series');
            setPage('styles');
          }}
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
      {page === 'styles' && (
        <StylesLibrary
          target={styleTarget}
          onUseInStudio={useStyle}
        />
      )}
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
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} config={serverConfig} />
    </AppShell>
  );
}
