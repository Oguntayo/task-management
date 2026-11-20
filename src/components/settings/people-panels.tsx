'use client';
import { useState } from 'react';
import { Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Field, Input, Select } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { inviteMember, removeMember, revokeInvitation, setMemberDepartment, setMemberRoles } from '@/actions/company';
import { ROLE_LABELS, type Role } from '@/lib/domain/permissions';

const ALL_ROLES: Role[] = ['admin', 'pm', 'tech_lead', 'employee'];
export interface PersonRow { membershipId: string; id: string; name: string; avatar: string | null; roles: Role[]; departmentId: string | null }
export interface DeptOption { id: string; name: string }

export function MemberRow({ person, departments, isSelf }: { person: PersonRow; departments: DeptOption[]; isSelf: boolean }) {
  const { run, pending } = useAction();
  const [roles, setRoles] = useState<Role[]>(person.roles);
  const [confirm, setConfirm] = useState(false);
  const toggleRole = (r: Role) => {
    const next = roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];
    setRoles(next); run(() => setMemberRoles(person.membershipId, next));
  };
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar name={person.name} url={person.avatar} />
      <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{person.name}{isSelf && <span className="ml-1.5 text-[11px] font-normal text-subtle">(you)</span>}</p>
        <div className="mt-1 flex flex-wrap gap-1">{ALL_ROLES.map((r) => (
          <button key={r} type="button" disabled={pending || (r === 'employee')} onClick={() => toggleRole(r)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${roles.includes(r) ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-border-strong text-muted hover:bg-surface-2'} ${r === 'employee' ? 'opacity-70' : ''}`}>
            {ROLE_LABELS[r]}</button>))}</div>
      </div>
      <Select value={person.departmentId ?? ''} onChange={(e) => run(() => setMemberDepartment(person.membershipId, e.target.value || null))} className="w-36 shrink-0">
        <option value="">No department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
      {!isSelf && (confirm
        ? <div className="flex shrink-0 items-center gap-1.5 text-xs"><Button size="sm" variant="danger" loading={pending} onClick={() => run(() => removeMember(person.membershipId))}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></div>
        : <Button variant="ghost" size="icon" onClick={() => setConfirm(true)} aria-label="Remove member"><X className="size-3.5" /></Button>)}
    </div>);
}

export function InviteForm({ departments }: { departments: DeptOption[] }) {
  const { run, pending, fieldErrors } = useAction();
  const [email, setEmail] = useState(''); const [roles, setRoles] = useState<Role[]>(['employee']); const [departmentId, setDepartmentId] = useState(''); const [jobTitle, setJobTitle] = useState('');
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => inviteMember({ email, roles, departmentId: departmentId || undefined, jobTitle: jobTitle || undefined }), { onOk: () => { setEmail(''); setJobTitle(''); } }); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" error={fieldErrors.email}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required /></Field>
        <Field label="Job title" hint="optional"><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></Field>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium">Roles</p>
        <div className="flex flex-wrap gap-1.5">{ALL_ROLES.map((r) => (
          <button key={r} type="button" disabled={r === 'employee'} onClick={() => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}
            className={`rounded-full border px-2.5 py-1 text-xs ${roles.includes(r) ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-border-strong text-muted hover:bg-surface-2'} ${r === 'employee' ? 'opacity-70' : ''}`}>
            {ROLE_LABELS[r]}</button>))}</div>
      </div>
      <Field label="Department" hint="optional"><Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-48"><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}><Mail className="size-3.5" />Send invitation</Button></div>
    </form>);
}

export function PendingInvites({ invites }: { invites: Array<{ id: string; email: string; roles: string[]; created_at: string }> }) {
  const { run, pending } = useAction();
  if (!invites.length) return <p className="px-4 py-6 text-center text-xs text-muted">No pending invitations.</p>;
  return (
    <ul className="divide-y">{invites.map((i) => (
      <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div><p className="text-[13px]">{i.email}</p><p className="text-[11px] text-subtle">{i.roles.join(', ')}</p></div>
        <Button variant="ghost" size="sm" loading={pending} onClick={() => run(() => revokeInvitation(i.id))}><X className="size-3.5" />Revoke</Button>
      </li>))}</ul>);
}
