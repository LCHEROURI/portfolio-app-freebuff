import { type ReactNode } from 'react';

export const EmptyState = ({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-butter-300 bg-butter-50/50 px-6 py-12 text-center dark:border-pepper-600 dark:bg-pepper-800/50">
    {icon && <div className="mb-1 text-pepper-300 dark:text-pepper-400">{icon}</div>}
    <h3 className="text-base font-semibold">{title}</h3>
    {description && <p className="max-w-sm text-sm text-pepper-500 dark:text-pepper-300">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);
