'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { FileUpload, type UploadedFile } from '@/components/forms/file-upload';
import { addComment, changeTaskStatus, decideTask, recordAttachment, submitTask, updateProgress } from '@/actions/tasks';
import { decideExtension, requestExtension, respondToClarification, withdrawExtension } from '@/actions/deadlines';
import { reportBlocker, resolveBlocker } from '@/actions/blockers';
import { STATUS_LABEL, type TaskStatus } from '@/lib/domain/task-state';
import type { Option } from '@/components/forms/unplanned-form';

export function StatusActions({ taskId, options, isDraft }: { taskId: string; options: TaskStatus[]; isDraft: boolean }) {
  const { run, pending } = useAction();
  const verb: Partial<Record<TaskStatus, string>> = { in_progress: 'Start / resume work', under_review: 'Submit for review', completed: 'Mark complete', cancelled: 'Cancel task', draft: 'Return to draft', pending_approval: 'Submit for approval' };
  const [confirm, setConfirm] = useState<TaskStatus | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {isDraft && <Button variant="primary" loading={pending} onClick={() => run(() => submitTask(taskId))}>Submit for approval</Button>}
      {options.filter((s) => !(isDraft && s === 'pending_approval') && s !== 'submitted' && s !== 'draft').map((s) => (
        <Button key={s} variant={s === 'completed' ? 'primary' : s === 'cancelled' ? 'ghost' : 'secondary'} disabled={pending}
          onClick={() => (s === 'cancelled' || s === 'completed') ? setConfirm(s) : run(() => changeTaskStatus(taskId, s))}>{verb[s] ?? STATUS_LABEL[s]}</Button>))}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}><DialogContent title={confirm === 'cancelled' ? 'Cancel this task?' : 'Mark as complete?'}
        description={confirm === 'cancelled' ? 'It stays in your history as cancelled. This cannot be undone.' : 'Progress is set to 100% and the completion time is recorded permanently.'}>
        <div className="flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Not yet</Button>
          <Button variant={confirm === 'cancelled' ? 'danger' : 'primary'} loading={pending} onClick={() => run(() => changeTaskStatus(taskId, confirm!), { onOk: () => setConfirm(null) })}>{confirm === 'cancelled' ? 'Cancel task' : 'Complete'}</Button></div></DialogContent></Dialog>
    </div>);
}

export function ProgressForm({ taskId, progress, hasProject }: { taskId: string; progress: number; hasProject: boolean }) {
  const { run, pending } = useAction();
  const [p, setP] = useState(progress), [hours, setHours] = useState(''), [note, setNote] = useState('');
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => updateProgress({ taskId, progress: p, hours: hours ? Number(hours) : undefined, note: note || undefined }), { onOk: () => { setHours(''); setNote(''); } }); }}>
      <div><div className="mb-1 flex justify-between text-xs"><label htmlFor="prog" className="font-medium">Progress</label><span className="tabular text-muted">{p}%</span></div>
        <input id="prog" type="range" min={0} max={100} step={5} value={p} onChange={(e) => setP(Number(e.target.value))} className="w-full accent-[var(--accent)]" /></div>
      <div className="grid grid-cols-3 gap-2"><Field label="Hours worked" className="col-span-1"><Input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        <Field label="What changed?" className="col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short note for the record" /></Field></div>
      {hasProject && <p className="text-xs text-muted">This task belongs to a product, so your note is also checked against that product&apos;s scope.</p>}
      <Button type="submit" loading={pending}>Save update</Button>
    </form>);
}

export function BlockerButton({ taskId, people, departments }: { taskId: string; people: Option[]; departments: Option[] }) {
  const [open, setOpen] = useState(false); const { run, pending, fieldErrors } = useAction();
  const [f, setF] = useState({ category: 'other', description: '', isExternal: false, responsibleUserId: '', responsibleDepartmentId: '', expectedResolutionDate: '' });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  return (<>
    <Button onClick={() => setOpen(true)}>Report blocker</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent title="Report a blocker" description="The task will be marked blocked and your PM is told. Delays caused by external blockers are shown as such.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => reportBlocker({ taskId, ...f }), { onOk: () => setOpen(false) }); }}>
        <Field label="What is blocking you?" error={fieldErrors.description}><Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.category} onChange={(e) => set('category', e.target.value)}>
            {[['waiting_for_employee', 'Waiting for another employee'], ['api_credentials', 'Waiting for API credentials'], ['management_approval', 'Waiting for management approval'], ['external_outage', 'External service outage'], ['missing_information', 'Missing information'], ['technical_dependency', 'Technical dependency'], ['customer_delay', 'Customer-related delay'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Expected resolution"><Input type="date" value={f.expectedResolutionDate} onChange={(e) => set('expectedResolutionDate', e.target.value)} /></Field>
          <Field label="Responsible person" hint="if known"><Select value={f.responsibleUserId} onChange={(e) => set('responsibleUserId', e.target.value)}><option value="">Unknown</option>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
          <Field label="Responsible department" hint="if known"><Select value={f.responsibleDepartmentId} onChange={(e) => set('responsibleDepartmentId', e.target.value)}><option value="">Unknown</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select></Field></div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.isExternal} onChange={(e) => set('isExternal', e.target.checked)} />Outside our control (vendor, customer, outage)</label>
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Report blocker</Button></div></form></DialogContent></Dialog></>);
}

export function ResolveBlocker({ id }: { id: string }) {
  const { run, pending } = useAction();
  return <Button size="sm" loading={pending} onClick={() => run(() => resolveBlocker(id))}>Mark resolved</Button>;
}

export function ExtensionButton({ taskId, currentDeadline, originalDeadline, tz }: { taskId: string; currentDeadline: string; originalDeadline: string | null; tz: string }) {
  const [open, setOpen] = useState(false); const { run, pending, fieldErrors } = useAction();
  const [when, setWhen] = useState(''), [reason, setReason] = useState('');
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return (<>
    <Button onClick={() => setOpen(true)}>Request more time</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent title="Request a deadline extension" description="Your PM decides. The original deadline always stays on the record.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => requestExtension({ taskId, requestedDeadline: when ? new Date(when).toISOString() : '', reason }), { onOk: () => setOpen(false) }); }}>
        <div className="grid grid-cols-2 gap-2 rounded-md bg-surface-2 p-3 text-xs"><div><p className="text-subtle">Original</p><p className="font-medium">{originalDeadline ? fmt(originalDeadline) : '—'}</p></div><div><p className="text-subtle">Current</p><p className="font-medium">{fmt(currentDeadline)}</p></div></div>
        <Field label="Requested new deadline" error={fieldErrors.requestedDeadline}><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Why do you need more time?" hint="mention interruptions or blockers" error={fieldErrors.reason}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Send request</Button></div></form></DialogContent></Dialog></>);
}

/** Manager decision on a pending task, with the original submission preserved server-side. */
export function ApprovalPanel({ taskId }: { taskId: string }) {
  const { run, pending } = useAction(); const [note, setNote] = useState(''); const [prio, setPrio] = useState('');
  const go = (decision: 'approved' | 'rejected' | 'clarification_requested' | 'revision_requested' | 'priority_change_suggested') =>
    run(() => decideTask({ taskId, decision, note: note || undefined, suggestedPriority: decision === 'priority_change_suggested' ? prio : undefined }), { onOk: () => setNote('') });
  return (
    <div className="space-y-3"><Field label="Note to the employee" hint="required to reject or ask for changes"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={pending} onClick={() => go('approved')}>Approve commitment</Button>
        <Button disabled={pending} onClick={() => go('clarification_requested')}>Ask for clarification</Button>
        <Button disabled={pending} onClick={() => go('revision_requested')}>Request revised timeline</Button>
        <Button variant="danger" disabled={pending} onClick={() => go('rejected')}>Reject</Button></div>
      <div className="flex items-center gap-2"><Select className="w-32" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Suggested priority"><option value="">Priority…</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></Select>
        <Button size="sm" disabled={pending || !prio} onClick={() => go('priority_change_suggested')}>Suggest priority change</Button></div></div>);
}

export function ExtensionDecision({ requestId, status, canDecide, isRequester }: { requestId: string; status: string; canDecide: boolean; isRequester: boolean }) {
  const { run, pending } = useAction(); const [note, setNote] = useState(''); const [reply, setReply] = useState('');
  if (status === 'clarification_requested' && isRequester) return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => respondToClarification(requestId, reply), { onOk: () => setReply('') }); }}>
      <Field label="Your response to the PM"><Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} /></Field><div className="flex gap-2"><Button type="submit" variant="primary" loading={pending}>Send response</Button><Button type="button" variant="ghost" onClick={() => run(() => withdrawExtension(requestId))}>Withdraw</Button></div></form>);
  if (status === 'pending' && isRequester && !canDecide) return <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => withdrawExtension(requestId))}>Withdraw request</Button>;
  if (!canDecide || status !== 'pending') return null;
  const go = (d: 'approved' | 'rejected' | 'clarification_requested') => run(() => decideExtension({ requestId, decision: d, note: note || undefined }));
  return (<div className="space-y-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject or ask for clarification)" aria-label="Decision note" />
    <div className="flex flex-wrap gap-2"><Button variant="primary" loading={pending} onClick={() => go('approved')}>Approve new deadline</Button><Button disabled={pending} onClick={() => go('clarification_requested')}>Ask for clarification</Button><Button variant="danger" disabled={pending} onClick={() => go('rejected')}>Reject</Button></div></div>);
}

export function CommentForm({ id, kind = 'task' }: { id: string; kind?: 'task' | 'unplanned' }) {
  const { run, pending } = useAction(); const [body, setBody] = useState('');
  return (<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addComment(id, body, kind), { onOk: () => setBody('') }); }}>
    <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" aria-label="Comment" /><Button type="submit" loading={pending}>Post</Button></form>);
}

export function AttachmentAdder({ companyId, taskId }: { companyId: string; taskId: string }) {
  const { run } = useAction(); const [files, setFiles] = useState<UploadedFile[]>([]);
  return <FileUpload companyId={companyId} kind="tasks" files={files} onChange={(f) => { const added = f.filter((x) => !files.some((y) => y.publicId === x.publicId)); setFiles(f);
    added.forEach((a) => run(() => recordAttachment({ taskId, ...a }))); }} />;
}
