import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/primitives';
import { NotificationPrefsForm } from '@/components/settings/notification-prefs-form';

export const metadata = { title: 'Notification settings' };
export default async function Page() {
  const ctx = await getCtx(); const sb = await createClient();
  const { data: rows } = await sb.from('notification_preferences').select('type, email_enabled, in_app_enabled').eq('user_id', ctx.userId).eq('company_id', ctx.companyId);
  const initial = Object.fromEntries((rows ?? []).map((r) => [r.type, { email: r.email_enabled, inApp: r.in_app_enabled }]));
  return (<>
    <PageHeader title="Notifications" description="Choose how you want to hear about each kind of event. This only affects you." />
    <NotificationPrefsForm initial={initial} />
  </>);
}
