import React from 'react';

// Lightweight shimmering placeholder. Use `rows`/`cols`-friendly via className.
// Props: className (size/shape), rounded (overrides radius).
const Skeleton = ({ className = '', rounded = 'rounded-xl' }) => (
  <div
    className={`${rounded} bg-slate-200 dark:bg-slate-700 animate-pulse ${className}`}
    aria-hidden="true"
  />
);

// A ready-made card skeleton for dashboards/lists.
export const SkeletonCard = ({ lines = 3 }) => (
  <div className="p-6 rounded-[2rem] bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 space-y-4">
    <div className="flex items-center gap-3">
      <Skeleton className="w-12 h-12 rounded-2xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className="h-3 w-full" />
    ))}
  </div>
);

export default Skeleton;
