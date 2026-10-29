import { useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { StitchIcon } from '../ui/StitchIcon';
import { AuthSecretField, AuthSubmit } from './AuthLayout';

// A code stands alone, not inside a longer token; no lookbehind, which older Safari cannot parse.
const CODE_IN_TEXT = /(?:^|[^A-Za-z0-9_-])sc_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g;

/** Admins copy codes as "名称: sc_…" lines, so a paste that holds exactly one code signs in with that code. */
export function accessCodeFromText(text: string) {
  const found = [...new Set((text.match(CODE_IN_TEXT) || []).map((match) => match.slice(match.indexOf('sc_'))))];
  if (found.length > 1) throw new Error('粘贴的内容包含多个访问码, 请只保留一个');
  return found[0] || text.trim();
}

interface LoginDialogProps {
  /** The session ended on its own, so the dialog says why it is asking again. */
  expired: boolean;
  onClose: () => void;
  onSignIn: (code: string) => Promise<void>;
}

/** Access code sign-in, opened from the header or by an action that spends points. It never submits that action itself; mount it only while open. */
export function LoginDialog({ expired, onClose, onSignIn }: LoginDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  return <Dialog label="使用访问码登录" busy={working} initialFocus={input} onClose={onClose} className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 sm:p-8 shadow-2xl">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-headline-md text-headline-md font-semibold">{expired ? '登录已过期' : '登录后开始创作'}</h2>
        <p className="mt-2 font-body-md text-body-md text-on-surface-variant">{expired ? '请重新输入访问码, 已填写的内容不会丢失.' : '输入访问码即可生成和润色, 已填写的内容会保留.'}</p>
      </div>
      <button type="button" aria-label="关闭登录" disabled={working} onClick={onClose} className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container disabled:opacity-50"><StitchIcon name="close" size={20} /></button>
    </div>
    <form className="mt-6" aria-busy={working} onSubmit={(event) => {
      event.preventDefault();
      if (lock.current || !code.trim()) return;
      let value: string;
      try { value = accessCodeFromText(code); } catch (cause) { setError(cause instanceof Error ? cause.message : '请检查访问码'); return; }
      lock.current = true; setWorking(true); setError('');
      void onSignIn(value).catch((cause) => setError(cause instanceof Error ? cause.message : '登录失败, 请重试')).finally(() => { lock.current = false; setWorking(false); });
    }}>
      <AuthSecretField id="access-code" account="芽绘台访问码" inputRef={input} label="访问码" visibilityLabel="访问码" value={code} placeholder="输入或粘贴访问码" hint="可直接粘贴收到的整段文字, 会自动识别访问码." error={error} disabled={working} maxLength={2048} onChange={(value) => { setCode(value); setError(''); }} />
      <AuthSubmit busy={working} disabled={working || !code.trim()}>登录</AuthSubmit>
    </form>
    <p className="mt-6 pt-5 border-t border-outline-variant/30 font-body-sm text-body-sm text-on-surface-variant">还没有访问码? 请联系分享工作台给你的人.</p>
  </Dialog>;
}
