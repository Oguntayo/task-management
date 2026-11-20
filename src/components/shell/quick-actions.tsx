'use client';
import { useState } from 'react';
import { Megaphone, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { UnplannedForm, type Option } from '@/components/forms/unplanned-form';
import { ProjectUpdateForm } from '@/components/forms/project-update-form';

export interface QuickData { companyId: string; tasks: Option[]; members: Option[]; projects: Option[] }

/** Always reachable: header on desktop, bottom bar on mobile. Urgent work must be one click away. */
export function QuickActions({ data, variant }: { data: QuickData; variant: 'header' | 'bar' }) {
  const [unplanned, setUnplanned] = useState(false);
  const [update, setUpdate] = useState(false);
  const bar = variant === 'bar';
  return (
    <>
      <div className={bar ? 'flex w-full gap-2' : 'flex items-center gap-2'}>
        {data.projects.length > 0 && <Button size={bar ? 'lg' : 'md'} className={bar ? 'flex-1' : ''} onClick={() => setUpdate(true)}><Megaphone className="size-3.5" />Post update</Button>}
        <Button variant="urgent" size={bar ? 'lg' : 'md'} className={bar ? 'flex-1' : ''} onClick={() => setUnplanned(true)}><Zap className="size-3.5" />Log unplanned work</Button>
      </div>
      <Dialog open={unplanned} onOpenChange={setUnplanned}><DialogContent title="Log unplanned work" description="Something came up that was not in your plan." side="right">
        <UnplannedForm companyId={data.companyId} tasks={data.tasks} members={data.members} projects={data.projects} onDone={() => setUnplanned(false)} /></DialogContent></Dialog>
      <Dialog open={update} onOpenChange={setUpdate}><DialogContent title="Post a product update" description="Tell the team what you did and which product it was for.">
        <ProjectUpdateForm projects={data.projects} tasks={data.tasks} onDone={() => setUpdate(false)} /></DialogContent></Dialog>
    </>);
}
