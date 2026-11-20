import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderEmail, type EmailContent, type NotificationType, NOTIFICATION_LABELS } from '@/lib/email/templates';
import { sendMail } from '@/lib/email/send';
import { appUrl } from '@/lib/utils';

export interface NotifyInput {
  companyId: string;
  userIds: string[];
  type: NotificationType;
  title?: string;
  body: string;
  link?: string;                       // app-relative, e.g. /tasks/123
  dedupeKey?: string;                  // same key + same user => sent at most once
  details?: Array<[string, string]>;
  excludeUserId?: string;              // do not notify the actor about their own action
}

/** In-app notification + email, honouring per-user preferences, with DB-enforced de-duplication and delivery logging. */
export async function notify(n: NotifyInput) {
  const admin = createAdminClient();
  const ids = [...new Set(n.userIds)].filter((id) => id !== n.excludeUserId);
  if (!ids.length) return;
  const [{ data: profiles }, { data: prefs }, { data: company }] = await Promise.all([
    admin.from('profiles').select('id, email, full_name').in('id', ids),
    admin.from('notification_preferences').select('user_id, email_enabled, in_app_enabled').eq('company_id', n.companyId).eq('type', n.type).in('user_id', ids),
    admin.from('companies').select('name').eq('id', n.companyId).single(),
  ]);
  const prefBy = new Map((prefs ?? []).map((p) => [p.user_id, p]));
  const title = n.title ?? NOTIFICATION_LABELS[n.type];

  for (const p of profiles ?? []) {
    const pref = prefBy.get(p.id);
    const inApp = pref?.in_app_enabled ?? true, email = pref?.email_enabled ?? true;
    if (inApp) {
      const { error } = await admin.from('notifications').insert({
        company_id: n.companyId, user_id: p.id, type: n.type, title, body: n.body, link: n.link ?? null,
        dedupe_key: n.dedupeKey ?? null });
      if (error && error.code !== '23505') console.error('[notify] in-app insert failed', error.message);
    }
    if (!email || !p.email) continue;
    const content: EmailContent = { title, intro: n.body, details: n.details, ctaUrl: n.link ? appUrl(n.link) : undefined, ctaLabel: 'View details' };
    const { html, text } = renderEmail(content, company?.name ? `${company.name} · Workline` : 'Workline');
    const { data: log, error: logErr } = await admin.from('email_delivery_logs').insert({
      company_id: n.companyId, user_id: p.id, to_email: p.email, template: n.type, subject: title, status: 'queued',
      dedupe_key: n.dedupeKey ?? null }).select('id').single();
    if (logErr) { if (logErr.code !== '23505') console.error('[notify] email log failed', logErr.message); continue; } // duplicate => already sent/queued
    const res = await sendMail({ to: p.email, subject: title, html, text });
    await admin.from('email_delivery_logs').update(
      res.ok ? { status: 'sent', provider_message_id: res.messageId, sent_at: new Date().toISOString() }
             : { status: res.skipped ? 'skipped' : 'failed', error: res.error }).eq('id', log.id);
  }
}

/** Active members of a company holding any of the given roles. */
export async function usersWithRoles(companyId: string, roles: string[]): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from('membership_roles')
    .select('company_memberships!inner(user_id, status)').eq('company_id', companyId).in('role_key', roles);
  return [...new Set((data ?? []).filter((r: any) => r.company_memberships.status === 'active').map((r: any) => r.company_memberships.user_id as string))];
}

export async function taskParticipants(taskId: string): Promise<{ creator: string; assignees: string[]; companyId: string; title: string }> {
  const admin = createAdminClient();
  const { data: t } = await admin.from('tasks').select('creator_id, company_id, title, task_assignees(user_id)').eq('id', taskId).single();
  return { creator: t!.creator_id, companyId: t!.company_id, title: t!.title, assignees: (t!.task_assignees ?? []).map((a: any) => a.user_id) };
}
