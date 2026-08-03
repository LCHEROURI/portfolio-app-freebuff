'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'apcc-theme';

const getSystemTheme = (): 'light' | 'dark' =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

const getStored = (): ThemeMode => {
  if (typeof window === 'undefined') return 'system';
  // ?theme=light|dark overrides the stored preference (shareable demo links).
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (fromUrl === 'light' || fromUrl === 'dark') return fromUrl;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
};

const applyTheme = (mode: ThemeMode) => {
  if (typeof document === 'undefined') return;
  const resolved = mode === 'system' ? getSystemTheme() : mode;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
};

interface ThemeApi {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // Bootstrap before paint to avoid a flash of the wrong theme.
  useEffect(() => {
    const initial = getStored();
    setThemeState(initial);
    applyTheme(initial);
    setResolvedTheme(initial === 'system' ? getSystemTheme() : initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      applyTheme('system');
      setResolvedTheme(getSystemTheme());
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
    applyTheme(mode);
    setResolvedTheme(mode === 'system' ? getSystemTheme() : mode);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeApi => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
