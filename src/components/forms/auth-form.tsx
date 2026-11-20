'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import type { ActionResult } from '@/lib/utils';

type Fn = (prev: unknown, form: FormData) => Promise<ActionResult>;
export function AuthForm({ action, mode, next, email }: { action: Fn; mode: 'login' | 'register' | 'forgot' | 'reset'; next?: string; email?: string }) {
  const [state, formAction, pending] = useActionState(action, null as ActionResult | null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const label = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Set new password' }[mode];
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {mode === 'register' && <Field label="Full name" htmlFor="fullName" error={fe.fullName}><Input id="fullName" name="fullName" autoComplete="name" required /></Field>}
      {mode !== 'reset' && <Field label="Work email" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" defaultValue={email} readOnly={!!email} required /></Field>}
      {mode !== 'forgot' && <Field label={mode === 'reset' ? 'New password' : 'Password'} hint={mode !== 'login' ? '10+ characters' : undefined} htmlFor="password" error={fe.password}>
        <Input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field>}
      {state && !state.ok && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{state.error}</p>}
      {state?.ok && state.message && <p className="rounded-md bg-ok-soft px-3 py-2 text-xs text-ok" role="status">{state.message}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>{label}</Button>
      <div className="flex justify-between text-xs text-muted">
        {mode === 'login' && <><Link className="hover:text-fg" href="/forgot-password">Forgot password?</Link><Link className="hover:text-fg" href={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link></>}
        {mode === 'register' && <Link className="hover:text-fg" href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Already have an account? Sign in</Link>}
        {mode === 'forgot' && <Link className="hover:text-fg" href="/login">Back to sign in</Link>}
      </div>
    </form>);
}
