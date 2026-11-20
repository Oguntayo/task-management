'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { reviewUnplannedWork } from '@/actions/unplanned';

type Action = 'approve' | 'reject' | 'request_clarification' | 'needs_further_review' | 'verify' | 'admin_approve';
export function UnplannedReview({ id, canReview, canVerify, canAdminApprove, verified, adminApproved }: { id: string; canReview: boolean; canVerify: boolean; canAdminApprove: boolean; verified: boolean; adminApproved: boolean }) {
  const { run, pending } = useAction(); const [note, setNote] = useState('');
  const go = (a: Action) => run(() => reviewUnplannedWork(id, a, note || undefined), { onOk: () => setNote('') });
  return (
    <div className="space-y-3">
      {(canReview || canVerify || canAdminApprove) && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject or ask for clarification)" aria-label="Review note" />}
      <div className="flex flex-wrap gap-2">
        {canReview && <><Button variant="primary" loading={pending} onClick={() => go('approve')}>Approve</Button><Button disabled={pending} onClick={() => go('request_clarification')}>Ask for clarification</Button>
          <Button disabled={pending} onClick={() => go('needs_further_review')}>Needs further review</Button><Button variant="danger" disabled={pending} onClick={() => go('reject')}>Reject</Button></>}
        {canVerify && !verified && <Button disabled={pending} onClick={() => go('verify')}>Verify technically</Button>}
        {canAdminApprove && !adminApproved && <Button disabled={pending} onClick={() => go('admin_approve')}>Admin approve</Button>}
      </div></div>);
}
