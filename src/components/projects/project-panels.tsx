'use client';
import { useState } from 'react';
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Progress, Select, Textarea } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { deleteProject, refreshProjectEta, removeScopeItem, saveScopeItem, setProjectMembers, updateProject } from '@/actions/projects';
import type { Option } from '@/components/forms/unplanned-form';

export interface ScopeItemRow { id: string; title: string; weight: number; estimated_hours: number | null; completion: number; suggested_by_ai: boolean }

/** Scope items with progress bars. Admins can add, edit and remove; everyone else sees it read-only. */
export function ScopeEditor({ projectId, items, canEdit }: { projectId: string; items: ScopeItemRow[]; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', weight: '10', estimatedHours: '', completion: '0' });

  const startEdit = (it: ScopeItemRow) => { setEditing(it.id); setDraft({ title: it.title, weight: String(it.weight), estimatedHours: it.estimated_hours ? String(it.estimated_hours) : '', completion: String(it.completion) }); };
  const save = (id?: string) => run(() => saveScopeItem(projectId, { id, title: draft.title, weight: Number(draft.weight) || 1,
    estimatedHours: draft.estimatedHours ? Number(draft.estimatedHours) : null, completion: Number(draft.completion) || 0 }),
    { onOk: () => { setEditing(null); setAdding(false); setDraft({ title: '', weight: '10', estimatedHours: '', completion: '0' }); } });

  return (
    <div className="divide-y">
      {items.map((it) => (
        <div key={it.id} className="px-4 py-3">
          {editing === it.id ? (
            <div className="space-y-2">
              <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Item title" />
              <div className="grid grid-cols-3 gap-2">
                <Input value={draft.weight} onChange={(e) => setDraft((d) => ({ ...d, weight: e.target.value }))} type="number" min="1" max="100" placeholder="Weight %" />
                <Input value={draft.estimatedHours} onChange={(e) => setDraft((d) => ({ ...d, estimatedHours: e.target.value }))} type="number" min="0" placeholder="Hours" />
                <Input value={draft.completion} onChange={(e) => setDraft((d) => ({ ...d, completion: e.target.value }))} type="number" min="0" max="100" placeholder="Completion %" />
              </div>
              <div className="flex gap-2"><Button size="sm" variant="primary" loading={pending} onClick={() => save(it.id)}><Check className="size-3.5" />Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="size-3.5" />Cancel</Button></div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{it.title}{it.suggested_by_ai && <span className="ml-1.5 text-[10px] font-normal text-subtle">AI-suggested</span>}</p>
                <div className="mt-1.5 flex items-center gap-2"><Progress value={it.completion} className="max-w-xs" /><span className="tabular text-[11px] text-subtle">{it.completion}%</span></div>
                <p className="mt-1 text-[11px] text-subtle">Weight {it.weight}%{it.estimated_hours ? ` · ~${it.estimated_hours}h estimated` : ''}</p>
              </div>
              {canEdit && <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" onClick={() => startEdit(it)} aria-label="Edit"><Pencil className="size-3.5" /></Button>
                <Button variant="ghost" size="icon" onClick={() => run(() => removeScopeItem(projectId, it.id))} aria-label="Remove"><Trash2 className="size-3.5" /></Button>
              </div>}
            </div>)}
        </div>))}
      {!items.length && <p className="px-4 py-6 text-center text-xs text-muted">No scope items yet.</p>}
      {canEdit && (adding ? (
        <div className="space-y-2 px-4 py-3">
          <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="New item title" autoFocus />
          <div className="grid grid-cols-2 gap-2"><Input value={draft.weight} onChange={(e) => setDraft((d) => ({ ...d, weight: e.target.value }))} type="number" min="1" max="100" placeholder="Weight %" />
            <Input value={draft.estimatedHours} onChange={(e) => setDraft((d) => ({ ...d, estimatedHours: e.target.value }))} type="number" min="0" placeholder="Hours (optional)" /></div>
          <div className="flex gap-2"><Button size="sm" variant="primary" loading={pending} onClick={() => save()}><Check className="size-3.5" />Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
        </div>
      ) : <div className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" />Add scope item</Button></div>)}
    </div>);
}

/** Toggle who is assigned. Admin-only. */
export function MembersEditor({ projectId, all, assignedIds }: { projectId: string; all: Option[]; assignedIds: string[] }) {
  const { run, pending } = useAction();
  const [selected, setSelected] = useState(assignedIds);
  const dirty = selected.length !== assignedIds.length || selected.some((s) => !assignedIds.includes(s));
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap gap-1.5">
        {all.map((p) => (
          <button key={p.id} type="button" onClick={() => setSelected((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selected.includes(p.id) ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-border-strong text-muted hover:bg-surface-2'}`}>
            {p.label}
          </button>))}
      </div>
      {dirty && <Button size="sm" variant="primary" className="mt-3" loading={pending} onClick={() => run(() => setProjectMembers(projectId, selected))}>Save team</Button>}
    </div>);
}

/** AI's initial ETA, the observed-velocity projection, and the admin's own target — side by side, never conflated. */
export function EtaPanel({ projectId, aiEta, aiExplanation, aiAssumptions, projectedEta, projectedNote, targetDate, canEdit, tz }:
  { projectId: string; aiEta: string | null; aiExplanation: string | null; aiAssumptions: string[]; projectedEta: string | null; projectedNote: string | null; targetDate: string | null; canEdit: boolean; tz: string }) {
  const { run, pending } = useAction();
  const [target, setTarget] = useState(targetDate ?? '');
  const fmt = (d: string | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : null);
  return (
    <div className="space-y-4 px-4 py-3 text-[13px]">
      <div><p className="text-xs text-muted">AI initial estimate</p><p className="mt-0.5 font-medium">{fmt(aiEta) ?? 'Not yet estimated'}</p>
        {aiExplanation && <p className="mt-1 text-xs text-muted">{aiExplanation}</p>}
        {aiAssumptions.length > 0 && <ul className="mt-1 list-disc pl-4 text-[11px] text-subtle">{aiAssumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}</div>
      <div><p className="text-xs text-muted">Projected (from actual pace)</p><p className="mt-0.5 font-medium">{fmt(projectedEta) ?? 'Not enough history yet'}</p>
        {projectedNote && <p className="mt-1 text-xs text-muted">{projectedNote}</p>}</div>
      <div><p className="text-xs text-muted">Target date</p>
        {canEdit ? (
          <div className="mt-1 flex gap-2"><Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} className="w-40" />
            {target !== (targetDate ?? '') && <Button size="sm" variant="primary" loading={pending} onClick={() => run(() => updateProject(projectId, { targetDate: target || null }))}>Save</Button>}</div>
        ) : <p className="mt-0.5 font-medium">{fmt(targetDate) ?? 'Not set'}</p>}
      </div>
      {canEdit && <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => refreshProjectEta(projectId), { success: 'Re-estimating…' })}><RefreshCw className="size-3.5" />Re-run AI estimate</Button>}
    </div>);
}

export function ProjectStatusControl({ projectId, status }: { projectId: string; status: string }) {
  const { run, pending } = useAction();
  return (
    <Select value={status} disabled={pending} onChange={(e) => run(() => updateProject(projectId, { status: e.target.value }))} className="w-36">
      {['planning', 'active', 'on_hold', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
    </Select>);
}

export function ProjectDescriptionEditor({ projectId, description, canEdit }: { projectId: string; description: string; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description);
  if (!canEdit) return <p className="whitespace-pre-wrap text-[13px] text-muted">{description}</p>;
  return editing ? (
    <div className="space-y-2"><Textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="flex gap-2"><Button size="sm" variant="primary" loading={pending} onClick={() => run(() => updateProject(projectId, { description: value }), { onOk: () => setEditing(false) })}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => { setValue(description); setEditing(false); }}>Cancel</Button></div></div>
  ) : (
    <div className="group flex items-start justify-between gap-2"><p className="whitespace-pre-wrap text-[13px] text-muted">{description}</p>
      <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100" onClick={() => setEditing(true)} aria-label="Edit description"><Pencil className="size-3.5" /></Button></div>);
}

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const { run, pending } = useAction();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}><Trash2 className="size-3.5" />Delete</Button>;
  return <div className="flex items-center gap-2 text-xs"><span className="text-muted">Delete this product?</span>
    <Button variant="danger" size="sm" loading={pending} onClick={() => run(() => deleteProject(projectId))}>Yes, delete</Button>
    <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button></div>;
}
