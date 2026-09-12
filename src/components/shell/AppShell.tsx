import { useTheme } from '../../hooks/useTheme';
import { StitchIcon } from '../ui/StitchIcon';
import type { PageKey } from '../../app/App';
import { compactPoints, useCredits } from '../../lib/credits';
import { UserPopover } from './UserPopover';

export interface AppShellProps {
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  onOpenHelp: () => void;
  onSignOut: () => void;
  queueCount: number;
  onOpenQueue: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: { key: PageKey; label: string }[] = [
  { key: 'studio', label: '单图创作' },
  { key: 'series', label: '系列策划' },
  { key: 'styles', label: '风格库' },
  { key: 'gallery', label: '展馆' },
];

export function AppShell({ page, onPageChange, onOpenHelp, onSignOut, queueCount, onOpenQueue, children }: AppShellProps) {
  const { theme, toggle } = useTheme();
  const { credits, canGenerate, accessName } = useCredits();
  const navigation = (mobile = false) => (
    <nav
      className={
        mobile
          ? 'stitch-mobile-nav'
          : 'stitch-desktop-nav hidden md:flex items-center gap-space-xs p-1 bg-surface-container-low rounded-xl'
      }
      aria-label={mobile ? '移动导航' : '主导航'}
    >
      {NAV_ITEMS.map((item) => (
        <a
          key={item.key}
          href={`#${item.key}`}
          data-path={item.key}
          aria-current={page === item.key ? 'page' : undefined}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-all px-space-md py-1.5 rounded-lg ${page === item.key ? 'bg-primary text-on-primary font-medium shadow-[0_2px_8px_rgba(65,91,47,0.2)]' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-body-md text-body-md'}`}
          onClick={(event) => {
            event.preventDefault();
            onPageChange(item.key);
            window.scrollTo({ top: 0 });
          }}
        >
          {item.key === 'gallery' && page === 'gallery' && <StitchIcon name="photo_library" size={16} />}
          {item.label}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-surface font-body-md text-body-md text-on-surface flex flex-col">
      <header className="fixed top-0 left-0 right-0 w-full z-40 bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(85,95,75,0.06)]">
        <div className="h-16 w-full px-4 sm:px-gutter-canvas flex items-center justify-between gap-2 sm:gap-space-md">
          <div className="flex items-center gap-2 sm:gap-space-sm select-none shrink-0">
            <img
              alt="芽绘台 SproutCanvas Logo"
              className="h-8 w-8 shrink-0 object-contain"
              src="/assets/stitch/gallery-00.png"
            />
            <div className="flex flex-col min-w-0">
              <span className="stitch-header-brand font-headline-sm text-headline-sm text-on-surface tracking-tight leading-none truncate">
                芽绘台<span className="hidden xl:inline"> SproutCanvas</span>
              </span>
              <span className="stitch-header-tagline hidden xl:block whitespace-nowrap font-meta-sm text-meta-sm text-on-surface-variant tracking-wider mt-0.5">
                自然心流·灵感绘台
              </span>
            </div>
          </div>
          {navigation()}
          <div className="flex items-center gap-2 sm:gap-space-sm shrink-0">
            {credits && (
              <div aria-label={credits.unlimited ? `无限灵感点, 原额度占用 ${credits.reserved} 点` : `可用 ${credits.available} 灵感点, 占用 ${credits.reserved} 点`} title={`${credits.unlimited ? '无限额度, 新任务不扣减余额' : `可用 ${credits.available.toLocaleString()} 点`}, 占用 ${credits.reserved.toLocaleString()} 点. ${canGenerate ? '已受理任务按提交时的额度模式结算.' : '访问码已失效, 可继续领取已有结果. 请退出后用可用访问码登录再创作.'}`} className="px-2.5 py-1.5 rounded-xl bg-secondary-container text-on-secondary-container flex flex-col items-center font-meta-sm text-meta-sm whitespace-nowrap">
                <span className="flex items-center gap-1 font-semibold tabular-nums"><StitchIcon name="spa" size={15} />{credits.unlimited ? '无限' : compactPoints(credits.available)}<span className="hidden lg:inline">灵感点</span></span>
                {!canGenerate ? <span className="text-[10px] text-error">访问码已失效</span> : credits.reserved > 0 && <span className="text-[10px] opacity-80">{credits.unlimited && <span className="hidden sm:inline">原额度</span>}占用 {compactPoints(credits.reserved)}</span>}
              </div>
            )}
            <button
              type="button"
              className="flex items-center gap-1.5 px-space-sm py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface"
              onClick={onOpenQueue}
              aria-label={`任务队列, ${queueCount} 个待处理任务`}
            >
              <StitchIcon name="auto_awesome_motion" size={18} className="text-primary" />
              <span className="hidden lg:inline font-body-sm text-body-sm font-medium">任务队列</span>
              <span className="px-1.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-meta-sm text-meta-sm">
                {queueCount}
              </span>
            </button>
            <UserPopover key={page} accessName={accessName} tail={credits?.tail} theme={theme} onToggleTheme={toggle} onOpenHelp={onOpenHelp} onSignOut={onSignOut} />
          </div>
        </div>
        {navigation(true)}
      </header>
      {children}
      <footer className="w-full bg-surface-container-low py-space-xl mt-auto">
        <div
          className={`w-full flex flex-col sm:flex-row items-center justify-between gap-space-md text-on-surface-variant font-body-sm text-body-sm ${page === 'gallery' ? 'max-w-[1560px] mx-auto px-4 sm:px-6 lg:px-8' : 'px-gutter-canvas'}`}
        >
          <div className="flex items-center gap-space-xs">
            <span className="font-meta-md text-meta-md text-on-surface">芽绘台 SproutCanvas</span>
            <span>· 自然生机 AI 创作工作室</span>
          </div>
          <div className="flex items-center gap-space-lg">
            <button type="button" onClick={onOpenHelp} className="font-body-sm text-body-sm hover:text-primary">使用帮助与创作守则</button>
            <span className="font-meta-sm text-meta-sm text-outline">v3.5.0-stitch</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
