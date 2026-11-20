import Link from 'next/link';
export default function NotFound() {
  return (<div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center"><p className="text-sm font-medium">Page not found</p>
    <p className="text-xs text-muted">It may have moved, or you may not have access to it.</p><Link href="/dashboard" className="mt-3 text-[13px] text-accent hover:underline">Back to home</Link></div>);
}
