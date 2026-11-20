import { createHash } from 'node:crypto';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/auth/context';
import { AcceptInviteButton } from '@/components/forms/accept-invite-button';

export const metadata = { title: 'Accept invitation' };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <p className="text-sm">This invitation link is incomplete.</p>;
  // Read-only preview via service role, keyed by the secret token's hash. Reveals only company name + invited email.
  const { data: inv } = await createAdminClient().from('invitations').select('email, status, expires_at, companies(name)')
    .eq('token_hash', createHash('sha256').update(token).digest('hex')).maybeSingle();
  const valid = inv && inv.status === 'pending' && new Date(inv.expires_at) > new Date();
  if (!valid) return (<><h1 className="mb-1 text-xl font-semibold tracking-tight">Invitation unavailable</h1><p className="text-sm text-muted">This link is invalid, expired or already used. Ask your admin for a new one.</p></>);
  const user = await getUser();
  const company = (inv.companies as any)?.name as string;
  const next = encodeURIComponent(`/accept-invite?token=${token}`);
  return (<><h1 className="mb-1 text-xl font-semibold tracking-tight">Join {company}</h1>
    <p className="mb-6 text-sm text-muted">This invitation is for <strong className="text-fg">{inv.email}</strong>.</p>
    {user ? <AcceptInviteButton token={token} /> : (<div className="space-y-2"><Link className="block rounded-md bg-accent px-3 py-2 text-center text-[13px] font-medium text-accent-fg" href={`/register?next=${next}`}>Create account to accept</Link>
      <Link className="block rounded-md border px-3 py-2 text-center text-[13px]" href={`/login?next=${next}`}>I already have an account</Link></div>)}</>);
}
