'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const Modal = ({ open, onClose, title, description, children, wide }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; wide?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-pepper-900/60 p-4 backdrop-blur-xs sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="apcc-modal-title"
    >
      <div
        ref={ref}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-xl2 bg-white p-6 shadow-plate outline-none dark:border dark:border-pepper-700 dark:bg-pepper-800`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="apcc-modal-title" className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-pepper-500 dark:text-pepper-300">{description}</p>}
          </div>
          <button type="button" aria-label="Close dialog" className="btn-ghost rounded-md p-1.5" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
