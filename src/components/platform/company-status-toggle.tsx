'use client';
import { Button } from '@/components/ui/button';
import { useAction } from '@/components/use-action';
import { setCompanyStatus } from '@/actions/platform';

export function CompanyStatusToggle({ companyId, status }: { companyId: string; status: string }) {
  const { run, pending } = useAction();
  const suspended = status === 'suspended';
  return (
    <Button size="sm" variant={suspended ? 'secondary' : 'danger'} loading={pending}
      onClick={() => run(() => setCompanyStatus(companyId, suspended ? 'active' : 'suspended'))}>
      {suspended ? 'Reactivate' : 'Suspend'}
    </Button>);
}
