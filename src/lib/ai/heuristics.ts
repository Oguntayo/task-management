import type { EstimateInput, EstimateResult, ExtensionInput, ExtensionResult } from './types';

/** Deterministic, clearly-labelled fallback used when no AI provider is configured or the call fails. */
export function heuristicEstimate(i: EstimateInput): EstimateResult {
  const missing: string[] = [];
  if (i.description.trim().length < 40) missing.push('A more detailed description of the scope');
  if (!i.expectedDeliverable) missing.push('The expected deliverable');
  if (i.employeeEstimateHours == null) missing.push('Your own time estimate');
  const base = i.employeeEstimateHours ?? 0;
  const usable = i.history.sampleSize >= 3 && i.history.avgActualToEstimate;
  const factor = usable ? i.history.avgActualToEstimate! : 1;
  const mid = base * factor;
  const contingency = i.dependencies.length ? 0.25 : 0.15;
  const min = Math.round(mid * (1 - contingency) * 10) / 10, max = Math.round(mid * (1 + contingency + 0.1) * 10) / 10;
  let verdict: EstimateResult['verdict'] = 'reasonable';
  if (base === 0 || missing.length >= 2) verdict = 'insufficient_info';
  const basis = usable
    ? `Adjusted using ${i.history.sampleSize} completed tasks in your company (actual time averaged ${i.history.avgActualToEstimate}× the estimate).`
    : 'There is not enough company-specific history yet, so this is based on the stated scope only, not on your company\'s past performance.';
  return {
    recommendedMinHours: min, recommendedMaxHours: max, verdict, missingInformation: missing, usedCompanyHistory: !!usable,
    explanation: `Rule-based check (no AI provider answered). ${basis} Dependencies: ${i.dependencies.length}.`, source: 'heuristic',
  };
}

/** Reasonable if documented interruptions/blockers plausibly account for the requested extra time. */
export function heuristicExtension(i: ExtensionInput): ExtensionResult {
  const factors: string[] = [];
  const extraHours = i.workingDaysRequested * i.workingHoursPerDay;
  const unplanned = i.unplannedWorkDuringPeriod.reduce((s, u) => s + u.hours, 0);
  const external = i.openBlockers.filter((b) => b.external).length;
  if (unplanned > 0) factors.push(`${unplanned}h of recorded unplanned work during the period (${i.unplannedWorkDuringPeriod.length} entries).`);
  if (i.openBlockers.length) factors.push(`${i.openBlockers.length} open blocker(s), ${external} external.`);
  factors.push(`Progress is ${i.progress}%; ${i.actualHours}h logged${i.estimatedHours ? ` against ${i.estimatedHours}h estimated` : ''}.`);
  if (i.previousExtensions > 0) factors.push(`This task already had ${i.previousExtensions} approved extension(s).`);
  const remaining = i.estimatedHours ? i.estimatedHours * (1 - i.progress / 100) : null;
  const explained = unplanned + (external ? extraHours : 0);
  let verdict: ExtensionResult['verdict'];
  let recommendation: string;
  if (explained >= extraHours * 0.5) {
    verdict = 'reasonable';
    recommendation = `The request looks reasonable: documented interruptions or external blockers account for much of the ${extraHours}h requested. Consider approving.`;
  } else if (remaining !== null && remaining > extraHours * 1.5 && i.previousExtensions > 0) {
    verdict = 'questionable';
    recommendation = 'The remaining work appears larger than the extra time requested, and this is not the first extension. Consider asking for a revised plan.';
  } else if (remaining === null && unplanned === 0 && !i.openBlockers.length) {
    verdict = 'insufficient_info';
    recommendation = 'There is not enough recorded information (no estimate, interruptions or blockers) to assess this request. Consider asking for clarification.';
  } else {
    verdict = 'questionable';
    recommendation = 'Recorded interruptions and blockers explain only a small part of the extra time. Consider asking the employee to clarify.';
  }
  return { verdict, recommendation, factors, usedCompanyHistory: false, source: 'heuristic' };
}
