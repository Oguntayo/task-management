'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ActionResult } from '@/lib/utils';

/** Runs a server action, surfaces success/error as a toast, refreshes server data. */
export function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  function run<T>(fn: () => Promise<ActionResult<T>>, opts?: { onOk?: (r: Extract<ActionResult<T>, { ok: true }>) => void; success?: string }) {
    start(async () => {
      setFieldErrors({});
      try {
        const r = await fn();
        if (r.ok) { const m = opts?.success ?? r.message; if (m) toast.success(m); opts?.onOk?.(r); router.refresh(); }
        else { setFieldErrors(r.fieldErrors ?? {}); toast.error(r.error); }
      } catch (e) { if ((e as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw e; toast.error('Something went wrong. Please try again.'); }
    });
  }
  return { run, pending, fieldErrors };
}
