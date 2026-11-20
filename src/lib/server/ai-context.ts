import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeWorkload, estimationHistory, type TaskRec, type TimeLogRec } from '@/lib/domain/analytics';
import { workingDays, toLocalDate } from '@/lib/domain/dates';
import type { CompanySettings } from '@/lib/auth/context';
import type { EstimateInput, ExtensionInput } from '@/lib/ai/types';

async function loadHistory(companyId: string, categoryId: string | null, userId: string) {
  const admin = createAdminClient();
  let q = admin.from('tasks').select('id, status, department_id, original_deadline, current_deadline, approved_at, completed_at, estimated_hours, complexity, task_assignees(user_id)')
    .eq('company_id', companyId).eq('status', 'completed').order('completed_at', { ascending: false }).limit(200);
  if (categoryId) q = q.eq('category_id', categoryId);
  const { data } = await q;
  const tasks: TaskRec[] = (data ?? []).map((t: any) => ({ ...t, assignee_ids: t.task_assignees.map((a: any) => a.user_id) }));
  const ids = tasks.map((t) => t.id);
  const { data: logs } = ids.length ? await admin.from('task_time_logs').select('task_id, user_id, hours, logged_on').in('task_id', ids) : { data: [] as TimeLogRec[] };
  return estimationHistory(tasks, (logs ?? []) as TimeLogRec[]);
}

export async function buildEstimateInput(a: {
  companyId: string; userId: string; settings: CompanySettings; tz: string;
  task: { title: string; description: string; categoryId: string | null; categoryName: string | null; expectedDeliverable: string | null;
          estimatedHours: number | null; startDate: string | null; deadline: string | null; dependencyTitles: string[] };
}): Promise<EstimateInput> {
  const admin = createAdminClient();
  const [history, { data: open }, { data: unplanned }] = await Promise.all([
    loadHistory(a.companyId, a.task.categoryId, a.userId),
    admin.from('tasks').select('id, status, department_id, original_deadline, current_deadline, approved_at, completed_at, estimated_hours, complexity, progress, task_assignees!inner(user_id)')
      .eq('company_id', a.companyId).in('status', ['approved', 'in_progress', 'blocked', 'under_review']).eq('task_assignees.user_id', a.userId),
    admin.from('unplanned_work_entries').select('hours_spent').eq('company_id', a.companyId).eq('user_id', a.userId).neq('review_status', 'rejected')
      .gte('occurred_at', new Date(Date.now() - 28 * 86_400_000).toISOString()),
  ]);
  const today = toLocalDate(new Date(), a.tz);
  const dl = a.task.deadline ? toLocalDate(a.task.deadline, a.tz) : null;
  const capacity = dl ? workingDays(today, dl < today ? today : dl, a.settings.working_days) * a.settings.working_hours_per_day : 0;
  const wl = computeWorkload({ tasks: (open ?? []).map((t: any) => ({ ...t, assignee_ids: [a.userId] })), userIds: [a.userId], capacityHoursPerUser: capacity })[0]!;
  const openIds = (open ?? []).map((t: any) => t.id as string);
  const { count: openBlockers } = openIds.length
    ? await admin.from('task_blockers').select('id', { count: 'exact', head: true }).in('task_id', openIds).eq('status', 'open')
    : { count: 0 };
  return {
    title: a.task.title, description: a.task.description, category: a.task.categoryName, expectedDeliverable: a.task.expectedDeliverable,
    employeeEstimateHours: a.task.estimatedHours, startDate: a.task.startDate, deadline: a.task.deadline,
    dependencies: a.task.dependencyTitles, workingHoursPerDay: a.settings.working_hours_per_day,
    workload: { openTasks: wl.openTasks, remainingHours: wl.remainingHours, capacityHours: wl.capacityHours },
    history, recentUnplannedHours: (unplanned ?? []).reduce((s: number, u: any) => s + Number(u.hours_spent), 0),
    openBlockers: openBlockers ?? 0,
  };
}

export async function buildExtensionInput(requestId: string, settings: CompanySettings): Promise<ExtensionInput> {
  const admin = createAdminClient();
  const { data: r } = await admin.from('task_deadline_change_requests')
    .select('*, tasks(title, estimated_hours, progress, original_deadline, current_deadline, creator_id, task_assignees(user_id))').eq('id', requestId).single();
  const t = r!.tasks as any;
  const people: string[] = [...new Set([r!.requested_by, ...t.task_assignees.map((a: any) => a.user_id)])] as string[];
  const since = new Date(new Date(r!.original_deadline ?? r!.previous_deadline).getTime() - 7 * 86_400_000).toISOString();
  const [{ data: logs }, { data: blockers }, { data: unplanned }, { count: prev }] = await Promise.all([
    admin.from('task_time_logs').select('hours').eq('task_id', r!.task_id),
    admin.from('task_blockers').select('description, is_external').eq('task_id', r!.task_id).eq('status', 'open'),
    admin.from('unplanned_work_entries').select('title, hours_spent, is_urgent').eq('company_id', r!.company_id).in('user_id', people)
      .neq('review_status', 'rejected').gte('occurred_at', since).lte('occurred_at', r!.previous_deadline),
    admin.from('task_deadline_change_requests').select('id', { count: 'exact', head: true }).eq('task_id', r!.task_id).eq('status', 'approved'),
  ]);
  const toDay = (iso: string) => iso.slice(0, 10);
  return {
    taskTitle: t.title, originalDeadline: r!.original_deadline, currentDeadline: r!.previous_deadline, requestedDeadline: r!.requested_deadline,
    reason: r!.reason, estimatedHours: t.estimated_hours, actualHours: (logs ?? []).reduce((s: number, l: any) => s + Number(l.hours), 0),
    progress: t.progress, workingHoursPerDay: settings.working_hours_per_day,
    workingDaysRequested: Math.max(0, workingDays(toDay(r!.previous_deadline), toDay(r!.requested_deadline), settings.working_days) - 1),
    openBlockers: (blockers ?? []).map((b: any) => ({ description: b.description, external: b.is_external })),
    unplannedWorkDuringPeriod: (unplanned ?? []).map((u: any) => ({ title: u.title, hours: Number(u.hours_spent), urgent: u.is_urgent })),
    previousExtensions: prev ?? 0,
  };
}
