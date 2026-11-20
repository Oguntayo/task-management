import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays } from '@/lib/domain/dates';
import type { SumBlocker, SumEvent, SumTask, SumTimeLog, SumUnplanned } from '@/lib/domain/summaries';

/** Loads one person's records through the RLS client (so it can only ever return what the caller may see). */
export async function loadReportData(sb: SupabaseClient, companyId: string, userId: string, fromDate: string, toDate: string) {
  const { data: assigned } = await sb.from('task_assignees').select('task_id').eq('company_id', companyId).eq('user_id', userId);
  const ids = (assigned ?? []).map((a) => a.task_id as string);
  const fromIso = `${addDays(fromDate, -1)}T00:00:00Z`, toIso = `${addDays(toDate, 1)}T23:59:59Z`;
  const none = { data: [] as any[] };
  const [tasks, events, unplanned, blockers, logs] = await Promise.all([
    ids.length ? sb.from('tasks').select('id, title, status, progress, priority, original_deadline, current_deadline, approved_at, completed_at, period_start').in('id', ids) : none,
    ids.length ? sb.from('task_activity_logs').select('task_id, unplanned_entry_id, event, created_at, details').in('task_id', ids).gte('created_at', fromIso).lte('created_at', toIso) : none,
    sb.from('unplanned_work_entries').select('id, title, occurred_at, hours_spent, work_status, review_status, is_urgent').eq('company_id', companyId).eq('user_id', userId).gte('occurred_at', fromIso).lte('occurred_at', toIso),
    ids.length ? sb.from('task_blockers').select('id, task_id, description, status, is_external, reported_at, resolved_at').in('task_id', ids) : none,
    sb.from('task_time_logs').select('task_id, hours, logged_on').eq('company_id', companyId).eq('user_id', userId).gte('logged_on', fromDate).lte('logged_on', toDate),
  ]);
  return {
    tasks: (tasks.data ?? []) as SumTask[], events: (events.data ?? []) as SumEvent[], unplanned: (unplanned.data ?? []) as SumUnplanned[],
    blockers: (blockers.data ?? []) as SumBlocker[], timeLogs: (logs.data ?? []).map((l: any) => ({ ...l, hours: Number(l.hours) })) as SumTimeLog[],
  };
}
