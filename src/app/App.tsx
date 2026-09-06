import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/shell/AppShell';
import { GalleryGrid } from '../pages/StitchGalleryGrid';
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
import type { ResultRecord } from '../types/generation';

export type PageKey = 'studio' | 'series' | 'styles' | 'gallery';

function LoginScreen({ onLogin, loading }: { onLogin: (password: string) => Promise<void>; loading: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="min-h-screen bg-surface flex items-center justify-center px-gutter-canvas">
      <section className="w-full max-w-sm bg-surface-container-lowest/90 backdrop-blur-xl rounded-2xl p-space-xl shadow-[0_12px_36px_rgba(85,95,75,0.10)] border border-outline-variant/30 flex flex-col gap-space-lg">
        <div className="flex flex-col items-center gap-space-sm text-center">
          <img
            alt="芽绘台 SproutCanvas Logo"
            className="h-14 w-auto object-contain"
            src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22%239DBEA6%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23597445%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2216%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2244%22%20text-anchor%3D%22middle%22%20font-family%3D%22Inter%2Csans-serif%22%20font-weight%3D%22900%22%20font-size%3D%2232%22%20fill%3D%22%23FFFFFF%22%3E%E8%8A%BD%3C%2Ftext%3E%3C%2Fsvg%3E"
          />
          <div className="flex flex-col gap-1">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">进入工作台</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">芽绘台 SproutCanvas · 自然心流创作</p>
          </div>
        </div>
        <form
          className="flex flex-col gap-space-sm"
          onSubmit={(event) => { event.preventDefault(); void onLogin(password).catch(() => setError('密码不正确或服务异常')); }}
        >
          <div className="relative bg-surface-container-low rounded-xl px-space-md py-2 flex items-center gap-2 border border-outline-variant/30 focus-within:border-primary transition-colors">
            <input
              type="password"
              className="w-full bg-transparent border-0 outline-none font-body-md text-body-md text-on-surface placeholder:text-outline"
              placeholder="访问密码"
              aria-label="访问密码"
              autoFocus
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError(''); }}
            />
          </div>
          {error && <p className="font-body-sm text-body-sm text-error text-center" role="alert">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-headline-sm text-headline-sm shadow-[0_4px_16px_rgba(65,91,47,0.28)] hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:hover:translate-y-0"
            disabled={loading || !password}
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
  const [page, setPage] = useState<PageKey>('studio');
  const [queueOpen, setQueueOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const auth = useAuth();
  const gallery = useGallery();

  const handleResult = useCallback(gallery.add, [gallery.add]);
  const queue = useQueue(handleResult);

  // 后端就绪状态 (顶栏状态点)
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        await getServerConfig();
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    }
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const submit = useCallback(async (input: QueueSubmitInput) => {
    const job = await queue.submit(input);
    setQueueOpen(true);
    return job;
  }, [queue.submit]);

  if (auth.loading) {
    return <main className="min-h-screen bg-surface flex items-center justify-center"><p className="font-body-sm text-body-sm text-on-surface-variant">正在加载...</p></main>;
  }
  if (auth.required && !auth.authenticated) {
    return <LoginScreen loading={auth.loading} onLogin={auth.signIn} />;
  }

  return (
    <AppShell page={page} onPageChange={setPage} ready={ready}
      queueCount={queue.globalActive + queue.globalQueued}
      onOpenQueue={() => setQueueOpen(true)}>
      {page === 'studio' && (
        <CreativeStudio onSubmit={submit} onRetry={queue.retry} results={gallery.records} jobs={queue.jobs} />
      )}
      {page === 'series' && (
        <SeriesStudio onSubmit={submit} results={gallery.records} jobs={queue.jobs} />
      )}
      {page === 'styles' && (
        <StylesLibrary onUseInStudio={(styleId) => {
          writeDraft('studio_style', styleId);
          setPage('studio');
        }} />
      )}
      {page === 'gallery' && (
        <GalleryGrid records={gallery.records} onClear={gallery.clear} onDelete={gallery.remove} onUseAsRef={(record) => {
          writeDraft('studio_ref_image', JSON.stringify({ id: record.id, name: `作品-${record.id.slice(-3)}`, dataUrl: record.dataUrl, size: 0 }));
          writeDraft('studio_style', '');
          setPage('studio');
        }} />
      )}

      <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} jobs={queue.jobs}
        onCancelJob={(jobId) => { void queue.cancel(jobId); }} onRetryJob={(jobId) => { void queue.retry(jobId); }} />
    </AppShell>
  );
}
