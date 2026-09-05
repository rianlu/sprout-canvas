import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { GalleryGrid } from '../components/gallery/GalleryGrid';
import { QueueDrawer } from '../components/queue/QueueDrawer';
import { Button } from '../components/ui/Button';
import { CreativeStudio } from '../pages/CreativeStudio';
import { SeriesStudio } from '../pages/SeriesStudio';
import { StylesLibrary } from '../pages/StylesLibrary';
import { useAuth } from '../hooks/useAuth';
import { useGallery } from '../hooks/useGallery';
import { useQueue } from '../hooks/useQueue';
import { useTheme } from '../hooks/useTheme';
import { getServerConfig } from '../lib/api/config';
import type { QueueSubmitInput } from '../lib/api/queue';
import type { ResultRecord } from '../types/generation';

export type PageKey = 'studio' | 'series' | 'styles' | 'gallery';

function LoginScreen({ onLogin, loading }: { onLogin: (password: string) => Promise<void>; loading: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-head">
          <span className="eyebrow">芽绘台 SproutCanvas</span>
          <h1>进入工作台</h1>
          <p className="sub">自托管的图像生成工作台</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void onLogin(password).catch(() => setError('密码不正确或服务异常')); }}>
          <input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }}
            placeholder="访问密码" aria-label="访问密码" autoFocus />
          <p className="login-error" role={error ? 'alert' : undefined}>{error}</p>
          <Button variant="primary" className="btn-lg" disabled={loading || !password} type="submit">
            {loading ? '登录中...' : '登录'}
          </Button>
        </form>
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
  const { theme, toggle: toggleTheme } = useTheme();

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
    return <main className="login-screen"><div className="empty-state">正在加载...</div></main>;
  }
  if (auth.required && !auth.authenticated) {
    return <LoginScreen loading={auth.loading} onLogin={auth.signIn} />;
  }

  return (
    <AppShell page={page} onPageChange={setPage} ready={ready}
      queue={{ active: queue.globalActive, queued: queue.globalQueued }}
      onOpenQueue={() => setQueueOpen(true)}
      theme={theme} onToggleTheme={toggleTheme}>
      {page === 'studio' && (
        <CreativeStudio onSubmit={submit} onRetry={queue.retry} results={gallery.records} jobs={queue.jobs} />
      )}
      {page === 'series' && (
        <SeriesStudio onSubmit={submit} results={gallery.records} />
      )}
      {page === 'styles' && (
        <StylesLibrary onUseInStudio={() => setPage('studio')} />
      )}
      {page === 'gallery' && (
        <GalleryGrid records={gallery.records} onClear={gallery.clear} onDelete={gallery.remove} />
      )}

      <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} jobs={queue.jobs}
        onCancelJob={(jobId) => { void queue.cancel(jobId); }} onRetryJob={(jobId) => { void queue.retry(jobId); }} />
    </AppShell>
  );
}
