import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { notify, usersWithRoles } from '@/lib/server/notify';
import { addDays, isoWeekday, toLocalDate, weekStart } from '@/lib/domain/dates';
import type { CompanySettings } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorised(req: NextRequest) {
  const secret = process.env.CRON_SECRET; if (!secret) return false;
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Runs every 15 minutes (vercel.json) — independent of any browser session.
 * Idempotent: every notification carries a dedupe key enforced by unique indexes, so overlapping or retried runs never double-send.
 */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = createAdminClient(); const now = new Date();
  const counts = { approaching: 0, today: 0, overdue: 0, weekly: 0 };
  const { data: companies } = await admin.from('companies').select('id, timezone, settings').eq('status', 'active');

  for (const c of companies ?? []) {
    const s = c.settings as CompanySettings, tz = c.timezone as string, today = toLocalDate(now, tz);
    const { data: tasks } = await admin.from('tasks').select('id, title, current_deadline, creator_id, task_assignees(user_id)')
      .eq('company_id', c.id).in('status', ['approved', 'in_progress', 'blocked', 'under_review']).not('current_deadline', 'is', null);
    const [managers, admins] = [await usersWithRoles(c.id, ['pm']), await usersWithRoles(c.id, ['admin'])];

    for (const t of tasks ?? []) {
      const deadline = new Date(t.current_deadline as string);
      const people = [...new Set((t.task_assignees as any[]).map((a) => a.user_id as string))];
      const link = `/tasks/${t.id}`, dkey = deadline.toISOString();
      if (deadline > now) {
        for (const h of s.reminder_offsets_hours ?? []) {
          if (deadline.getTime() - now.getTime() <= h * 3_600_000) {
            await notify({ companyId: c.id, userIds: people, type: 'deadline_approaching', body: `"${t.title}" is due ${deadline.toLocaleString('en-GB', { timeZone: tz })}.`, link, dedupeKey: `appr:${t.id}:${h}:${dkey}` });
            counts.approaching++;
          }
        }
        if (s.remind_on_deadline && toLocalDate(deadline, tz) === today) {
          await notify({ companyId: c.id, userIds: people, type: 'deadline_today', body: `"${t.title}" is due today.`, link, dedupeKey: `today:${t.id}:${dkey}` });
          counts.today++;
        }
      } else if (s.remind_overdue) {
        const roles = s.overdue_notify_roles ?? [];
        const extra = [...(roles.includes('pm') ? managers : []), ...(roles.includes('admin') ? admins : [])];
        await notify({ companyId: c.id, userIds: [...people, ...extra], type: 'deadline_missed', body: `"${t.title}" passed its deadline and is not complete.`, link, dedupeKey: `missed:${t.id}:${dkey}` });
        const daysLate = (now.getTime() - deadline.getTime()) / 86_400_000;
        if (daysLate >= 1 && daysLate <= 7) await notify({ companyId: c.id, userIds: people, type: 'deadline_missed', title: 'Task still overdue', body: `"${t.title}" is still overdue. Update progress, report a blocker, or request an extension.`, link, dedupeKey: `overdue_daily:${t.id}:${today}` });
        counts.overdue++;
      }
    }
    // Friday afternoon (local): nudge everyone to review their weekly summary
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now));
    if (isoWeekday(today) === 5 && localHour >= 15) {
      const ws = weekStart(today);
      const { data: members } = await admin.from('company_memberships').select('user_id').eq('company_id', c.id).eq('status', 'active');
      for (const m of members ?? []) {
        await notify({ companyId: c.id, userIds: [m.user_id], type: 'weekly_report_available', body: 'Your weekly summary is ready. Review it and add context before submitting.', link: '/reports', dedupeKey: `weekly:${c.id}:${ws}:${m.user_id}` });
        counts.weekly++;
      }
    }
    void addDays;
  }
  return NextResponse.json({ ok: true, ranAt: now.toISOString(), ...counts });
}
