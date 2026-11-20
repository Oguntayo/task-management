'use client';
import { Button } from '@/components/ui/button';
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (<div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center"><p className="text-sm font-medium">Something went wrong</p>
    <p className="text-xs text-muted">The problem has been logged. You can try again.</p><Button className="mt-3" onClick={reset}>Try again</Button></div>);
}
