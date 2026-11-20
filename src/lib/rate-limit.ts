import type { SupabaseClient } from '@supabase/supabase-js';

/** DB-backed fixed-window limiter (works on serverless; consume_rate_limit is service-role only). Fails open on infra error but logs. */
export async function rateLimit(admin: SupabaseClient, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc('consume_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) { console.error('[rate-limit]', error.message); return true; }
  return data === true;
}

export const LIMITS = {
  auth: { limit: 10, window: 60 },
  invite: { limit: 20, window: 3600 },
  ai: { limit: 20, window: 60 },
  upload: { limit: 30, window: 60 },
} as const;
