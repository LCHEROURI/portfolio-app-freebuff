export const Progress = ({ value, tone }: { value: number; tone?: 'auto' | 'basil' | 'tomato' | 'turmeric' }) => {
  const clamped = Math.max(0, Math.min(100, value));
  const bar = tone === 'basil'
    ? 'bg-basil-500'
    : tone === 'tomato'
      ? 'bg-tomato-500'
      : tone === 'turmeric'
        ? 'bg-turmeric-500'
        : clamped >= 75 ? 'bg-basil-500' : clamped >= 40 ? 'bg-turmeric-500' : 'bg-tomato-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-butter-200 dark:bg-pepper-700" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${clamped}%` }} />
    </div>
  );
};
