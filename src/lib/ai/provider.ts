import { extractJson } from './parse';

export interface AiConfig { provider: string; apiKey: string; model: string; baseUrl?: string; }

export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const provider = env.AI_PROVIDER, apiKey = env.AI_API_KEY, model = env.AI_MODEL;
  if (!provider || !apiKey || !model) return null;
  return { provider, apiKey, model, baseUrl: env.AI_BASE_URL };
}

/** Provider-agnostic JSON completion. Add a case here to support another vendor. */
export async function completeJson(cfg: AiConfig, system: string, user: string, signal?: AbortSignal): Promise<unknown> {
  if (cfg.provider === 'anthropic') {
    const res = await fetch(`${cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1024, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}`);
    const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
    return extractJson(data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') ?? '');
  }
  if (cfg.provider === 'openai' || cfg.provider === 'openai_compatible') {
    const base = cfg.baseUrl ?? 'https://api.openai.com/v1';
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return extractJson(data.choices?.[0]?.message?.content ?? '');
  }
  throw new Error(`Unsupported AI_PROVIDER "${cfg.provider}"`);
}
