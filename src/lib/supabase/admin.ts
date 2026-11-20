import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client: bypasses RLS. Use ONLY for system work that users must not be able to do themselves
 * (notifications, email logs, AI result storage, cron, rate limiting). Always scope queries by company_id manually.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
