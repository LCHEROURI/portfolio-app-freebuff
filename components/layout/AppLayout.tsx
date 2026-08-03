'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, Sparkles } from 'lucide-react';

import { Sidebar } from '@/components/layout/Sidebar';
import { useStore } from '@/lib/store';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const store = useStore();
  const userName = store?.profile.name ?? '';

  return (
    <div className="flex min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-butter-200 bg-flour-50/90 px-4 py-3 backdrop-blur dark:border-pepper-700 dark:bg-pepper-900/90 lg:hidden">
          <button
            type="button"
            className="btn-ghost rounded-md p-2"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link href="/command-center" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-spice text-white">
              <Sparkles size={14} aria-hidden="true" />
            </span>
            <span className="font-display text-sm font-bold">Command Center</span>
          </Link>
          <span className="ml-auto text-xs text-pepper-500 dark:text-pepper-300">{userName}</span>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>

        <footer className="border-t border-butter-200 px-6 py-4 text-center text-xs text-pepper-400 dark:border-pepper-700 dark:text-pepper-400">
          App Portfolio Command Center · tracks every AI-built implementation of your app concept
        </footer>
      </div>
    </div>
  );
};
