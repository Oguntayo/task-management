import { extractJson } from './parse';
import { completeJson, aiConfigFromEnv } from './provider';
import { SYSTEM } from './prompts';
import { initialEtaFromScope, type ScopeItem } from '../domain/projects';

// ---------- scope plan + ETA at project creation ----------
export interface PlanInput { name: string; description: string; startDate: string; teamSize: number; hoursPerDay: number; weekdays: number[]; existingItems: Array<{ title: string; estimated_hours: number | null }>; }
export interface PlanResult {
  items: Array<{ title: string; description?: string; weight: number; estimated_hours: number | null }>;
  eta: string | null; explanation: string; assumptions: string[]; source: 'ai' | 'heuristic'; provider?: string; model?: string;
}
const isIso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function parsePlan(raw: unknown, startDate: string): Omit<PlanResult, 'source'> {
  const o = raw as Record<string, any>;
  const arr = Array.isArray(o?.scope_items) ? o.scope_items : [];
  const items = arr.slice(0, 20).map((i: any) => ({
    title: String(i?.title ?? '').trim().slice(0, 200), description: i?.description ? String(i.description).slice(0, 500) : undefined,
    weight: Number(i?.weight), estimated_hours: Number.isFinite(Number(i?.estimated_hours)) && Number(i.estimated_hours) > 0 ? Number(i.estimated_hours) : null,
  })).filter((i: any) => i.title.length >= 2 && Number.isFinite(i.weight) && i.weight > 0);
  if (items.length < 1) throw new Error('AI plan: no scope items');
  const total = items.reduce((s: number, i: any) => s + i.weight, 0);
  const normalised = items.map((i: any) => ({ ...i, weight: Math.max(1, Math.round((i.weight / total) * 100)) }));
  if (!isIso(o?.eta_date) || o.eta_date < startDate) throw new Error('AI plan: invalid ETA');
  const explanation = typeof o?.explanation === 'string' && o.explanation.trim() ? o.explanation.trim().slice(0, 2000) : null;
  if (!explanation) throw new Error('AI plan: missing explanation');
  return { items: normalised, eta: o.eta_date, explanation, assumptions: (Array.isArray(o.assumptions) ? o.assumptions : []).map((a: unknown) => String(a).slice(0, 300)).slice(0, 8) };
}

export function heuristicPlan(i: PlanInput): PlanResult {
  const items = i.existingItems.length
    ? i.existingItems.map((x) => ({ title: x.title, weight: Math.round(100 / i.existingItems.length), estimated_hours: x.estimated_hours }))
    : [{ title: 'Deliver the product', weight: 100, estimated_hours: null }];
  const eta = initialEtaFromScope({ items, teamSize: i.teamSize, hoursPerDay: i.hoursPerDay, start: i.startDate, weekdays: i.weekdays });
  return { items, eta: eta?.eta ?? null, source: 'heuristic',
    explanation: eta ? `Rule-based estimate (no AI provider answered): ${eta.workingDays} working days based on the entered hour estimates and ${i.teamSize} assigned people at 60% focus time.`
      : 'No ETA yet: add scope items with hour estimates and assign people, or configure an AI provider, and an ETA will be produced.',
    assumptions: ['Team capacity assumes 60% of working hours go to this product.'] };
}

export async function planProject(i: PlanInput): Promise<PlanResult> {
  const cfg = aiConfigFromEnv(); if (!cfg) return heuristicPlan(i);
  try {
    const prompt = `A company is starting a new product/project. Break it into scope items (the deliverables that define "done") with weights summing to 100, give each an hour estimate, and give an ETA date.
Use ONLY the information provided; state assumptions explicitly; do not claim knowledge of the company's history. If scope items were already entered, keep their titles and add estimates/weights rather than replacing them.
DATA:\n${JSON.stringify(i, null, 2)}
Return JSON: {"scope_items":[{"title":string,"description":string,"weight":number,"estimated_hours":number}],"eta_date":"YYYY-MM-DD","explanation":string,"assumptions":string[]}`;
    const raw = await completeJson(cfg, SYSTEM, prompt, AbortSignal.timeout(30_000));
    return { ...parsePlan(raw, i.startDate), source: 'ai', provider: cfg.provider, model: cfg.model };
  } catch (e) { console.error('[ai] plan failed, using heuristic:', (e as Error).message); return heuristicPlan(i); }
}

// ---------- judging a staff update ----------
export interface EvalInput { projectName: string; projectDescription: string; items: ScopeItem[]; updateText: string; hours: number | null; source: string; taskTitle?: string | null; }
export interface EvalResult { contributes: boolean; reasoning: string; proposed: Array<{ item_id: string; new_completion: number }>; source: 'ai' | 'heuristic'; provider?: string; model?: string; }

export function parseEvaluation(raw: unknown, validIds: Set<string>): Omit<EvalResult, 'source'> {
  const o = raw as Record<string, any>;
  if (typeof o?.contributes !== 'boolean') throw new Error('AI evaluation: missing contributes');
  const reasoning = typeof o.reasoning === 'string' && o.reasoning.trim() ? o.reasoning.trim().slice(0, 1000) : null;
  if (!reasoning) throw new Error('AI evaluation: missing reasoning');
  const proposed = (Array.isArray(o.items) ? o.items : [])
    .map((x: any) => ({ item_id: String(x?.item_id), new_completion: Number(x?.new_completion) }))
    .filter((x: any) => validIds.has(x.item_id) && Number.isFinite(x.new_completion));
  return { contributes: o.contributes && proposed.length > 0, reasoning, proposed };
}

const STOP = new Set('the a an and or of to in on for with from by at is are was were be been this that it as we i my our done did work worked working update fixed added made today yesterday'.split(' '));
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)));

/** Conservative keyword matcher used only when no AI provider is available. Unrelated text => no change. */
export function heuristicEvaluation(i: EvalInput): EvalResult {
  const u = tokens(`${i.updateText} ${i.taskTitle ?? ''}`);
  const scored = i.items.map((item) => {
    const t = tokens(`${item.title} ${item.description ?? ''}`);
    const hit = [...t].filter((x) => u.has(x)).length;
    return { item, score: t.size ? hit / Math.min(t.size, 4) : 0 };
  }).filter((s) => s.score >= 0.5).sort((a, b) => b.score - a.score);
  if (!scored.length) return { contributes: false, source: 'heuristic', proposed: [], reasoning: 'No scope item of this product matches the update (rule-based check; no AI provider answered).' };
  const top = scored[0]!.item;
  const bump = i.hours && top.estimated_hours ? Math.min(30, Math.round((i.hours / top.estimated_hours) * 100)) : 5;
  return { contributes: true, source: 'heuristic', reasoning: `The update appears to relate to "${top.title}" (keyword match; rule-based check). Progress advanced conservatively.`,
    proposed: [{ item_id: top.id, new_completion: Math.min(100, top.completion + Math.max(1, bump)) }] };
}

export async function evaluateUpdate(i: EvalInput): Promise<EvalResult> {
  const cfg = aiConfigFromEnv(); if (!cfg) return heuristicEvaluation(i);
  try {
    const prompt = `A staff member posted an update against the product "${i.projectName}". Decide whether the update genuinely advances any of the product's scope items.
Rules: be conservative. Chit-chat, meetings, unrelated work or vague statements do NOT contribute (contributes=false, items=[]). Only raise a completion percentage when the update gives real evidence. Never lower a completion. Use only the item ids provided.
DATA:\n${JSON.stringify({ project: i.projectName, description: i.projectDescription, update: i.updateText, hours_spent: i.hours, source: i.source, linked_task: i.taskTitle ?? null,
      scope_items: i.items.map((x) => ({ item_id: x.id, title: x.title, description: x.description, weight: x.weight, estimated_hours: x.estimated_hours, current_completion: x.completion })) }, null, 2)}
Return JSON: {"contributes":boolean,"reasoning":string (1-2 sentences),"items":[{"item_id":string,"new_completion":number 0-100}]}`;
    const raw = await completeJson(cfg, SYSTEM, prompt, AbortSignal.timeout(25_000));
    return { ...parseEvaluation(raw, new Set(i.items.map((x) => x.id))), source: 'ai', provider: cfg.provider, model: cfg.model };
  } catch (e) { console.error('[ai] evaluation failed, using heuristic:', (e as Error).message); return heuristicEvaluation(i); }
}
export { extractJson };
