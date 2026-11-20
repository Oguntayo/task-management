'use client';
import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root; export const DialogTrigger = D.Trigger; export const DialogClose = D.Close;

/** side="right" renders a task-style side panel; default is a centred modal. Full-screen on mobile. */
export function DialogContent({ title, description, side, className, children }: { title: string; description?: string; side?: 'right'; className?: string; children: React.ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" style={{ animation: 'fade-in .15s' }} />
      <D.Content
        className={cn('fixed z-50 flex flex-col bg-surface shadow-md outline-none',
          side === 'right' ? 'inset-y-0 right-0 w-full max-w-xl border-l' : 'inset-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border', className)}
        style={{ animation: side === 'right' ? 'slide-in .2s ease-out' : 'fade-in .15s' }}>
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div><D.Title className="text-[15px] font-semibold tracking-tight">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}</div>
          <D.Close className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close"><X className="size-4" /></D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>);
}
