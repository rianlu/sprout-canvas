import { useRef, useState } from 'react';
import { AuthConnection, AuthLayout, AuthSecretField, AuthSubmit } from '../components/auth/AuthLayout';
import { useTheme } from '../hooks/useTheme';

interface WorkspaceLoginProps {
  onLogin: (code: string) => Promise<void>;
  onRetry: () => void;
  loading: boolean;
  connectionError: string;
}

export function WorkspaceLogin({ onLogin, onRetry, loading, connectionError }: WorkspaceLoginProps) {
  const { theme, toggle } = useTheme();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const loginLock = useRef(false);

  return <AuthLayout kind="studio" theme={theme} onToggleTheme={toggle}>
    {loading || connectionError ? <AuthConnection error={connectionError} onRetry={onRetry} /> : <form aria-busy={working} onSubmit={(event) => {
      event.preventDefault();
      if (loginLock.current || !code.trim()) return;
      loginLock.current = true;
      setWorking(true);
      setError('');
      void onLogin(code).catch((cause) => setError(cause instanceof Error ? cause.message : '登录失败, 请重试')).finally(() => {
        loginLock.current = false;
        setWorking(false);
      });
    }}>
      <AuthSecretField id="access-code" label="访问码" visibilityLabel="访问码" value={code} placeholder="输入或粘贴访问码" hint="使用管理员提供的访问码, 无需注册." error={error} disabled={working} maxLength={128} onChange={(value) => { setCode(value); setError(''); }} />
      <AuthSubmit busy={working} disabled={working || !code.trim()}>进入工作台</AuthSubmit>
    </form>}
  </AuthLayout>;
}
