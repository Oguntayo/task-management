import { addDays, inRange, toLocalDate, weekEnd, weekStart } from './dates';
import type { TaskStatus } from './task-state';

export interface SumTask {
  id: string; title: string; status: TaskStatus; progress: number; priority: string;
  original_deadline: string | null; current_deadline: string | null;
  approved_at: string | null; completed_at: string | null; period_start: string | null;
}
export interface SumEvent { task_id: string | null; unplanned_entry_id: string | null; event: string; created_at: string; details: Record<string, unknown>; }
export interface SumUnplanned { id: string; title: string; occurred_at: string; hours_spent: number; work_status: string; review_status: string; is_urgent: boolean; }
export interface SumBlocker { id: string; task_id: string; description: string; status: 'open' | 'resolved'; is_external: boolean; reported_at: string; resolved_at: string | null; }
export interface SumTimeLog { task_id: string; hours: number; logged_on: string; }

export interface DailySummary {
  date: string;
  completed: Array<{ id: string; title: string }>;
  workedOn: Array<{ id: string; title: string; progress: number; hours: number }>;
  currentlyWorkingOn: Array<{ id: string; title: string; progress: number }>;
  blocked: Array<{ id: string; title: string; blockers: string[]; external: boolean }>;
  unexpected: Array<{ id: string; title: string; hours: number; status: string }>;
  nextUp: Array<{ id: string; title: string; deadline: string | null }>;
}

/**
 * Built purely from task records + the immutable activity log, so a task can only appear as
 * "completed" on the single day its completed_at falls on; afterwards it is history, not news.
 */
export function buildDailySummary(a: {
  date: string; tz: string; tasks: SumTask[]; events: SumEvent[]; unplanned: SumUnplanned[];
  blockers: SumBlocker[]; timeLogs: SumTimeLog[];
}): DailySummary {
  const day = (iso: string) => toLocalDate(iso, a.tz);
  const completedToday = a.tasks.filter((t) => t.status === 'completed' && t.completed_at && day(t.completed_at) === a.date);
  const completedIds = new Set(completedToday.map((t) => t.id));

  const touched = new Set<string>();
  for (const e of a.events) {
    if (e.task_id && day(e.created_at) === a.date && ['progress_updated', 'status_changed', 'blocker_reported', 'blocker_resolved'].includes(e.event)) touched.add(e.task_id);
  }
  for (const l of a.timeLogs) if (l.logged_on === a.date) touched.add(l.task_id);

  const hoursToday = (id: string) => a.timeLogs.filter((l) => l.task_id === id && l.logged_on === a.date).reduce((s, l) => s + l.hours, 0);
  const byId = new Map(a.tasks.map((t) => [t.id, t]));
  const openBlockers = a.blockers.filter((b) => b.status === 'open');

  return {
    date: a.date,
    completed: completedToday.map((t) => ({ id: t.id, title: t.title })),
    workedOn: [...touched].filter((id) => !completedIds.has(id) && byId.has(id)).map((id) => {
      const t = byId.get(id)!; return { id, title: t.title, progress: t.progress, hours: hoursToday(id) };
    }),
    currentlyWorkingOn: a.tasks.filter((t) => t.status === 'in_progress').map((t) => ({ id: t.id, title: t.title, progress: t.progress })),
    blocked: a.tasks.filter((t) => t.status === 'blocked').map((t) => {
      const bs = openBlockers.filter((b) => b.task_id === t.id);
      return { id: t.id, title: t.title, blockers: bs.map((b) => b.description), external: bs.some((b) => b.is_external) };
    }),
    unexpected: a.unplanned.filter((u) => day(u.occurred_at) === a.date && u.review_status !== 'rejected')
      .map((u) => ({ id: u.id, title: u.title, hours: u.hours_spent, status: u.work_status })),
    nextUp: a.tasks.filter((t) => ['approved', 'in_progress'].includes(t.status))
      .sort((x, y) => (x.current_deadline ?? '9999').localeCompare(y.current_deadline ?? '9999')).slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title, deadline: t.current_deadline })),
  };
}

export interface WeeklySummary {
  weekStart: string; weekEnd: string;
  committed: Array<{ id: string; title: string }>;
  completed: Array<{ id: string; title: string; onTimeVsOriginal: boolean | null }>;
  ongoing: Array<{ id: string; title: string; progress: number }>;
  unplanned: { entries: number; hours: number; urgent: number; items: Array<{ id: string; title: string; hours: number }> };
  overdue: Array<{ id: string; title: string; deadline: string }>;
  blockers: Array<{ id: string; description: string; status: string; external: boolean }>;
  deadlineChanges: Array<{ task_id: string; title: string; from: string | null; to: string | null }>;
  nextWeekPriorities: Array<{ id: string; title: string; deadline: string | null }>;
}

export function buildWeeklySummary(a: {
  date: string; tz: string; now: string; tasks: SumTask[]; events: SumEvent[]; unplanned: SumUnplanned[]; blockers: SumBlocker[];
}): WeeklySummary {
  const ws = weekStart(a.date), we = weekEnd(a.date);
  const day = (iso: string) => toLocalDate(iso, a.tz);
  const inWeek = (iso: string | null) => !!iso && inRange(day(iso), ws, we);
  const byId = new Map(a.tasks.map((t) => [t.id, t]));
  const nextWs = addDays(ws, 7), nextWe = addDays(we, 7);

  const committed = a.tasks.filter((t) => t.approved_at && (inWeek(t.approved_at) || inWeek(t.original_deadline) || inWeek(t.period_start)));
  const completed = a.tasks.filter((t) => t.status === 'completed' && inWeek(t.completed_at));
  const unp = a.unplanned.filter((u) => inWeek(u.occurred_at) && u.review_status !== 'rejected');

  return {
    weekStart: ws, weekEnd: we,
    committed: committed.map((t) => ({ id: t.id, title: t.title })),
    completed: completed.map((t) => ({ id: t.id, title: t.title,
      onTimeVsOriginal: t.original_deadline ? t.completed_at! <= t.original_deadline : null })),
    ongoing: a.tasks.filter((t) => ['in_progress', 'under_review', 'blocked'].includes(t.status)).map((t) => ({ id: t.id, title: t.title, progress: t.progress })),
    unplanned: { entries: unp.length, hours: unp.reduce((s, u) => s + u.hours_spent, 0), urgent: unp.filter((u) => u.is_urgent).length,
      items: unp.map((u) => ({ id: u.id, title: u.title, hours: u.hours_spent })) },
    overdue: a.tasks.filter((t) => ['approved', 'in_progress', 'blocked', 'under_review'].includes(t.status) && t.current_deadline && t.current_deadline < a.now)
      .map((t) => ({ id: t.id, title: t.title, deadline: t.current_deadline! })),
    blockers: a.blockers.filter((b) => b.status === 'open' || inWeek(b.reported_at) || inWeek(b.resolved_at))
      .map((b) => ({ id: b.id, description: b.description, status: b.status, external: b.is_external })),
    deadlineChanges: a.events.filter((e) => e.event === 'deadline_changed' && inWeek(e.created_at) && e.task_id).map((e) => ({
      task_id: e.task_id!, title: byId.get(e.task_id!)?.title ?? 'Task',
      from: (e.details.from as string) ?? null, to: (e.details.to as string) ?? null })),
    nextWeekPriorities: a.tasks.filter((t) => ['approved', 'in_progress'].includes(t.status)
        && (t.current_deadline ? day(t.current_deadline) <= nextWe : true)).slice(0, 8)
      .map((t) => ({ id: t.id, title: t.title, deadline: t.current_deadline })),
  };
}
void addDays;
