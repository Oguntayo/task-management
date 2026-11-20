'use server';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACTIVE_COMPANY_COOKIE, getCtx, getUser } from '@/lib/auth/context';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { companySchema, companySettingsSchema, flattenErrors, inviteSchema } from '@/lib/validation';
import { appUrl, fail, friendlyDbError, slugify, type ActionResult } from '@/lib/utils';
import { renderEmail } from '@/lib/email/templates';
import { sendMail } from '@/lib/email/send';

export async function createCompany(_: unknown, form: FormData): Promise<ActionResult> {
  const user = await getUser(); if (!user) redirect('/login');
  const parsed = companySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const sb = await createClient();
  const rawBase = slugify(parsed.data.name) || 'company';
  // The companies.slug constraint requires at least three characters.
  const base = rawBase.length < 3 ? `${rawBase}-co` : rawBase;
  for (let i = 0; i < 4; i++) {
    const slug = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
    const { data, error } = await sb.rpc('create_company', { p_name: parsed.data.name, p_slug: slug, p_timezone: parsed.data.timezone, p_industry: parsed.data.industry ?? null });
    if (!error) { (await cookies()).set(ACTIVE_COMPANY_COOKIE, data as string, { path: '/', httpOnly: true, sameSite: 'lax', secure: true }); redirect('/dashboard'); }
    if (!/duplicate key|companies_slug_key/.test(error.message)) return fail(friendlyDbError(error.message));
  }
  return fail('Could not allocate a workspace address. Try a different name.');
}

export async function switchCompany(companyId: string) {
  const ctx = await getCtx();
  if (!ctx.memberships.some((m) => m.company_id === companyId)) return;    // only companies you belong to
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
  redirect('/dashboard');
}

export async function updateCompanySettings(input: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  const parsed = companySettingsSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const d = parsed.data;
  const sb = await createClient();
  const { data: cur } = await sb.from('companies').select('settings').eq('id', ctx.companyId).single();
  const { error } = await sb.from('companies').update({
    name: d.name, industry: d.industry ?? null, timezone: d.timezone,
    settings: { ...(cur?.settings ?? {}), reminder_offsets_hours: d.reminderOffsetsHours, remind_on_deadline: d.remindOnDeadline,
      remind_overdue: d.remindOverdue, overdue_notify_roles: d.overdueNotifyRoles, require_completion_review: d.requireCompletionReview,
      working_hours_per_day: d.workingHoursPerDay, allow_self_approval: d.allowSelfApproval, retention_days: d.retentionDays ?? null },
  }).eq('id', ctx.companyId);
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/settings/company');
  return { ok: true, message: 'Settings saved' };
}

export async function addDepartment(name: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const n = name.trim(); if (n.length < 1 || n.length > 80) return fail('Enter a department name');
  const { error } = await (await createClient()).from('departments').insert({ company_id: ctx.companyId, name: n });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/settings/company'); return { ok: true };
}
export async function removeDepartment(id: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const { error } = await (await createClient()).from('departments').delete().eq('id', id).eq('company_id', ctx.companyId);
  if (error) return fail('This department is still in use by people or tasks.');
  revalidatePath('/settings/company'); return { ok: true };
}
export async function addCategory(name: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const n = name.trim(); if (n.length < 1 || n.length > 60) return fail('Enter a category name');
  const { error } = await (await createClient()).from('task_categories').insert({ company_id: ctx.companyId, name: n });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/settings/company'); return { ok: true };
}
export async function removeCategory(id: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const { error } = await (await createClient()).from('task_categories').delete().eq('id', id).eq('company_id', ctx.companyId);
  if (error) return fail('This category is still used by tasks.');
  revalidatePath('/settings/company'); return { ok: true };
}

// ---------- people ----------
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function inviteMember(input: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  if (!ctx.roles.includes('admin')) return fail('Only admins can invite people.');
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  if (!(await rateLimit(createAdminClient(), `invite:${ctx.userId}`, LIMITS.invite.limit, LIMITS.invite.window))) return fail('Invitation limit reached. Try again later.');
  const d = parsed.data;
  const token = randomBytes(32).toString('hex');
  const sb = await createClient();
  const { error } = await sb.from('invitations').insert({
    company_id: ctx.companyId, email: d.email, roles: d.roles, department_id: d.departmentId ?? null, job_title: d.jobTitle ?? null,
    token_hash: hashToken(token), invited_by: ctx.userId });
  if (error) return fail(error.message.includes('duplicate') ? 'This person already has a pending invitation.' : friendlyDbError(error.message));
  const link = appUrl(`/accept-invite?token=${token}`);
  const { html, text } = renderEmail({ title: `You're invited to ${ctx.active.company.name}`,
    intro: `${ctx.fullName} invited you to join ${ctx.active.company.name} on Workline. The link expires in 7 days.`, ctaUrl: link, ctaLabel: 'Accept invitation',
    footerNote: 'If you were not expecting this, you can ignore this email.' });
  const sent = await sendMail({ to: d.email, subject: `Join ${ctx.active.company.name} on Workline`, html, text });
  await createAdminClient().from('email_delivery_logs').insert({ company_id: ctx.companyId, to_email: d.email, template: 'invitation',
    subject: `Join ${ctx.active.company.name} on Workline`, status: sent.ok ? 'sent' : sent.skipped ? 'skipped' : 'failed', error: sent.ok ? null : sent.error, sent_at: sent.ok ? new Date().toISOString() : null });
  revalidatePath('/settings/people');
  return { ok: true, message: sent.ok ? 'Invitation sent' : `Invitation created, but the email could not be sent (${sent.error}). Share this link manually: ${link}` };
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const { error } = await (await createClient()).from('invitations').update({ status: 'revoked' }).eq('id', id).eq('company_id', ctx.companyId).eq('status', 'pending');
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/settings/people'); return { ok: true };
}

export async function setMemberRoles(membershipId: string, roles: string[]): Promise<ActionResult> {
  const ctx = await getCtx();
  const valid = roles.filter((r) => ['admin', 'pm', 'tech_lead', 'employee'].includes(r));
  if (!valid.includes('employee')) valid.push('employee');
  const sb = await createClient();
  const { data: existing } = await sb.from('membership_roles').select('role_key').eq('membership_id', membershipId).eq('company_id', ctx.companyId);
  const have = new Set((existing ?? []).map((r) => r.role_key));
  const add = valid.filter((r) => !have.has(r)), remove = [...have].filter((r) => !valid.includes(r));
  if (add.length) {
    const { error } = await sb.from('membership_roles').insert(add.map((role_key) => ({ membership_id: membershipId, company_id: ctx.companyId, role_key })));
    if (error) return fail(friendlyDbError(error.message));
  }
  if (remove.length) {
    const { error } = await sb.from('membership_roles').delete().eq('membership_id', membershipId).eq('company_id', ctx.companyId).in('role_key', remove);
    if (error) return fail(friendlyDbError(error.message));
  }
  revalidatePath('/settings/people'); return { ok: true, message: 'Roles updated' };
}

export async function setMemberDepartment(membershipId: string, departmentId: string | null): Promise<ActionResult> {
  const ctx = await getCtx();
  const { error } = await (await createClient()).from('company_memberships').update({ department_id: departmentId || null }).eq('id', membershipId).eq('company_id', ctx.companyId);
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/settings/people'); return { ok: true };
}

export async function removeMember(membershipId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const { error } = await (await createClient()).from('company_memberships').update({ status: 'removed' }).eq('id', membershipId).eq('company_id', ctx.companyId);
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/settings/people'); return { ok: true, message: 'Member removed. Their task history is preserved.' };
}

export async function acceptInvitation(token: string): Promise<ActionResult> {
  const user = await getUser(); if (!user) redirect(`/login?next=${encodeURIComponent('/accept-invite?token=' + token)}`);
  if (!(await rateLimit(createAdminClient(), `auth:${user.id}`, LIMITS.auth.limit, LIMITS.auth.window))) return fail('Too many attempts.');
  const { data, error } = await (await createClient()).rpc('accept_invitation', { p_token: token });
  if (error) return fail(friendlyDbError(error.message));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, data as string, { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
  redirect('/dashboard');
}
