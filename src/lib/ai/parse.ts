import type { EstimateResult, ExtensionResult } from './types';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown, max = 2000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter((x): x is string => !!x).slice(0, 10) : []);

/** Extract the first JSON object from a model reply (tolerates ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI response contained no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

export function parseEstimate(raw: unknown, historySampleSize: number): Omit<EstimateResult, 'source'> {
  const o = raw as Record<string, unknown>;
  const min = num(o?.recommended_min_hours), max = num(o?.recommended_max_hours);
  const verdict = o?.verdict;
  const explanation = str(o?.explanation);
  if (min === null || max === null || min > max) throw new Error('AI estimate: invalid hour range');
  if (!['reasonable', 'too_low', 'too_high', 'insufficient_info'].includes(String(verdict))) throw new Error('AI estimate: invalid verdict');
  if (!explanation) throw new Error('AI estimate: missing explanation');
  return {
    recommendedMinHours: min, recommendedMaxHours: max, verdict: verdict as EstimateResult['verdict'], explanation,
    missingInformation: strs(o?.missing_information),
    // The model cannot claim history the system did not supply.
    usedCompanyHistory: historySampleSize >= 3 && o?.used_company_history === true,
  };
}

export function parseExtension(raw: unknown, hasHistory: boolean): Omit<ExtensionResult, 'source'> {
  const o = raw as Record<string, unknown>;
  const verdict = o?.verdict, rec = str(o?.recommendation);
  if (!['reasonable', 'questionable', 'insufficient_info'].includes(String(verdict))) throw new Error('AI extension: invalid verdict');
  if (!rec) throw new Error('AI extension: missing recommendation');
  return { verdict: verdict as ExtensionResult['verdict'], recommendation: rec, factors: strs(o?.factors),
    usedCompanyHistory: hasHistory && o?.used_company_history === true };
}
