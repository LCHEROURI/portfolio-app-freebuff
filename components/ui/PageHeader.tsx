import { type ReactNode } from 'react';

export const PageHeader = ({ title, description, action, children }: {
  title: string; description?: string; action?: ReactNode; children?: ReactNode;
}) => (
  <div className="mb-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-pepper-500 dark:text-pepper-300">{description}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);
