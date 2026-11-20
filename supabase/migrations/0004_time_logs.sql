-- Time logged against planned tasks (needed for planned-vs-unplanned time analytics
-- and for AI deadline evaluation: "actual time spent").
create table public.task_time_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null,
  user_id uuid not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  logged_on date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (company_id, user_id) references public.company_memberships(company_id, user_id)
);
create index task_time_logs_task_idx on public.task_time_logs(task_id);
create index task_time_logs_user_idx on public.task_time_logs(company_id, user_id, logged_on);

alter table public.task_time_logs enable row level security;
revoke all on public.task_time_logs from anon, authenticated;
grant select, insert on public.task_time_logs to authenticated;
create policy time_logs_select on public.task_time_logs for select to authenticated
  using (public.can_view_task(task_id));
-- only people working on the task log time, and only for themselves
create policy time_logs_insert on public.task_time_logs for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_task(task_id)
    and exists (select 1 from public.task_assignees a where a.task_id = task_time_logs.task_id and a.user_id = auth.uid())
    or user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_time_logs.task_id and t.creator_id = auth.uid()));

-- time logs are append-only like the rest of the accountability record
create trigger task_time_logs_immutable before update or delete on public.task_time_logs
  for each row execute function public.forbid_mutation();
