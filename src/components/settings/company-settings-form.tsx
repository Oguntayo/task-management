'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { addCategory, addDepartment, removeCategory, removeDepartment, updateCompanySettings } from '@/actions/company';
import type { CompanySettings } from '@/lib/auth/context';
import type { ActionResult } from '@/lib/utils';

const ZONES = ['Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'UTC'];
const ROLE_OPTS = ['pm', 'admin', 'tech_lead'] as const;

export function CompanySettingsForm({ name, industry, timezone, settings }: { name: string; industry: string | null; timezone: string; settings: CompanySettings }) {
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState({ name, industry: industry ?? '', timezone,
    reminderOffsetsHours: settings.reminder_offsets_hours?.join(', ') ?? '24, 4',
    remindOnDeadline: settings.remind_on_deadline ?? true, remindOverdue: settings.remind_overdue ?? true,
    overdueNotifyRoles: new Set(settings.overdue_notify_roles ?? ['pm', 'admin']),
    requireCompletionReview: settings.require_completion_review ?? false,
    workingHoursPerDay: settings.working_hours_per_day ?? 8, allowSelfApproval: settings.allow_self_approval ?? false,
    retentionDays: settings.retention_days ? String(settings.retention_days) : '' });

  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      run(() => updateCompanySettings({ ...v, overdueNotifyRoles: [...v.overdueNotifyRoles],
        reminderOffsetsHours: v.reminderOffsetsHours.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
        retentionDays: v.retentionDays || undefined }));
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name" error={fieldErrors.name}><Input value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Industry" hint="optional"><Input value={v.industry} onChange={(e) => setV((s) => ({ ...s, industry: e.target.value }))} placeholder="Fintech" /></Field>
      </div>
      <Field label="Timezone" hint="used for deadlines, reminders and reports"><Select value={v.timezone} onChange={(e) => setV((s) => ({ ...s, timezone: e.target.value }))} className="w-56">{ZONES.map((z) => <option key={z}>{z}</option>)}</Select></Field>

      <div className="rounded-md border p-3">
        <p className="mb-2 text-xs font-medium">Reminders</p>
        <Field label="Deadline reminder offsets (hours before)" hint="comma-separated"><Input value={v.reminderOffsetsHours} onChange={(e) => setV((s) => ({ ...s, reminderOffsetsHours: e.target.value }))} className="w-48" /></Field>
        <div className="mt-2 space-y-1.5 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.remindOnDeadline} onChange={(e) => setV((s) => ({ ...s, remindOnDeadline: e.target.checked }))} />Remind on the deadline day</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.remindOverdue} onChange={(e) => setV((s) => ({ ...s, remindOverdue: e.target.checked }))} />Remind when overdue</label>
        </div>
        <p className="mb-1 mt-2 text-xs font-medium">Notify these roles when a task is overdue</p>
        <div className="flex gap-3 text-[13px]">{ROLE_OPTS.map((r) => (
          <label key={r} className="flex items-center gap-1.5 capitalize">
            <input type="checkbox" checked={v.overdueNotifyRoles.has(r)} onChange={(e) => setV((s) => { const n = new Set(s.overdueNotifyRoles); e.target.checked ? n.add(r) : n.delete(r); return { ...s, overdueNotifyRoles: n }; })} />
            {r.replace('_', ' ')}</label>))}</div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 text-xs font-medium">Approvals &amp; work</p>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.requireCompletionReview} onChange={(e) => setV((s) => ({ ...s, requireCompletionReview: e.target.checked }))} />Require a PM/admin review before a task is marked complete</label>
        <label className="mt-1.5 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.allowSelfApproval} onChange={(e) => setV((s) => ({ ...s, allowSelfApproval: e.target.checked }))} />Allow a PM/admin to approve their own task</label>
        <Field label="Working hours per day" className="mt-2"><Input type="number" min="1" max="24" value={v.workingHoursPerDay} onChange={(e) => setV((s) => ({ ...s, workingHoursPerDay: Number(e.target.value) }))} className="w-24" /></Field>
      </div>

      <Field label="Data retention (days)" hint="optional — recorded as a setting; not yet auto-enforced" error={fieldErrors.retentionDays}>
        <Input type="number" min="30" max="3650" value={v.retentionDays} onChange={(e) => setV((s) => ({ ...s, retentionDays: e.target.value }))} className="w-32" placeholder="e.g. 365" />
      </Field>

      <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save settings</Button></div>
    </form>);
}

export function ListManager({ title, items, onAdd, onRemove, placeholder }: { title: string; items: Array<{ id: string; name: string }>; onAdd: (name: string) => Promise<ActionResult>; onRemove: (id: string) => Promise<ActionResult>; placeholder: string }) {
  const { run, pending } = useAction();
  const [value, setValue] = useState('');
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium">{title}</p>
      <ul className="mb-2 flex flex-wrap gap-1.5">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
            {it.name}
            <button type="button" onClick={() => run(() => onRemove(it.id))} aria-label={`Remove ${it.name}`}><Trash2 className="size-3 text-subtle hover:text-danger" /></button>
          </li>))}
        {!items.length && <li className="text-xs text-muted">None yet.</li>}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!value.trim()) return; run(() => onAdd(value), { onOk: () => setValue('') }); }}>
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="w-48" />
        <Button type="submit" size="sm" loading={pending}><Plus className="size-3.5" />Add</Button>
      </form>
    </div>);
}

export const addDept = addDepartment, removeDept = removeDepartment, addCat = addCategory, removeCat = removeCategory;
