import type { PropsWithChildren } from 'react';
import { Images, LayoutDashboard, Loader2, Moon, Palette, Sparkles, Sun } from 'lucide-react';
import type { PageKey } from '../../app/App';
import type { Theme } from '../../hooks/useTheme';
import type { QueueJob } from '../../types/queue';

export type QueueSummary = { active: number; queued: number };

interface AppShellProps {
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  ready: boolean;
  queue: QueueSummary;
  onOpenQueue: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  children: PropsWithChildren['children'];
}

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: typeof Sparkles }> = [
  { key: 'studio', label: '单图创作', icon: Sparkles },
  { key: 'series', label: '系列策划', icon: LayoutDashboard },
  { key: 'styles', label: '风格库', icon: Palette },
  { key: 'gallery', label: '展馆', icon: Images },
];

export function AppShell({ page, onPageChange, ready, queue, onOpenQueue, theme, onToggleTheme, children }: AppShellProps) {
  const queueCount = queue.active + queue.queued;
  const nextThemeLabel = theme === 'dark' ? '切换浅色主题' : '切换深色主题';
  const statusLabel = ready ? '服务就绪' : '连接异常';

  return (
    <div className="app-frame">
      <header className="top-bar">
        <div className="top-bar-brand" onClick={() => onPageChange('studio')} role="button" tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onPageChange('studio'); }}>
          <span className="brand-mark" aria-hidden="true">芽</span>
          <span className="brand-copy">
            <strong>芽绘台 SproutCanvas</strong>
            <span>图像生成工作台</span>
          </span>
        </div>

        <nav className="nav-segmented" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" className={page === item.key ? 'active' : ''}
                aria-current={page === item.key ? 'page' : undefined} onClick={() => onPageChange(item.key)}>
                <Icon className="nav-icon" size={15} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="top-bar-actions">
          <span className={`status-dot ${ready ? '' : 'error'}`} title={ready ? '后端服务就绪' : '后端服务异常'}>{statusLabel}</span>
          <button type="button" className={`queue-entry ${queueCount ? '' : 'idle'}`} onClick={onOpenQueue}
            aria-label={`打开任务队列${queueCount ? `, ${queueCount} 个任务` : ''}`}>
            <Loader2 size={16} className={queue.active ? 'spin' : ''} aria-hidden="true" />
            <span className="queue-entry-label">任务队列</span>
            <span className="count">{queueCount}</span>
          </button>
          <button type="button" className="icon-btn" onClick={onToggleTheme} title={nextThemeLabel} aria-label={nextThemeLabel}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main className="workspace">{children}</main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>芽绘台 SproutCanvas · 图像生成工作台</span>
          <span className="version">UI v3 · Botanical Paper</span>
        </div>
      </footer>
    </div>
  );
}

export type { QueueJob };
