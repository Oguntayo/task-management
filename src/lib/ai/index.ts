import { heuristicEstimate, heuristicExtension } from './heuristics';
import { parseEstimate, parseExtension } from './parse';
import { estimatePrompt, extensionPrompt, SYSTEM } from './prompts';
import { aiConfigFromEnv, completeJson } from './provider';
import type { EstimateInput, EstimateResult, ExtensionInput, ExtensionResult } from './types';

/** AI output is advisory only. Failures degrade to the labelled heuristic; they never block the workflow. */
export async function evaluateEstimate(i: EstimateInput): Promise<EstimateResult> {
  const cfg = aiConfigFromEnv();
  if (!cfg) return heuristicEstimate(i);
  try {
    const raw = await completeJson(cfg, SYSTEM, estimatePrompt(i), AbortSignal.timeout(25_000));
    return { ...parseEstimate(raw, i.history.sampleSize), source: 'ai', provider: cfg.provider, model: cfg.model };
  } catch (e) {
    console.error('[ai] estimate failed, using heuristic:', (e as Error).message);
    return heuristicEstimate(i);
  }
}

export async function evaluateExtension(i: ExtensionInput): Promise<ExtensionResult> {
  const cfg = aiConfigFromEnv();
  if (!cfg) return heuristicExtension(i);
  try {
    const raw = await completeJson(cfg, SYSTEM, extensionPrompt(i), AbortSignal.timeout(25_000));
    return { ...parseExtension(raw, false), source: 'ai', provider: cfg.provider, model: cfg.model };
  } catch (e) {
    console.error('[ai] extension failed, using heuristic:', (e as Error).message);
    return heuristicExtension(i);
  }
}
export type { EstimateInput, EstimateResult, ExtensionInput, ExtensionResult };
