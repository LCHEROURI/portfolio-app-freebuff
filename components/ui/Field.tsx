import { type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export const Field = ({ label, hint, children, className = '' }: {
  label: string; hint?: string; children: ReactNode; className?: string;
}) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-pepper-500 dark:text-pepper-300">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-pepper-400">{hint}</span>}
  </label>
);

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`input-base ${props.className ?? ''}`} />
);

export const Select = ({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={`input-base ${props.className ?? ''}`}>{children}</select>
);

export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`input-base ${props.className ?? ''}`} />
);
