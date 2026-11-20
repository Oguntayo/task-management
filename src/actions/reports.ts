'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCtx } from '@/lib/auth/context';
import { loadReportData } from '@/lib/server/report-data';
import { buildDailySummary, buildWeeklySummary } from '@/lib/domain/summaries';
import { addDays, toLocalDate, weekEnd, weekStart } from '@/lib/domain/dates';
import { notify, usersWithRoles } from '@/lib/server/notify';
import { fail, friendlyDbError, type ActionResult } from '@/lib/utils';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** (Re)generates the system summary from task records. Employee notes are kept; submitted reports are never regenerated. */
export async function generateStandup(date?: string): Promise<ActionResult> {
  const ctx = await getCtx(); const sb = await createClient();
  const d = date && isDate(date) ? date : toLocalDate(new Date(), ctx.tz);
  const data = await loadReportData(sb, ctx.companyId, ctx.userId, addDays(d, -1), d);
  const generated = buildDailySummary({ date: d, tz: ctx.tz, ...data });
  const { data: existing } = await sb.from('standup_reports').select('id, status').eq('company_id', ctx.companyId).eq('user_id', ctx.userId).eq('report_date', d).maybeSingle();
  if (existing?.status === 'submitted') return fail('This stand-up was already submitted.');
  const { error } = existing
    ? await sb.from('standup_reports').update({ generated }).eq('id', existing.id)
    : await sb.from('standup_reports').insert({ company_id: ctx.companyId, user_id: ctx.userId, report_date: d, generated });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/reports'); return { ok: true, message: 'Summary generated from your task records' };
}

export async function submitStandup(date: string, notes: string): Promise<ActionResult> {
  const ctx = await getCtx(); const sb = await createClient();
  const { error, data } = await sb.from('standup_reports').update({ employee_notes: notes.trim() || null, status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('company_id', ctx.companyId).eq('user_id', ctx.userId).eq('report_date', date).eq('status', 'draft').select('id');
  if (error) return fail(friendlyDbError(error.message));
  if (!data?.length) return fail('Generate the summary first (or it was already submitted).');
  revalidatePath('/reports'); return { ok: true, message: 'Stand-up submitted' };
}

export async function generateWeekly(anyDateInWeek?: string): Promise<ActionResult> {
  const ctx = await getCtx(); const sb = await createClient();
  const today = toLocalDate(new Date(), ctx.tz);
  const ws = weekStart(anyDateInWeek && isDate(anyDateInWeek) ? anyDateInWeek : today);
  const data = await loadReportData(sb, ctx.companyId, ctx.userId, ws, weekEnd(ws));
  const generated = buildWeeklySummary({ date: ws, tz: ctx.tz, now: new Date().toISOString(), tasks: data.tasks, events: data.events, unplanned: data.unplanned, blockers: data.blockers });
  const { data: existing } = await sb.from('weekly_reports').select('id, status').eq('company_id', ctx.companyId).eq('user_id', ctx.userId).eq('week_start', ws).maybeSingle();
  if (existing?.status === 'submitted') return fail('This weekly report was already submitted.');
  const { error } = existing
    ? await sb.from('weekly_reports').update({ generated }).eq('id', existing.id)
    : await sb.from('weekly_reports').insert({ company_id: ctx.companyId, user_id: ctx.userId, week_start: ws, generated });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/reports'); return { ok: true, message: 'Weekly summary generated' };
}

export async function submitWeekly(weekStartDate: string, notes: string): Promise<ActionResult> {
  const ctx = await getCtx(); const sb = await createClient();
  const { error, data } = await sb.from('weekly_reports').update({ employee_notes: notes.trim() || null, status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('company_id', ctx.companyId).eq('user_id', ctx.userId).eq('week_start', weekStartDate).eq('status', 'draft').select('id');
  if (error) return fail(friendlyDbError(error.message));
  if (!data?.length) return fail('Generate the summary first (or it was already submitted).');
  await notify({ companyId: ctx.companyId, userIds: await usersWithRoles(ctx.companyId, ['pm', 'admin']), excludeUserId: ctx.userId, type: 'weekly_report_available',
    body: `${ctx.fullName} submitted their weekly report for the week of ${weekStartDate}.`, link: `/team/reports?week=${weekStartDate}`, dedupeKey: `weekly_submitted:${ctx.userId}:${weekStartDate}` });
  revalidatePath('/reports'); revalidatePath('/team/reports'); return { ok: true, message: 'Weekly report submitted' };
}
