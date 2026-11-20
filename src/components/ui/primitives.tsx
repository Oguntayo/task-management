import * as React from 'react';
import Link from 'next/link';
import { cn, initials } from '@/lib/utils';
import { STATUS_LABEL, type TaskStatus } from '@/lib/domain/task-state';

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={cn('rounded-lg border bg-surface shadow-sm', className)} {...p} />;
export const CardHeader = ({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) => (
  <div className={cn('flex items-start justify-between gap-3 border-b px-4 py-3', className)}>
    <div className="min-w-0"><h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted">{description}</p>}</div>{action}
  </div>);

const TONES = {
  neutral: 'bg-surface-2 text-muted', accent: 'bg-accent-soft text-accent-soft-fg', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', urgent: 'bg-urgent-soft text-urgent',
} as const;
export type Tone = keyof typeof TONES;
export const Badge = ({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) =>
  <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4', TONES[tone], className)}>{children}</span>;

// Restrained: only states that need attention get colour. Everything routine stays neutral.
const STATUS_TONE: Record<TaskStatus, Tone> = {
  draft: 'neutral', submitted: 'info', pending_approval: 'info', approved: 'accent', in_progress: 'accent', blocked: 'danger',
  under_review: 'info', completed: 'ok', rejected: 'danger', cancelled: 'neutral' };
export const StatusBadge = ({ status }: { status: TaskStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
export const PriorityBadge = ({ priority }: { priority: string }) =>
  priority === 'urgent' ? <Badge tone="urgent">Urgent</Badge> : priority === 'high' ? <Badge tone="warn">High</Badge> : <span className="text-[11px] capitalize text-subtle">{priority}</span>;
export const WorkTypeBadge = ({ unplanned, urgent }: { unplanned?: boolean; urgent?: boolean }) =>
  unplanned ? <Badge tone={urgent ? 'urgent' : 'warn'}>{urgent ? 'Urgent · unplanned' : 'Unplanned'}</Badge> : <Badge>Planned</Badge>;

export function Avatar({ name, url, size = 24 }: { name?: string | null; url?: string | null; size?: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
    : <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-medium text-accent-soft-fg" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>{initials(name)}</span>;
}

export const Progress = ({ value, className }: { value: number; className?: string }) => (
  <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>);

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton h-4', className)} aria-hidden />;

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-subtle">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>);
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>);
}

/** Single-figure stat with optional hint; deliberately not a coloured tile. */
export const Stat = ({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: 'danger' }) => {
  const body = (<div className="px-4 py-3"><p className="text-xs text-muted">{label}</p>
    <p className={cn('tabular mt-1 text-2xl font-semibold tracking-tight', tone === 'danger' && 'text-danger')}>{value}</p>{hint && <p className="mt-0.5 text-[11px] text-subtle">{hint}</p>}</div>);
  return href ? <Link href={href} className="block rounded-lg transition-colors hover:bg-surface-2">{body}</Link> : body;
};

export const FieldError = ({ errors }: { errors?: string[] | string }) => {
  const m = Array.isArray(errors) ? errors[0] : errors; return m ? <p className="mt-1 text-xs text-danger" role="alert">{m}</p> : null;
};
const inputBase = 'w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13px] shadow-sm placeholder:text-subtle focus-visible:border-accent disabled:opacity-60';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(inputBase, 'h-8', className)} {...p} />);
Input.displayName = 'Input';
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(inputBase, 'min-h-20 py-1.5', className)} {...p} />);
Textarea.displayName = 'Textarea';
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(inputBase, 'h-8 pr-6', className)} {...p} />);
Select.displayName = 'Select';
export const Label = ({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: string }) => (
  <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium">{children}{hint && <span className="ml-1 font-normal text-subtle">{hint}</span>}</label>);
export const Field = ({ label, hint, error, htmlFor, children, className }: { label: string; hint?: string; error?: string[] | string; htmlFor?: string; children: React.ReactNode; className?: string }) => (
  <div className={className}><Label htmlFor={htmlFor} hint={hint}>{label}</Label>{children}<FieldError errors={error} /></div>);
