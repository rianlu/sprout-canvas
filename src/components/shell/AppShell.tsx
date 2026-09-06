import { useTheme } from '../../hooks/useTheme';
import { Layers, type LucideIcon, Lightbulb, Palette, Images, CircleUserRound, LoaderCircle } from 'lucide-react';
import type { PageKey } from '../../app/App';

export interface AppShellProps {
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  ready: boolean;
  queueCount: number;
  onOpenQueue: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: { key: PageKey; label: string; icon: LucideIcon }[] = [
  { key: 'studio', label: '单图创作', icon: Lightbulb },
  { key: 'series', label: '系列策划', icon: Layers },
  { key: 'styles', label: '风格库', icon: Palette },
  { key: 'gallery', label: '展馆', icon: Images },
];

/**
 * 全局壳: 顶栏 + footer. DOM 照搬 Stitch 单图稿 <header> 与 <footer> (类名原样).
 * 图标 Material Symbols → lucide (方案 α, DESIGN.md §9.1).
 * 头像按钮按 PRD §7.1 剔除 (无用户体系).
 */
export function AppShell({ page, onPageChange, ready, queueCount, onOpenQueue, children }: AppShellProps) {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="fixed top-0 left-0 right-0 w-full z-40 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(85,95,75,0.06)]">
        <div className="h-16 w-full px-gutter-canvas flex items-center justify-between gap-space-md">
          {/* 品牌 (logo 用 favicon 同款 SVG 内联, 替代外链图) */}
          <div className="flex items-center gap-space-sm select-none">
            <img
              alt="芽绘台 SproutCanvas Logo"
              className="h-8 w-auto object-contain"
              src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22%239DBEA6%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23597445%22%2F%3E%3C%2FlinearGradient%3E%3C/defs%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2216%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2244%22%20text-anchor%3D%22middle%22%20font-family%3D%22Inter%2Csans-serif%22%20font-weight%3D%22900%22%20font-size%3D%2232%22%20fill%3D%22%23FFFFFF%22%3E%E8%8A%BD%3C/text%3E%3C/svg%3E"
            />
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight leading-none">芽绘台 SproutCanvas</span>
              <span className="font-meta-sm text-meta-sm text-on-surface-variant tracking-wider mt-0.5">自然心流·灵感绘台</span>
            </div>
          </div>

          {/* 分段导航 */}
          <nav className="hidden md:flex items-center gap-space-xs p-1 bg-surface-container-low rounded-xl" aria-label="主导航">
            {NAV_ITEMS.map((item) => {
              const active = page === item.key;
              const Icon = item.icon;
              return (
                <a
                  key={item.key}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'transition-all px-space-md py-1.5 bg-primary text-on-primary font-medium rounded-lg shadow-[0_2px_8px_rgba(65,91,47,0.2)]'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all px-space-md py-1.5 rounded-lg font-body-md text-body-md'
                  }
                  data-path={item.key}
                  href="#"
                  onClick={(event) => { event.preventDefault(); onPageChange(item.key); }}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* 右侧动作区 */}
          <div className="flex items-center gap-space-sm">
            {/* 服务状态 (替代稿内假数据「全通道就绪」; ready 时呼吸绿点) */}
            <div className="hidden lg:flex items-center gap-1.5 px-space-sm py-1 rounded-full bg-surface-container-low">
              <span className={`w-2 h-2 rounded-full ${ready ? 'bg-primary animate-pulse' : 'bg-outline-variant/60'}`} />
              <span className="font-meta-sm text-meta-sm text-on-surface-variant">{ready ? '全通道就绪' : '连接服务中'}</span>
            </div>
            <button
              type="button"
              className="flex items-center gap-1.5 px-space-sm py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface"
              onClick={onOpenQueue}
            >
              <LoaderCircle className="text-primary" size={18} aria-hidden />
              <span className="font-body-sm text-body-sm font-medium">任务队列</span>
              {queueCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-meta-sm text-meta-sm">{queueCount}</span>
              )}
            </button>
            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              title="切换主题"
              aria-label="切换主题"
              onClick={toggle}
            >
              {theme === 'dark' ? <Lightbulb size={18} aria-hidden /> : <CircleUserRound size={18} aria-hidden />}
            </button>
          </div>
        </div>
      </header>

      {children}

      {/* footer 照搬 (稿内三条外链按 PRD §7.1 剔除, 留版本号) */}
      <footer className="w-full bg-surface-container-low py-space-xl mt-auto">
        <div className="w-full px-gutter-canvas flex flex-col sm:flex-row items-center justify-between gap-space-md text-on-surface-variant font-body-sm text-body-sm">
          <div className="flex items-center gap-space-xs">
            <span className="font-meta-md text-meta-md text-on-surface">芽绘台 SproutCanvas</span>
            <span>· 自然生机 AI 创作工作室</span>
          </div>
          <div className="flex items-center gap-space-lg">
            <span className="font-meta-sm text-meta-sm text-outline">v3.5.0-stitch</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
