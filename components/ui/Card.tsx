import { type HTMLAttributes, type ReactNode } from 'react';

// Extra props are forwarded so callers can attach data attributes / scroll
// targets (e.g. data-repo-key on the Repositories page for deep links).
export const Card = ({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) => (
  <div className={`card-base ${className}`} {...rest}>{children}</div>
);

export const CardHeader = ({ title, subtitle, action }: {
  title: ReactNode; subtitle?: string; action?: ReactNode;
}) => (
  <div className="mb-4 flex items-start justify-between gap-3">
    <div>
      <h3 className="text-base font-semibold">{title}</h3>
      {subtitle && <p className="mt-0.5 text-sm text-pepper-500 dark:text-pepper-300">{subtitle}</p>}
    </div>
    {action}
  </div>
);

export const StatCard = ({ label, value, icon, tone = 'basil', hint }: {
  label: string; value: ReactNode; icon?: ReactNode; tone?: 'basil' | 'tomato' | 'turmeric' | 'paprika' | 'eggplant' | 'pepper'; hint?: string;
}) => {
  const iconBg = {
    basil: 'bg-basil-100 text-basil-700 dark:bg-basil-900/60 dark:text-basil-200',
    tomato: 'bg-tomato-100 text-tomato-700 dark:bg-tomato-900/60 dark:text-tomato-200',
    turmeric: 'bg-turmeric-100 text-turmeric-700 dark:bg-turmeric-900/60 dark:text-turmeric-200',
    paprika: 'bg-paprika-100 text-paprika-700 dark:bg-paprika-900/60 dark:text-paprika-200',
    eggplant: 'bg-eggplant-100 text-eggplant-700 dark:bg-eggplant-900/60 dark:text-eggplant-200',
    pepper: 'bg-pepper-100 text-pepper-700 dark:bg-pepper-800 dark:text-flour-100',
  } as const;
  return (
    <div className="card-base flex items-center gap-4">
      {icon && (
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl2 ${iconBg[tone]}`}>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-pepper-500 dark:text-pepper-300">{label}</p>
        <p className="text-2xl font-semibold leading-tight text-pepper-900 dark:text-flour-50">{value}</p>
        {hint && <p className="text-xs text-pepper-400 dark:text-pepper-300">{hint}</p>}
      </div>
    </div>
  );
};
