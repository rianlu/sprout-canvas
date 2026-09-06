import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sprout_canvas_theme';

function readSavedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function readInitialTheme(): Theme {
  // 内联脚本已写入 class (缺省 light), 这里读回并归一化
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  // v3.5: 暗色载体 = <html class="dark"> (与 stitch.css .dark 作用域对齐, DESIGN.md §1)
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#FAF9F5' : '#171B16');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 默认主题固定为浅色 (品牌基准), 不跟随系统 prefers-color-scheme;
  // 用户切换后由 localStorage 持久化 (toggle 内写入).

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { theme, toggle };
}
