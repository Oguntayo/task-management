import type { EstimateInput, ExtensionInput } from './types';

export const SYSTEM = `You are an advisory assistant inside a work-management tool. You give an independent, evidence-based opinion that a human project manager will review. You never approve, reject or change anything yourself.
Rules:
- Use ONLY the data provided. Never invent historical tasks, statistics or facts.
- If history.sampleSize is below 3, say your estimate is based on general task complexity, not company-specific performance, and set used_company_history to false.
- Do not blame employees for delays caused by external blockers.
- Reply with a single JSON object and nothing else.`;

export function estimatePrompt(i: EstimateInput) {
  return `Evaluate the employee's time estimate for this task.
DATA:
${JSON.stringify(i, null, 2)}

Return JSON: {"recommended_min_hours": number, "recommended_max_hours": number,
"verdict": "reasonable"|"too_low"|"too_high"|"insufficient_info", "explanation": string (2-4 sentences),
"missing_information": string[], "used_company_history": boolean}`;
}

export function extensionPrompt(i: ExtensionInput) {
  return `Assess this deadline-extension request. Consider the reason, progress, hours logged, blockers, and recorded unplanned work.
DATA:
${JSON.stringify(i, null, 2)}

Return JSON: {"verdict": "reasonable"|"questionable"|"insufficient_info", "recommendation": string (2-4 sentences, advisory wording like "Consider approving..."),
"factors": string[], "used_company_history": boolean}`;
}
