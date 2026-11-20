'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { flattenErrors, loginSchema, registerSchema } from '@/lib/validation';
import { appUrl, fail, type ActionResult } from '@/lib/utils';

async function clientIp() {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
}
const safeNext = (n?: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard');

export async function login(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail('Enter a valid email and password', flattenErrors(parsed.error));
  if (!(await rateLimit(createAdminClient(), `auth:${await clientIp()}`, LIMITS.auth.limit, LIMITS.auth.window))) return fail('Too many attempts. Wait a minute and try again.');
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return fail('Incorrect email or password');   // never reveal which one
  redirect(safeNext(form.get('next') as string | null));
}

export async function register(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  if (!(await rateLimit(createAdminClient(), `auth:${await clientIp()}`, LIMITS.auth.limit, LIMITS.auth.window))) return fail('Too many attempts. Wait a minute and try again.');
  const sb = await createClient();
  const next = safeNext(form.get('next') as string | null);
  const { data, error } = await sb.auth.signUp({
    email: parsed.data.email, password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName }, emailRedirectTo: appUrl(`/auth/callback?next=${encodeURIComponent(next === '/dashboard' ? '/onboarding' : next)}`) },
  });
  if (error) return fail(error.message.includes('registered') ? 'An account with this email already exists. Sign in instead.' : 'Could not create the account. Try again.');
  if (data.session) redirect(next === '/dashboard' ? '/onboarding' : next);
  return { ok: true, message: 'Check your inbox to confirm your email, then sign in.' };
}

export async function logout() {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect('/login');
}

export async function forgotPassword(_: unknown, form: FormData): Promise<ActionResult> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Enter a valid email');
  if (!(await rateLimit(createAdminClient(), `auth:${await clientIp()}`, LIMITS.auth.limit, LIMITS.auth.window))) return fail('Too many attempts. Wait a minute and try again.');
  const sb = await createClient();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl('/auth/callback?next=/reset-password') });
  return { ok: true, message: 'If that email has an account, a reset link is on its way.' }; // same answer either way
}

export async function resetPassword(_: unknown, form: FormData): Promise<ActionResult> {
  const password = String(form.get('password') ?? '');
  if (password.length < 10) return fail('Use at least 10 characters');
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password });
  if (error) return fail('Could not update the password. The link may have expired.');
  redirect('/dashboard');
}
