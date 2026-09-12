import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { StitchIcon } from '../components/ui/StitchIcon';
import { adminButton, adminField } from '../components/admin/AdminUI';
import { adminStatus, adminLogin, adminLogout } from '../lib/api/styles';
import { StyleManager } from './StyleAdmin';
import { AccessCodeManager } from './AccessCodeAdmin';
import { AdminDashboard } from './AdminDashboard';

type AdminTab = 'overview' | 'styles' | 'access';
const tabs: { value: AdminTab; label: string; icon: string }[] = [
  { value: 'overview', label: '仪表盘', icon: 'grid_view' },
  { value: 'styles', label: '风格管理', icon: 'palette' },
  { value: 'access', label: '访问码管理', icon: 'lock' },
];
const currentTab = (): AdminTab => {
  const tab = location.hash.split('/')[1];
  return tab === 'styles' || tab === 'access' ? tab : 'overview';
};

export function AdminPage({ onBack }: { onBack: () => void }) {
  const { theme, toggle } = useTheme();
  const [session, setSession] = useState<{ configured: boolean; authenticated: boolean } | null>(null);
  const [tab, setTab] = useState<AdminTab>(currentTab);
  const [reviewCodeId, setReviewCodeId] = useState<string | null>(null);
  const [editStyleId, setEditStyleId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    try { setSession(await adminStatus()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '管理后台连接失败'); }
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => setSession((value) => value && { ...value, authenticated: false });
    const changed = () => setTab(currentTab());
    window.addEventListener('sprout:admin-expired', expired);
    window.addEventListener('popstate', changed);
    window.addEventListener('hashchange', changed);
    return () => { window.removeEventListener('sprout:admin-expired', expired); window.removeEventListener('popstate', changed); window.removeEventListener('hashchange', changed); };
  }, [refresh]);
  const navigate = useCallback((next: AdminTab) => {
    setTab(next);
    const hash = next === 'overview' ? '#admin' : `#admin/${next}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    window.scrollTo({ top: 0 });
  }, []);
  const reviewOpened = useCallback(() => setReviewCodeId(null), []);
  const styleOpened = useCallback(() => setEditStyleId(null), []);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setWorking(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { lock.current = false; setWorking(false); }
  }
  const authenticated = Boolean(session?.authenticated);
  return <div className="admin-shell min-h-[100dvh] bg-surface text-on-surface font-body-md text-body-md">
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur-xl border-b border-outline-variant/25 shadow-[0_1px_8px_rgba(85,95,75,0.04)]">
      <div className={`admin-header-inner ${authenticated ? 'admin-header-authenticated' : ''}`}>
        <div className="flex items-center gap-3 min-w-0 select-none">
          <img src="/assets/stitch/gallery-00.png" alt="芽绘台 SproutCanvas Logo" className="w-9 h-9 shrink-0 object-contain" />
          <div className="min-w-0"><p className="font-headline-sm text-headline-sm tracking-tight leading-none whitespace-nowrap">芽绘台<span className="hidden xl:inline"> SproutCanvas</span></p><p className="font-meta-sm text-meta-sm text-on-surface-variant mt-1 tracking-wider">管理空间</p></div>
        </div>
        {authenticated && <nav aria-label="后台导航" className="admin-navigation bg-surface-container-low p-1 rounded-xl">{tabs.map(({ value, label, icon }) => <button key={value} type="button" aria-pressed={tab === value} className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-body-md text-body-md whitespace-nowrap transition-colors ${tab === value ? 'bg-primary text-on-primary font-medium shadow-[0_2px_8px_rgba(65,91,47,0.2)]' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`} onClick={() => navigate(value)}><StitchIcon name={icon} size={17} /><span>{label}</span></button>)}</nav>}
        <div className="admin-header-actions flex items-center justify-end gap-2">
          <button type="button" aria-label="返回工作台" title="返回工作台" className={`${adminButton} px-2 sm:px-3 hover:bg-surface-container text-on-surface-variant`} onClick={onBack}><StitchIcon name="arrow_back" size={18} /><span className="hidden sm:inline">返回工作台</span></button>
          <button type="button" aria-label="切换主题" title="切换主题" className="w-9 h-9 rounded-lg bg-surface-container-low hover:bg-surface-container flex items-center justify-center text-on-surface-variant" onClick={toggle}><StitchIcon name={theme === 'dark' ? 'dark_mode' : 'light_mode'} size={18} /></button>
          {authenticated && <button type="button" aria-label="退出管理" title="退出管理" disabled={working} className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-50" onClick={() => void run(async () => { await adminLogout(); setSession((value) => value && { ...value, authenticated: false }); })}><StitchIcon name="logout" size={18} /></button>}
        </div>
      </div>
    </header>
    {!authenticated && <main className="admin-login-main">
      <section className="w-full max-w-[440px] rounded-3xl bg-surface-container-lowest border border-outline-variant/30 p-7 sm:p-10 shadow-[0_16px_64px_rgba(85,95,75,0.09)]">
        <img src="/assets/stitch/gallery-00.png" alt="" className="w-14 h-14 object-contain mb-7" />
        <p className="inline-flex items-center gap-1.5 font-meta-sm text-meta-sm tracking-wider text-secondary mb-3"><StitchIcon name="lock" size={15} />芽绘台 · 管理员入口</p>
        <h1 className="font-headline-lg text-headline-lg tracking-tight">进入管理后台</h1>
        <p className="mt-3 mb-7 font-body-md text-body-md text-on-surface-variant leading-relaxed">整理风格素材, 分配访问额度.<br />让每一份灵感有序生长.</p>
        {error && <p role="alert" className="mb-4 p-3 rounded-xl bg-error-container text-on-error-container text-body-sm">{error}</p>}
        {!session ? <div className="space-y-4"><p role="status" className="text-on-surface-variant">正在连接...</p>{error && <button type="button" className={`${adminButton} w-full bg-primary text-on-primary`} onClick={() => void refresh()}>重新连接</button>}</div> : !session.configured ? <p className="p-4 rounded-xl bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">管理员入口尚未启用. 请在服务端配置管理员密码后重新进入.</p> : <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (!password) return; void run(async () => { await adminLogin(password); setPassword(''); setShowPassword(false); await refresh(); }); }}>
          <label className="block font-body-sm text-body-sm font-medium" htmlFor="admin-password">管理员密码</label>
          <div className="relative !mt-2"><input id="admin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" autoFocus maxLength={256} required disabled={working} value={password} placeholder="输入管理员密码" onChange={(event) => { setPassword(event.target.value); setError(''); }} className={`${adminField} pr-16 !min-h-12`} /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} className="absolute right-1.5 top-1.5 px-3 h-9 rounded-lg text-primary font-body-sm text-body-sm hover:bg-surface-container" onClick={() => setShowPassword((value) => !value)}>{showPassword ? '隐藏' : '显示'}</button></div>
          <button type="submit" disabled={working || !password} className={`${adminButton} w-full !min-h-12 bg-primary hover:bg-primary-container text-on-primary shadow-[0_4px_16px_rgba(65,91,47,0.16)]`}>{working ? '登录中...' : '登录管理后台'}<StitchIcon name="arrow_forward" size={18} /></button>
        </form>}
        <p className="mt-7 pt-5 border-t border-outline-variant/25 font-meta-sm text-meta-sm text-outline">使用独立的管理员密码登录.</p>
      </section>
    </main>}
    {authenticated && error && <p role="alert" className="admin-page !py-3 text-error">{error}</p>}
    <div hidden={!authenticated || tab !== 'overview'}><AdminDashboard active={authenticated && tab === 'overview'} onNavigate={navigate} onReview={(id) => { setReviewCodeId(id); navigate('access'); }} onEditStyle={(id) => { setEditStyleId(id); navigate('styles'); }} /></div>
    <div hidden={!authenticated || tab !== 'styles'}><StyleManager active={authenticated && tab === 'styles'} editStyleId={editStyleId} onStyleOpened={styleOpened} /></div>
    <div hidden={!authenticated || tab !== 'access'}><AccessCodeManager active={authenticated && tab === 'access'} reviewCodeId={reviewCodeId} onReviewOpened={reviewOpened} /></div>
  </div>;
}
