import { daysBetween, hoursBetween } from './dates';
import type { TaskStatus } from './task-state';

export interface TaskRec {
  id: string; status: TaskStatus; department_id: string | null; assignee_ids: string[];
  original_deadline: string | null; current_deadline: string | null;
  approved_at: string | null; completed_at: string | null;
  estimated_hours: number | null; complexity: number | null;
}
export interface UnplannedRec {
  id: string; user_id: string; occurred_at: string; hours_spent: number; is_urgent: boolean;
  work_status: 'completed' | 'in_progress' | 'awaiting_action'; review_status: string;
}
export interface TimeLogRec { task_id: string; user_id: string; hours: number; logged_on: string; }
export interface BlockerRec { task_id: string; reported_at: string; resolved_at: string | null; is_external: boolean; }

export interface Metrics {
  plannedCommitted: number;
  plannedCompleted: number;
  commitmentCompletionRate: number | null;
  originalDeadlineAdherence: number | null;   // completed on/before ORIGINAL deadline
  revisedDeadlineAdherence: number | null;    // completed on/before CURRENT (possibly extended) deadline
  extendedTasks: number;
  avgDeliveryDelayDays: number | null;        // vs original deadline, late tasks only
  lateTasksWithExternalBlocker: number;
  plannedHours: number;
  unplannedHours: number;
  totalRecordedHours: number;
  unplannedCompleted: number;
  unplannedEntries: number;
  urgentInterruptions: number;
  blockedHours: number;
  externalBlockedHours: number;
  completedComplexityPoints: number;          // sum of complexity (default 2) of completed planned tasks
  completedEstimatedHours: number;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const rate = (num: number, den: number) => (den === 0 ? null : round(num / den, 3));
const inWindow = (iso: string | null, from: string, to: string) => !!iso && iso >= from && iso <= to;

/**
 * Contextual (non-judgemental) metrics for a set of tasks/entries inside [from, to] (ISO timestamps).
 * - Rejected unplanned entries are excluded; everything else counts as legitimate recorded work.
 * - Unplanned work is NEVER added to planned commitments.
 * - An extension is not allowed to hide lateness: originalDeadlineAdherence is reported next to the revised figure.
 */
export function computeMetrics(input: {
  tasks: TaskRec[]; unplanned: UnplannedRec[]; timeLogs: TimeLogRec[]; blockers: BlockerRec[];
  from: string; to: string; now?: string;
}): Metrics {
  const { from, to } = input;
  const now = input.now ?? new Date().toISOString();
  // committed = approved during the window OR deadline falls in the window and already committed
  const committed = input.tasks.filter((t) =>
    t.approved_at && (inWindow(t.approved_at, from, to) || inWindow(t.original_deadline, from, to)));
  const completed = committed.filter((t) => t.status === 'completed' && t.completed_at && t.completed_at <= to);

  const onTimeOriginal = completed.filter((t) => t.original_deadline && t.completed_at! <= t.original_deadline);
  const onTimeRevised = completed.filter((t) => t.current_deadline && t.completed_at! <= t.current_deadline);
  const withDeadline = completed.filter((t) => t.original_deadline);
  const late = withDeadline.filter((t) => t.completed_at! > t.original_deadline!);
  const delays = late.map((t) => daysBetween(t.original_deadline!, t.completed_at!));

  const blockersByTask = new Map<string, BlockerRec[]>();
  for (const b of input.blockers) blockersByTask.set(b.task_id, [...(blockersByTask.get(b.task_id) ?? []), b]);

  const taskIds = new Set(input.tasks.map((t) => t.id));
  const plannedHours = input.timeLogs
    .filter((l) => taskIds.has(l.task_id) && l.logged_on >= from.slice(0, 10) && l.logged_on <= to.slice(0, 10))
    .reduce((s, l) => s + l.hours, 0);

  const unplanned = input.unplanned.filter((u) => u.review_status !== 'rejected' && inWindow(u.occurred_at, from, to));
  const unplannedHours = unplanned.reduce((s, u) => s + u.hours_spent, 0);

  const blockedOf = (bs: BlockerRec[], external?: boolean) => bs
    .filter((b) => external === undefined || b.is_external === external)
    .reduce((s, b) => {
      const start = b.reported_at < from ? from : b.reported_at;
      const end = Math.min(new Date(b.resolved_at ?? now).getTime(), new Date(to).getTime());
      return s + Math.max(0, (end - new Date(start).getTime()) / 3_600_000);
    }, 0);
  const relevantBlockers = input.blockers.filter((b) => taskIds.has(b.task_id));

  return {
    plannedCommitted: committed.length,
    plannedCompleted: completed.length,
    commitmentCompletionRate: rate(completed.length, committed.length),
    originalDeadlineAdherence: rate(onTimeOriginal.length, withDeadline.length),
    revisedDeadlineAdherence: rate(onTimeRevised.length, completed.filter((t) => t.current_deadline).length),
    extendedTasks: completed.filter((t) => t.current_deadline && t.original_deadline && t.current_deadline > t.original_deadline).length,
    avgDeliveryDelayDays: delays.length ? round(delays.reduce((a, b) => a + b, 0) / delays.length, 2) : null,
    lateTasksWithExternalBlocker: late.filter((t) => (blockersByTask.get(t.id) ?? []).some((b) => b.is_external)).length,
    plannedHours: round(plannedHours),
    unplannedHours: round(unplannedHours),
    totalRecordedHours: round(plannedHours + unplannedHours),
    unplannedCompleted: unplanned.filter((u) => u.work_status === 'completed').length,
    unplannedEntries: unplanned.length,
    urgentInterruptions: unplanned.filter((u) => u.is_urgent).length,
    blockedHours: round(blockedOf(relevantBlockers)),
    externalBlockedHours: round(blockedOf(relevantBlockers, true)),
    completedComplexityPoints: completed.reduce((s, t) => s + (t.complexity ?? 2), 0),
    completedEstimatedHours: round(completed.reduce((s, t) => s + (t.estimated_hours ?? 0), 0)),
  };
}

export interface WorkloadRow { user_id: string; openTasks: number; openEstimatedHours: number; remainingHours: number; capacityHours: number; utilisation: number | null; }

/** Open workload per person versus available working hours until the horizon. Remaining = estimate × (1 - progress). */
export function computeWorkload(input: {
  tasks: Array<TaskRec & { progress: number }>; userIds: string[]; capacityHoursPerUser: number;
}): WorkloadRow[] {
  return input.userIds.map((uid) => {
    const open = input.tasks.filter((t) => ['approved', 'in_progress', 'blocked', 'under_review'].includes(t.status) && t.assignee_ids.includes(uid));
    const est = open.reduce((s, t) => s + (t.estimated_hours ?? 0) / Math.max(1, t.assignee_ids.length), 0);
    const rem = open.reduce((s, t) => s + ((t.estimated_hours ?? 0) * (1 - t.progress / 100)) / Math.max(1, t.assignee_ids.length), 0);
    return { user_id: uid, openTasks: open.length, openEstimatedHours: round(est), remainingHours: round(rem),
      capacityHours: input.capacityHoursPerUser, utilisation: input.capacityHoursPerUser ? round(rem / input.capacityHoursPerUser, 2) : null };
  });
}

/** Company history for AI: ratio of actual hours to estimated hours on completed tasks. Never fabricated. */
export function estimationHistory(tasks: TaskRec[], timeLogs: TimeLogRec[]) {
  const byTask = new Map<string, number>();
  for (const l of timeLogs) byTask.set(l.task_id, (byTask.get(l.task_id) ?? 0) + l.hours);
  const samples = tasks.filter((t) => t.status === 'completed' && t.estimated_hours && byTask.get(t.id));
  const ratios = samples.map((t) => byTask.get(t.id)! / t.estimated_hours!);
  return {
    sampleSize: samples.length,
    avgActualToEstimate: ratios.length ? round(ratios.reduce((a, b) => a + b, 0) / ratios.length, 2) : null,
  };
}

export { hoursBetween };
