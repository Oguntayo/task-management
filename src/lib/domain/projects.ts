import { addDays, isoWeekday, workingDays } from './dates';

export interface ScopeItem { id: string; title: string; description?: string | null; weight: number; estimated_hours: number | null; completion: number; }
export interface ItemChange { item_id: string; title: string; from: number; to: number; }

export function computeProgress(items: Pick<ScopeItem, 'weight' | 'completion'>[]): number {
  const w = items.reduce((s, i) => s + i.weight, 0);
  return w === 0 ? 0 : Math.round(items.reduce((s, i) => s + i.weight * i.completion, 0) / w);
}

/** Largest single-update jump for one item, unless the update is a completed task. Stops one vague message from "finishing" an item. */
export const MAX_ITEM_JUMP = 50;

/**
 * Turns an AI judgement into safe changes. Rules:
 * - not contributing / no changes => nothing happens (no change entries);
 * - unknown item ids are ignored; progress never goes backwards (only admins can lower it, manually);
 * - one update can lift an item by at most MAX_ITEM_JUMP points (unless it records a completed task).
 */
export function applyEvaluation(a: {
  items: ScopeItem[]; contributes: boolean; proposed: Array<{ item_id: string; new_completion: number }>;
  source: 'update' | 'task_progress' | 'task_completed' | 'unplanned';
}): { changes: ItemChange[]; progressBefore: number; progressAfter: number } {
  const before = computeProgress(a.items);
  if (!a.contributes) return { changes: [], progressBefore: before, progressAfter: before };
  const byId = new Map(a.items.map((i) => [i.id, i]));
  const changes: ItemChange[] = [];
  const seen = new Set<string>();
  for (const p of a.proposed) {
    const item = byId.get(p.item_id);
    if (!item || seen.has(p.item_id) || !Number.isFinite(p.new_completion)) continue;
    seen.add(p.item_id);
    let to = Math.min(100, Math.max(0, Math.round(p.new_completion)));
    if (a.source !== 'task_completed') to = Math.min(to, item.completion + MAX_ITEM_JUMP);
    if (to > item.completion) changes.push({ item_id: item.id, title: item.title, from: item.completion, to });
  }
  const next = a.items.map((i) => ({ ...i, completion: changes.find((c) => c.item_id === i.id)?.to ?? i.completion }));
  return { changes, progressBefore: before, progressAfter: computeProgress(next) };
}

export function addWorkingDays(from: string, n: number, weekdays: number[] = [1, 2, 3, 4, 5]): string {
  let d = from, left = n;
  while (left > 0) { d = addDays(d, 1); if (weekdays.includes(isoWeekday(d))) left--; }
  return d;
}

/** Initial ETA from scope hours and team capacity. Returns null when there is not enough information. */
export function initialEtaFromScope(a: {
  items: Array<{ estimated_hours: number | null }>; teamSize: number; hoursPerDay: number; start: string; weekdays?: number[]; focusFactor?: number;
}): { eta: string; workingDays: number } | null {
  const hours = a.items.reduce((s, i) => s + (i.estimated_hours ?? 0), 0);
  if (hours <= 0 || a.teamSize <= 0) return null;
  const perDay = a.teamSize * a.hoursPerDay * (a.focusFactor ?? 0.6); // 60%: meetings, support, unplanned work
  const days = Math.max(1, Math.ceil(hours / perDay));
  return { eta: addWorkingDays(a.start, days, a.weekdays), workingDays: days };
}

/** Projection from observed velocity. Needs enough history to be meaningful; otherwise says so instead of guessing. */
export function projectedEta(a: { start: string; today: string; progress: number; weekdays?: number[] }):
  { eta: string | null; note: string } {
  const elapsed = Math.max(0, workingDays(a.start, a.today, a.weekdays) - 1);
  if (a.progress >= 100) return { eta: a.today, note: 'Complete.' };
  if (elapsed < 3 || a.progress < 5) return { eta: null, note: 'Not enough progress data yet for a velocity-based projection (needs at least 3 working days and 5% progress).' };
  const perDay = a.progress / elapsed;
  const remainingDays = Math.ceil((100 - a.progress) / perDay);
  return { eta: addWorkingDays(a.today, remainingDays, a.weekdays),
    note: `At the current pace (${perDay.toFixed(1)}% per working day over ${elapsed} days), about ${remainingDays} working days remain.` };
}
