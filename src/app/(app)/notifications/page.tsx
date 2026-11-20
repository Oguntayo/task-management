import Link from 'next/link';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/data';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { markAllRead, markRead } from '@/actions/notifications';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Notifications' };
export default async function Page() {
  const ctx = await getCtx(); const sb = await createClient();
  const { data } = await sb.from('notifications').select('id, title, body, link, read_at, created_at').eq('user_id', ctx.userId).eq('company_id', ctx.companyId).order('created_at', { ascending: false }).limit(100);
  return (<><PageHeader title="Notifications" actions={<form action={markAllRead}><button className="text-xs text-muted hover:text-fg">Mark all read</button></form>} />
    <Card>{!data?.length ? <EmptyState title="You're all caught up" /> : <ul className="divide-y">{data.map((n) => (
      <li key={n.id}><form action={markRead.bind(null, n.id)}><button className={cn('block w-full px-4 py-3 text-left hover:bg-surface-2/60', !n.read_at && 'bg-accent-soft/40')} formAction={async () => { 'use server'; await markRead(n.id); }}>
        <p className="text-[13px] font-medium">{n.title}</p><p className="text-xs text-muted">{n.body}</p><p className="mt-0.5 flex gap-3 text-[11px] text-subtle">{fmtDate(n.created_at, ctx.tz, true)}{n.link && <Link href={n.link} className="text-accent hover:underline">Open</Link>}</p></button></form></li>))}</ul>}</Card></>);
}
