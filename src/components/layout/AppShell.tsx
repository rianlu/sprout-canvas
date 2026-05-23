import type { PropsWithChildren } from 'react';
import { Images, LayoutDashboard, Moon, Scissors, Sparkles, Sun } from 'lucide-react';
import type { PageKey } from '../../app/App';
import { QueueDock } from '../queue/QueueDock';
import type { QueueJob } from '../../types/queue';
import type { Theme } from '../../hooks/useTheme';

interface AppShellProps {
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  jobs: QueueJob[];
  active: number;
  queued: number;
  onCancelJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

const nav = [
  { key: 'studio' as const, label: '创作台', icon: Sparkles },
  { key: 'series' as const, label: '系列生成', icon: LayoutDashboard },
  { key: 'split' as const, label: '切图', icon: Scissors },
  { key: 'gallery' as const, label: '展馆', icon: Images },
];

export function AppShell({ page, onPageChange, jobs, active, queued, onCancelJob, onRetryJob, theme, onToggleTheme, children }: PropsWithChildren<AppShellProps>) {
  const nextThemeLabel = theme === 'dark' ? '切换浅色' : '切换深色';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block" title="芽绘台">
          <div className="brand-mark">芽</div>
          <div className="brand-copy">
            <strong>芽绘台</strong>
            <span>AI 生图工作台</span>
          </div>
        </div>
        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={`nav-item ${page === item.key ? 'active' : ''}`} data-label={item.label} title={item.label} aria-label={item.label} aria-current={page === item.key ? 'page' : undefined} onClick={() => onPageChange(item.key)}>
                <Icon size={20} />
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={onToggleTheme} title={nextThemeLabel} aria-label={nextThemeLabel}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </aside>
      <main className="workspace">{children}</main>
      <QueueDock jobs={jobs} active={active} queued={queued} onCancelJob={onCancelJob} onRetryJob={onRetryJob} />
    </div>
  );
}
