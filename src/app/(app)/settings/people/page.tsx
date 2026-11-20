import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { getMembers } from '@/lib/data';
import { can } from '@/lib/domain/permissions';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { InviteForm, MemberRow, PendingInvites } from '@/components/settings/people-panels';

export const metadata = { title: 'People' };
export default async function Page() {
  const ctx = await getCtx();
  if (!can(ctx.roles, 'members.manage')) redirect('/dashboard');
  const sb = await createClient();
  const [members, { data: deps }, { data: invites }] = await Promise.all([
    getMembers(sb, ctx.companyId),
    sb.from('departments').select('id, name').eq('company_id', ctx.companyId).order('name'),
    sb.from('invitations').select('id, email, roles, created_at').eq('company_id', ctx.companyId).eq('status', 'pending').order('created_at', { ascending: false }),
  ]);
  const departments = deps ?? [];
  return (<>
    <PageHeader title="People" description={`${members.length} active member${members.length === 1 ? '' : 's'}`} />
    <div className="space-y-5">
      <Card><CardHeader title="Invite someone" /><div className="p-4"><InviteForm departments={departments} /></div></Card>
      <Card><CardHeader title="Pending invitations" /><PendingInvites invites={invites ?? []} /></Card>
      <Card><CardHeader title="Members" />
        <div className="divide-y">{members.map((m) => <MemberRow key={m.id} person={m} departments={departments} isSelf={m.id === ctx.userId} />)}</div>
      </Card>
    </div>
  </>);
}
