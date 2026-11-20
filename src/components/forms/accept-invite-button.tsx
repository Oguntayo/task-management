'use client';
import { Button } from '@/components/ui/button';
import { useAction } from '@/components/use-action';
import { acceptInvitation } from '@/actions/company';
export function AcceptInviteButton({ token }: { token: string }) {
  const { run, pending } = useAction();
  return <Button variant="primary" size="lg" className="w-full" loading={pending} onClick={() => run(() => acceptInvitation(token))}>Accept invitation</Button>;
}
