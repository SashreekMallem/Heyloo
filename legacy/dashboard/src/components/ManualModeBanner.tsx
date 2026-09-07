import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function ManualModeBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-100 text-sm">
      <AlertCircle className="h-5 w-5" />
      <div className="flex-1">
        <p className="font-semibold">Manual Mode Enabled</p>
        <p className="text-amber-200">POS sync is disabled. Manage data directly in the dashboard.</p>
        {children}
      </div>
    </div>
  );
}
