import { useCallback, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { GalleryGrid } from '../components/gallery/GalleryGrid';
import { CreativeStudio } from '../pages/CreativeStudio';
import { SeriesStudio } from '../pages/SeriesStudio';
import { SplitTool } from '../pages/SplitTool';
import { useAuth } from '../hooks/useAuth';
import { useGallery } from '../hooks/useGallery';
import { useQueue } from '../hooks/useQueue';
import { useTheme } from '../hooks/useTheme';
import { Button } from '../components/ui/Button';

export type PageKey = 'studio' | 'series' | 'split' | 'gallery';

function LoginScreen({ onLogin, loading }: { onLogin: (password: string) => Promise<void>; loading: boolean }) {
  const [password, setPassword] = useState('');
  return (
    <main className="login-screen">
      <section className="login-card">
        <span className="eyebrow">芽绘台</span>
        <h1>进入芽绘台</h1>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="访问密码" />
        <Button variant="primary" disabled={loading} onClick={() => { void onLogin(password); }}>登录</Button>
      </section>
    </main>
  );
}

export function App() {
  const [page, setPage] = useState<PageKey>('studio');
  const auth = useAuth();
  const gallery = useGallery();
  const handleResult = useCallback(gallery.add, [gallery.add]);
  const queue = useQueue(handleResult);
  const { theme, toggle: toggleTheme } = useTheme();

  if (auth.loading) return <main className="login-screen"><div className="empty-state">正在加载...</div></main>;
  if (auth.required && !auth.authenticated) return <LoginScreen loading={auth.loading} onLogin={auth.signIn} />;

  return (
    <AppShell page={page} onPageChange={setPage} jobs={queue.jobs} active={queue.globalActive} queued={queue.globalQueued} onCancelJob={(jobId) => { void queue.cancel(jobId); }} onRetryJob={(jobId) => { void queue.retry(jobId); }} theme={theme} onToggleTheme={toggleTheme}>
      {page === 'studio' && <CreativeStudio onSubmit={queue.submit} onRetry={queue.retry} results={gallery.records} jobs={queue.jobs} />}
      {page === 'series' && <SeriesStudio onSubmit={queue.submit} results={gallery.records} />}
      {page === 'split' && <SplitTool galleryRecords={gallery.records} />}
      {page === 'gallery' && <GalleryGrid records={gallery.records} onClear={gallery.clear} onDelete={gallery.remove} />}
    </AppShell>
  );
}
