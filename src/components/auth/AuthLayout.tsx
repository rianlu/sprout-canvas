import { useState, type ReactNode } from 'react';
import type { Theme } from '../../hooks/useTheme';
import { StitchIcon } from '../ui/StitchIcon';

const content = {
  studio: {
    label: '创作空间',
    icon: 'spa',
    headline: '从一点灵感,',
    accent: '到一幅作品.',
    description: '写下想象, 探索画风, 让脑海中的画面自然生长.',
    features: [
      { icon: 'edit_note', title: '单图创作', text: '从文字或参考图片开始' },
      { icon: 'auto_awesome_motion', title: '系列策划', text: '把故事铺成连贯的分镜' },
      { icon: 'palette', title: '风格库', text: '寻找适合这次灵感的表达' },
      { icon: 'photo_library', title: '本地展馆', text: '回看作品, 延续新的创作' },
    ],
    title: '进入工作台',
    subtitle: '准备好了, 就从这里开始创作.',
    note: '还没有访问码? 请联系分享工作台给你的人.',
  },
  admin: {
    label: '管理空间',
    icon: 'grid_view',
    headline: '照料每一份灵感,',
    accent: '让创作有序生长.',
    description: '整理素材, 分配灵感点, 在一处照看工作台的日常.',
    features: [
      { icon: 'grid_view', title: '仪表盘', text: '查看创作活跃度与灵感点用量' },
      { icon: 'palette', title: '风格管理', text: '整理图片, 提示词与素材来源' },
      { icon: 'lock', title: '访问码管理', text: '分配创作额度, 核对使用记录' },
    ],
    title: '进入管理后台',
    subtitle: '使用管理员密码, 继续照看工作台.',
    note: '管理入口使用独立密码, 请妥善保管.',
  },
};

interface AuthLayoutProps {
  kind: keyof typeof content;
  theme: Theme;
  onToggleTheme: () => void;
  onBack?: () => void;
  children: ReactNode;
}

export function AuthLayout({ kind, theme, onToggleTheme, onBack, children }: AuthLayoutProps) {
  const copy = content[kind];
  return <div className="auth-shell min-h-[100dvh] bg-surface text-on-surface font-body-md text-body-md flex flex-col">
    <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(85,95,75,0.06)]">
      <div className="auth-header-inner flex items-center justify-between gap-3 px-4 sm:px-gutter-canvas">
        <div className="flex items-center gap-2 sm:gap-space-sm min-w-0 select-none">
          <img src="/assets/stitch/gallery-00.png" alt="芽绘台 SproutCanvas Logo" className="w-8 h-8 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="font-headline-sm text-headline-sm tracking-tight leading-none whitespace-nowrap">芽绘台<span className="hidden sm:inline"> SproutCanvas</span></p>
            <p className="font-meta-sm text-meta-sm text-on-surface-variant mt-1 tracking-wider">自然心流 · 灵感绘台</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onBack && <button type="button" aria-label="返回工作台" title="返回工作台" onClick={onBack} className="auth-back-button flex items-center gap-1.5 px-3 rounded-lg font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container transition-colors"><StitchIcon name="arrow_back" size={17} /><span className="hidden sm:inline">返回工作台</span></button>}
          <button type="button" aria-label="切换主题" aria-pressed={theme === 'dark'} title={theme === 'dark' ? '切换为浅色' : '切换为深色'} onClick={onToggleTheme} className="auth-theme-button flex items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-colors"><StitchIcon name={theme === 'dark' ? 'dark_mode' : 'light_mode'} size={18} /></button>
        </div>
      </div>
    </header>
    <main className="auth-main">
      <div className="auth-panel rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
        <aside className="auth-intro bg-surface-container-low" aria-label={copy.label}>
          <p className="inline-flex items-center gap-2 font-body-sm text-body-sm font-medium text-primary"><StitchIcon name={copy.icon} size={18} />{copy.label}</p>
          <p className="mt-6 font-headline-lg text-headline-lg tracking-tight">{copy.headline}<br /><span className="text-primary">{copy.accent}</span></p>
          <p className="mt-4 max-w-[28em] font-body-md text-body-md text-on-surface-variant leading-relaxed">{copy.description}</p>
          <ul className="auth-features">
            {copy.features.map((feature) => <li key={feature.title} className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-lowest text-primary"><StitchIcon name={feature.icon} size={20} /></span>
              <div><p className="font-body-md text-body-md font-medium">{feature.title}</p><p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{feature.text}</p></div>
            </li>)}
          </ul>
        </aside>
        <section className="auth-form-panel" aria-labelledby="auth-title">
          <div className="auth-heading">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/60 px-3 py-1 font-body-sm text-body-sm font-medium text-on-secondary-container"><StitchIcon name={kind === 'admin' ? 'lock' : 'spa'} size={14} />{kind === 'admin' ? '管理员入口' : '创作者入口'}</span>
            <h1 id="auth-title" className="mt-4 font-headline-md text-headline-md font-semibold">{copy.title}</h1>
            <p className="mt-2 font-body-md text-body-md text-on-surface-variant">{copy.subtitle}</p>
          </div>
          <div className="auth-form-content">{children}</div>
          <p className="auth-note border-t border-outline-variant/30 font-body-sm text-body-sm text-on-surface-variant">{copy.note}</p>
        </section>
      </div>
    </main>
  </div>;
}

interface AuthSecretFieldProps {
  id: string;
  label: string;
  visibilityLabel: string;
  value: string;
  placeholder: string;
  hint: string;
  error: string;
  disabled: boolean;
  maxLength: number;
  onChange: (value: string) => void;
}

export function AuthSecretField({ id, label, visibilityLabel, value, placeholder, hint, error, disabled, maxLength, onChange }: AuthSecretFieldProps) {
  const [visible, setVisible] = useState(false);
  return <div>
    <label htmlFor={id} className="block mb-2 font-body-md text-body-md font-medium">{label}</label>
    <div className="auth-secret-control flex items-center gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-low pl-4 pr-1" data-invalid={Boolean(error)} data-disabled={disabled}>
      <StitchIcon name="lock" size={18} className="text-outline" />
      <input id={id} name={id} type={visible ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus required maxLength={maxLength} disabled={disabled} value={value} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={`${id}-feedback`} onChange={(event) => onChange(event.target.value)} className="auth-secret-input min-w-0 flex-1 bg-transparent border-0 font-body-md text-body-md text-on-surface placeholder:text-outline" />
      <button type="button" aria-label={`${visible ? '隐藏' : '显示'}${visibilityLabel}`} aria-pressed={visible} disabled={disabled} onClick={() => setVisible((current) => !current)} className="auth-visibility-button shrink-0 rounded-lg px-3 font-body-sm text-body-sm font-medium text-primary hover:bg-surface-container transition-colors">{visible ? '隐藏' : '显示'}</button>
    </div>
    <p id={`${id}-feedback`} role={error ? 'alert' : undefined} className={`auth-field-feedback mt-2 font-body-sm text-body-sm ${error ? 'text-error' : 'text-on-surface-variant'}`}>{error || hint}</p>
  </div>;
}

export function AuthSubmit({ busy, disabled, children }: { busy: boolean; disabled: boolean; children: ReactNode }) {
  return <button type="submit" disabled={disabled} className="auth-primary-button flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-on-primary font-body-md text-body-md font-semibold transition-colors">
    {busy ? <><span className="auth-spinner" aria-hidden="true" />登录中...</> : <>{children}<StitchIcon name="arrow_forward" size={18} /></>}
  </button>;
}

export function AuthConnection({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="auth-connection">
    {error ? <><p role="alert" className="rounded-xl bg-error-container p-3 font-body-sm text-body-sm text-on-error-container">{error}</p><button type="button" onClick={onRetry} className="auth-primary-button mt-4 w-full rounded-xl bg-primary text-on-primary font-body-md text-body-md font-semibold transition-colors">重新连接</button></> : <p role="status" className="flex items-center gap-2 text-on-surface-variant"><span className="auth-spinner text-primary" aria-hidden="true" />正在连接...</p>}
  </div>;
}
