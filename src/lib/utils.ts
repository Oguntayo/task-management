import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48).replace(/^-|-$/g, '');
}
export const initials = (name: string | null | undefined) =>
  (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

export function appUrl(path = ''): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${path}`;
}
export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
export const fail = (error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> => ({ ok: false, error, fieldErrors });
/** Map Postgres/RLS errors to something a person can act on, without leaking internals. */
export function friendlyDbError(message: string): string {
  if (/could not find the function public\.create_company|PGRST202/i.test(message)) {
    return 'Workspace setup is not available in the database yet. Apply the latest Supabase migrations, then try again.';
  }
  if (/companies_created_by_fkey/i.test(message)) {
    return 'Your account profile is missing from the database. Apply the profile backfill migration, then try again.';
  }
  if (/row-level security|permission denied/i.test(message)) return 'You do not have permission to do that.';
  if (/duplicate key/i.test(message)) return 'That already exists.';
  const known = ['cannot approve', 'cannot review', 'note is required', 'immutable', 'illegal task status', 'open blockers',
    'later than the current', 'at least one active admin', 'deadline', 'invitation', 'different email', 'requires review', 'not awaiting', 'cannot decide', 'expired'];
  if (known.some((k) => message.toLowerCase().includes(k))) return message.replace(/^.*?ERROR:\s*/, '');
  console.error('[db]', message);
  return 'Something went wrong. Please try again.';
}
