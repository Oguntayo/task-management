import test from 'node:test';
import assert from 'node:assert/strict';
import { can, navFor, dashboardsFor, isManager } from '../src/lib/domain/permissions';
import { canTransition, userTransitions } from '../src/lib/domain/task-state';
import { computeMetrics, computeWorkload, estimationHistory, type TaskRec } from '../src/lib/domain/analytics';
import { buildDailySummary, buildWeeklySummary } from '../src/lib/domain/summaries';
import { weekStart, workingDays, toLocalDate } from '../src/lib/domain/dates';

test('permissions: roles are additive and nav hides inaccessible links', () => {
  assert.equal(can(['employee'], 'tasks.approve'), false);
  assert.equal(can(['employee', 'pm'], 'tasks.approve'), true);
  const emp = navFor(['employee']).map((i) => i.href);
  assert.ok(!emp.includes('/approvals') && !emp.includes('/analytics') && !emp.includes('/settings/people'));
  const pm = navFor(['pm', 'employee']).map((i) => i.href);
  assert.ok(pm.includes('/approvals') && pm.includes('/team') && !pm.includes('/settings/company'));
  assert.deepEqual(dashboardsFor(['pm', 'employee']), ['employee', 'pm']);
  assert.ok(isManager(['admin']));
});

test('state machine mirrors the DB rules', () => {
  assert.ok(canTransition('approved', 'in_progress'));
  assert.ok(!canTransition('draft', 'completed'));
  assert.ok(!canTransition('cancelled', 'draft'));
  const base = { isManager: false, isLeader: false, isCreator: true, hasOpenBlockers: false, requireCompletionReview: false };
  assert.ok(!userTransitions('pending_approval', base).includes('approved'));
  assert.ok(!userTransitions('in_progress', base).includes('blocked'));
  assert.deepEqual(userTransitions('completed', base), []);
  assert.deepEqual(userTransitions('blocked', { ...base, hasOpenBlockers: true }), []);
  assert.ok(!userTransitions('in_progress', { ...base, requireCompletionReview: true }).includes('completed'));
  assert.ok(userTransitions('in_progress', { ...base, requireCompletionReview: true }).includes('under_review'));
});

test('dates', () => {
  assert.equal(weekStart('2026-11-19'), '2026-11-16'); // Thursday -> Monday
  assert.equal(workingDays('2026-11-16', '2026-11-22'), 5);
  assert.equal(toLocalDate('2026-11-18T23:30:00Z', 'Africa/Lagos'), '2026-11-19'); // UTC+1 crosses midnight
});

const T = (o: Partial<TaskRec> & { id: string }): TaskRec => ({
  status: 'completed', department_id: null, assignee_ids: ['u1'], original_deadline: '2026-11-20T17:00:00Z',
  current_deadline: '2026-11-20T17:00:00Z', approved_at: '2026-11-16T09:00:00Z', completed_at: '2026-11-19T10:00:00Z',
  estimated_hours: 8, complexity: 3, ...o,
});
const W = { from: '2026-11-16T00:00:00Z', to: '2026-11-22T23:59:59Z', now: '2026-11-22T12:00:00Z' };

test('analytics: unplanned work is legitimate work but never a planned commitment', () => {
  const m = computeMetrics({
    tasks: [T({ id: 'a' }), T({ id: 'b', status: 'in_progress', completed_at: null })],
    unplanned: [
      { id: 'u1', user_id: 'u1', occurred_at: '2026-11-17T10:00:00Z', hours_spent: 2, is_urgent: true, work_status: 'completed', review_status: 'approved' },
      { id: 'u2', user_id: 'u1', occurred_at: '2026-11-18T10:00:00Z', hours_spent: 5, is_urgent: false, work_status: 'completed', review_status: 'rejected' },
    ],
    timeLogs: [{ task_id: 'a', user_id: 'u1', hours: 6, logged_on: '2026-11-18' }],
    blockers: [], ...W });
  assert.equal(m.plannedCommitted, 2);
  assert.equal(m.plannedCompleted, 1);
  assert.equal(m.commitmentCompletionRate, 0.5);
  assert.equal(m.unplannedHours, 2);           // rejected entry excluded
  assert.equal(m.plannedHours, 6);
  assert.equal(m.totalRecordedHours, 8);
  assert.equal(m.urgentInterruptions, 1);
  assert.equal(m.unplannedEntries, 1);
});

test('analytics: extending a deadline cannot make a late task look on time', () => {
  const late = T({ id: 'x', completed_at: '2026-11-23T10:00:00Z', current_deadline: '2026-11-24T17:00:00Z' });
  const m = computeMetrics({ tasks: [late], unplanned: [], timeLogs: [], blockers: [], ...W, to: '2026-11-30T00:00:00Z' });
  assert.equal(m.originalDeadlineAdherence, 0);
  assert.equal(m.revisedDeadlineAdherence, 1);
  assert.equal(m.extendedTasks, 1);
  assert.ok(m.avgDeliveryDelayDays! > 2);
});

test('analytics: external blockers are reported separately and flagged on late tasks', () => {
  const late = T({ id: 'x', completed_at: '2026-11-23T10:00:00Z' });
  const m = computeMetrics({ tasks: [late], unplanned: [], timeLogs: [],
    blockers: [{ task_id: 'x', reported_at: '2026-11-18T08:00:00Z', resolved_at: '2026-11-18T20:00:00Z', is_external: true }],
    from: W.from, to: '2026-11-30T00:00:00Z', now: W.now });
  assert.equal(m.externalBlockedHours, 12);
  assert.equal(m.lateTasksWithExternalBlocker, 1);
});

test('analytics: null rates when there is no data (no fabricated numbers)', () => {
  const m = computeMetrics({ tasks: [], unplanned: [], timeLogs: [], blockers: [], ...W });
  assert.equal(m.commitmentCompletionRate, null);
  assert.equal(m.originalDeadlineAdherence, null);
  assert.equal(m.avgDeliveryDelayDays, null);
  assert.deepEqual(estimationHistory([], []), { sampleSize: 0, avgActualToEstimate: null });
});

test('workload uses remaining hours', () => {
  const w = computeWorkload({ tasks: [{ ...T({ id: 'a', status: 'in_progress', estimated_hours: 10 }), progress: 50 }], userIds: ['u1', 'u2'], capacityHoursPerUser: 40 });
  assert.equal(w[0].remainingHours, 5);
  assert.equal(w[1].openTasks, 0);
});

const S = (id: string, o: object = {}) => ({ id, title: `Task ${id}`, status: 'in_progress' as const, progress: 30, priority: 'medium',
  original_deadline: '2026-11-20T17:00:00Z', current_deadline: '2026-11-20T17:00:00Z', approved_at: '2026-11-16T09:00:00Z', completed_at: null, period_start: null, ...o });

test('stand-up: a completed task is reported once, on its completion day only', () => {
  const tasks = [S('a', { status: 'completed', progress: 100, completed_at: '2026-11-17T10:00:00Z' }), S('b')];
  const events = [{ task_id: 'a', unplanned_entry_id: null, event: 'status_changed', created_at: '2026-11-17T10:00:00Z', details: {} },
                  { task_id: 'b', unplanned_entry_id: null, event: 'progress_updated', created_at: '2026-11-18T09:00:00Z', details: {} }];
  const base = { tz: 'UTC', tasks, events, unplanned: [], blockers: [], timeLogs: [] };
  assert.deepEqual(buildDailySummary({ ...base, date: '2026-11-17' }).completed.map((t) => t.id), ['a']);
  const tue = buildDailySummary({ ...base, date: '2026-11-18' });
  assert.deepEqual(tue.completed, []);                       // not re-reported
  assert.deepEqual(tue.workedOn.map((t) => t.id), ['b']);
  assert.deepEqual(tue.currentlyWorkingOn.map((t) => t.id), ['b']);
});

test('stand-up: unplanned work shows separately, blocked shows external flag', () => {
  const d = buildDailySummary({ date: '2026-11-17', tz: 'UTC', tasks: [S('b', { status: 'blocked' })], events: [],
    unplanned: [{ id: 'u', title: 'Refund', occurred_at: '2026-11-17T09:00:00Z', hours_spent: 1.5, work_status: 'completed', review_status: 'reported', is_urgent: true }],
    blockers: [{ id: 'k', task_id: 'b', description: 'PSP down', status: 'open', is_external: true, reported_at: '2026-11-17T08:00:00Z', resolved_at: null }], timeLogs: [] });
  assert.equal(d.unexpected[0].hours, 1.5);
  assert.equal(d.blocked[0].external, true);
});

test('weekly summary: commitments, on-time vs ORIGINAL deadline, deadline changes and overdue', () => {
  const w = buildWeeklySummary({ date: '2026-11-19', tz: 'UTC', now: '2026-11-21T00:00:00Z',
    tasks: [S('a', { status: 'completed', progress: 100, completed_at: '2026-11-19T10:00:00Z', current_deadline: '2026-11-26T17:00:00Z' }),
            S('b', { current_deadline: '2026-11-18T17:00:00Z' })],
    events: [{ task_id: 'a', unplanned_entry_id: null, event: 'deadline_changed', created_at: '2026-11-18T10:00:00Z', details: { from: 'x', to: 'y' } }],
    unplanned: [], blockers: [] });
  assert.equal(w.weekStart, '2026-11-16');
  assert.equal(w.committed.length, 2);
  assert.equal(w.completed[0].onTimeVsOriginal, true);
  assert.equal(w.overdue.map((t) => t.id).join(), 'b');
  assert.equal(w.deadlineChanges.length, 1);
});
