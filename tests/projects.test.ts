import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvaluation, computeProgress, initialEtaFromScope, projectedEta, addWorkingDays, type ScopeItem } from '../src/lib/domain/projects';
import { heuristicEvaluation, heuristicPlan, parseEvaluation, parsePlan } from '../src/lib/ai/projects';

const items: ScopeItem[] = [
  { id: 'kyc', title: 'KYC onboarding', description: 'document upload and identity verification', weight: 40, estimated_hours: 80, completion: 0 },
  { id: 'rails', title: 'Payout rails', description: 'bank transfer integration', weight: 60, estimated_hours: 120, completion: 0 },
];

test('progress is the weighted average of scope items', () => {
  assert.equal(computeProgress(items), 0);
  assert.equal(computeProgress([{ weight: 40, completion: 50 }, { weight: 60, completion: 10 }]), 26);
  assert.equal(computeProgress([]), 0);
});

test('an update that does not contribute changes nothing', () => {
  const r = applyEvaluation({ items, contributes: false, proposed: [{ item_id: 'kyc', new_completion: 90 }], source: 'update' });
  assert.deepEqual(r.changes, []);
  assert.equal(r.progressAfter, r.progressBefore);
});

test('progress only moves forward, ignores unknown items, caps single-update jumps', () => {
  const start = items.map((i) => ({ ...i, completion: i.id === 'kyc' ? 30 : 0 }));
  const r = applyEvaluation({ items: start, source: 'update', contributes: true,
    proposed: [{ item_id: 'kyc', new_completion: 10 }, { item_id: 'ghost', new_completion: 80 }, { item_id: 'rails', new_completion: 100 }] });
  assert.deepEqual(r.changes.map((c) => [c.item_id, c.from, c.to]), [['rails', 0, 50]]);   // kyc not lowered, ghost ignored, rails capped at +50
  assert.equal(r.progressAfter, Math.round((40 * 30 + 60 * 50) / 100));
  const done = applyEvaluation({ items: start, source: 'task_completed', contributes: true, proposed: [{ item_id: 'rails', new_completion: 100 }] });
  assert.equal(done.changes[0]!.to, 100);                                                  // completed task may finish an item
});

test('heuristic evaluation: related update contributes, unrelated does not', () => {
  const yes = heuristicEvaluation({ projectName: 'Remittance App', projectDescription: '', items, updateText: 'Finished the KYC document upload screen', hours: 8, source: 'update' });
  assert.equal(yes.contributes, true);
  assert.equal(yes.proposed[0]!.item_id, 'kyc');
  assert.equal(yes.proposed[0]!.new_completion, 10);             // 8h / 80h
  const no = heuristicEvaluation({ projectName: 'Remittance App', projectDescription: '', items, updateText: 'Attended the all-hands meeting and cleaned my desk', hours: 1, source: 'update' });
  assert.equal(no.contributes, false);
  assert.deepEqual(no.proposed, []);
});

test('AI evaluation parsing validates ids and requires reasoning', () => {
  const ids = new Set(['kyc', 'rails']);
  const ok = parseEvaluation({ contributes: true, reasoning: 'Matches KYC.', items: [{ item_id: 'kyc', new_completion: 20 }, { item_id: 'nope', new_completion: 90 }] }, ids);
  assert.deepEqual(ok.proposed, [{ item_id: 'kyc', new_completion: 20 }]);
  assert.equal(parseEvaluation({ contributes: true, reasoning: 'x', items: [] }, ids).contributes, false);  // "contributes" without any valid item is not a contribution
  assert.throws(() => parseEvaluation({ contributes: 'yes', reasoning: 'x' }, ids));
  assert.throws(() => parseEvaluation({ contributes: false }, ids));
});

test('AI plan parsing normalises weights and rejects bad ETAs', () => {
  const p = parsePlan({ scope_items: [{ title: 'Alpha', weight: 1, estimated_hours: 10 }, { title: 'Beta', weight: 3, estimated_hours: 30 }], eta_date: '2027-03-01', explanation: 'ok', assumptions: ['x'] }, '2026-11-20');
  assert.deepEqual(p.items.map((i) => i.weight), [25, 75]);
  assert.throws(() => parsePlan({ scope_items: [{ title: 'Alpha', weight: 1 }], eta_date: '2026-01-01', explanation: 'ok' }, '2026-11-20'));
  assert.throws(() => parsePlan({ scope_items: [], eta_date: '2027-03-01', explanation: 'ok' }, '2026-11-20'));
});

test('ETA: initial from scope hours + capacity; null without data; projection from velocity', () => {
  assert.equal(initialEtaFromScope({ items: [{ estimated_hours: null }], teamSize: 2, hoursPerDay: 8, start: '2026-11-16' }), null);
  const e = initialEtaFromScope({ items: [{ estimated_hours: 96 }], teamSize: 2, hoursPerDay: 8, start: '2026-11-16' })!;
  assert.equal(e.workingDays, 10);                              // 96 / (2*8*0.6)
  assert.equal(e.eta, '2026-11-30');
  assert.equal(addWorkingDays('2026-11-20', 1), '2026-11-23'); // Friday -> Monday
  assert.equal(heuristicPlan({ name: 'x', description: '', startDate: '2026-11-16', teamSize: 0, hoursPerDay: 8, weekdays: [1, 2, 3, 4, 5], existingItems: [] }).eta, null);
  assert.equal(projectedEta({ start: '2026-11-16', today: '2026-11-17', progress: 20 }).eta, null);   // too early to project
  const p = projectedEta({ start: '2026-11-16', today: '2026-11-20', progress: 20 });                 // 4 working days elapsed -> 5%/day
  assert.equal(p.eta, '2026-12-14' /* 16 more working days at 5%/day */);
});
