'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { postProjectUpdate } from '@/actions/projects';
import type { Option } from '@/components/forms/unplanned-form';

/** "Post update": the staff member names the product; the AI judges whether it advances that product. */
export function ProjectUpdateForm({ projects, tasks, fixedProjectId, onDone }: { projects: Option[]; tasks: Option[]; fixedProjectId?: string; onDone?: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [projectId, setProjectId] = useState(fixedProjectId ?? projects[0]?.id ?? '');
  const [body, setBody] = useState(''); const [hours, setHours] = useState(''); const [taskId, setTaskId] = useState('');
  if (!projects.length) return <p className="text-sm text-muted">You are not assigned to any product yet. Ask an admin to add you to one.</p>;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => postProjectUpdate({ projectId, body, hours: hours ? Number(hours) : undefined, taskId: taskId || undefined }), { onOk: () => { setBody(''); setHours(''); onDone?.(); } }); }}>
      <Field label="Which product did you work on?" error={fieldErrors.projectId}><Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!!fixedProjectId}>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
      <Field label="What did you do?" hint="be specific; the AI uses this to place your work"><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Finished the KYC document upload screen and wired it to the verification API" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hours" hint="optional"><Input type="number" step="0.25" min="0" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        <Field label="Related task" hint="optional"><Select value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">None</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
      </div>
      <p className="text-xs text-muted">The product&apos;s progress only moves if your update genuinely advances its scope. Unrelated updates are kept on record but change nothing.</p>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Post update</Button></div>
    </form>);
}
