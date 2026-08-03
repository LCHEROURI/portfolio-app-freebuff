'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FolderKanban, GitFork, CalendarClock, ListTodo, Rocket,
  GitBranch, Scale, FileText, History, Plug, Settings, X, Sun, Moon, Monitor,
  Sparkles,
} from 'lucide-react';

import { useTheme } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { isFirebaseConfigured } from '@/lib/firebase';

const NAV = [
  { href: '/command-center', label: 'Command Center', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/versions', label: 'Versions', icon: GitFork },
  { href: '/today', label: 'Today', icon: CalendarClock },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/deployments', label: 'Deployments', icon: Rocket },
  { href: '/repositories', label: 'Repositories', icon: GitBranch },
  { href: '/model-comparison', label: 'Model Comparison', icon: Scale },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/activity', label: 'Activity', icon: History },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-butter-200 bg-butter-50 p-1 dark:border-pepper-700 dark:bg-pepper-800">
      {([
        { mode: 'light', icon: Sun, label: 'Light' },
        { mode: 'dark', icon: Moon, label: 'Dark' },
        { mode: 'system', icon: Monitor, label: 'System' },
      ] as const).map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          type="button"
          aria-label={`${label} theme`}
          title={label}
          onClick={() => setTheme(mode)}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            theme === mode
              ? 'bg-tomato-500 text-white'
              : 'text-pepper-500 hover:bg-butter-100 hover:text-pepper-700 dark:text-pepper-300 dark:hover:bg-pepper-700'
          }`}
        >
          <Icon size={14} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
};

export const Sidebar = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const isActive = (href: string) =>
    href === '/command-center' ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-pepper-900/60 backdrop-blur-xs lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-butter-200 bg-butter-50/95 backdrop-blur transition-transform duration-200 dark:border-pepper-700 dark:bg-pepper-800 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Primary navigation"
      >
        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
          <Link href="/command-center" className="flex items-center gap-2.5" onClick={onClose}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl2 bg-gradient-spice text-white shadow-warm">
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-sm font-bold text-pepper-900 dark:text-flour-50">Command Center</span>
              <span className="block text-[11px] text-pepper-500 dark:text-pepper-300">App Portfolio</span>
            </span>
          </Link>
          <button type="button" className="btn-ghost rounded-md p-1.5 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="scrollbar-thin mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-tomato-500 text-white shadow-warm'
                    : 'text-pepper-600 hover:bg-butter-100 hover:text-pepper-900 dark:text-pepper-300 dark:hover:bg-pepper-700 dark:hover:text-flour-50'
                }`}
              >
                <Icon size={17} aria-hidden="true" className={active ? 'text-white' : 'text-pepper-400 group-hover:text-pepper-600 dark:text-pepper-400'} />
                <span className="flex-1">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-butter-200 px-4 py-4 dark:border-pepper-700">
          <ThemeToggle />
          <div className="flex items-center gap-2 rounded-lg bg-butter-100 px-3 py-2 text-xs text-pepper-600 dark:bg-pepper-700 dark:text-pepper-200">
            <span className={`h-2 w-2 shrink-0 rounded-full ${isFirebaseConfigured() ? 'bg-basil-500' : 'bg-turmeric-500'}`} />
            {isFirebaseConfigured() ? 'Firebase connected' : 'Demo mode — local data'}
          </div>
          {isFirebaseConfigured() && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-butter-100 px-3 py-2 text-xs text-pepper-600 dark:bg-pepper-700 dark:text-pepper-200">
              <span className="truncate">{user?.email ?? user?.displayName ?? 'Signed in'}</span>
              <button
                type="button"
                className="shrink-0 font-semibold text-tomato-600 hover:underline dark:text-tomato-400"
                onClick={() => signOut()}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
