-- =====================================================================
-- Products / projects: admin-defined, staff assigned, AI-assisted progress.
-- progress & ETA fields are written only by triggers / service role, never by clients.
-- =====================================================================
create type project_status as enum ('planning','active','on_hold','completed','cancelled');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '',
  status project_status not null default 'active',
  start_date date not null default current_date,
  target_date date,                         -- admin's own target (optional)
  progress int not null default 0 check (progress between 0 and 100),   -- derived from scope items
  ai_eta date,                              -- AI's initial ETA at creation
  ai_eta_explanation text,
  ai_eta_assumptions jsonb not null default '[]'::jsonb,
  ai_eta_source text,
  projected_eta date,                       -- velocity-based projection, refreshed on progress
  projected_eta_note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, name),
  foreign key (company_id, created_by) references public.company_memberships(company_id, user_id)
);
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();

create table public.project_members (
  project_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  project_role text,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade,
  foreign key (company_id, user_id) references public.company_memberships(company_id, user_id)
);

-- scope items = what "done" means for the product; weights define each item's share of the whole
create table public.project_scope_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  company_id uuid not null,
  title text not null check (char_length(title) between 2 and 200),
  description text,
  weight int not null default 10 check (weight between 1 and 100),
  estimated_hours numeric(7,1),
  completion int not null default 0 check (completion between 0 and 100),
  sort_order int not null default 0,
  suggested_by_ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade
);
create index project_scope_project_idx on public.project_scope_items(project_id, sort_order);
create trigger project_scope_touch before update on public.project_scope_items for each row execute function public.touch_updated_at();

-- progress = weighted average of item completion
create or replace function public.recompute_project_progress(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w int; p int;
begin
  select coalesce(sum(weight),0), coalesce(round(sum(weight * completion)::numeric / nullif(sum(weight),0)),0)::int
    into w, p from public.project_scope_items where project_id = p_project;
  update public.projects set progress = p where id = p_project and progress is distinct from p;
end $$;

create or replace function public.scope_items_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_project_progress(coalesce(new.project_id, old.project_id));
  return coalesce(new, old);
end $$;
create trigger project_scope_progress_aiud after insert or update or delete on public.project_scope_items
  for each row execute function public.scope_items_changed();

-- tag work with a product
alter table public.tasks add column project_id uuid;
alter table public.tasks add foreign key (project_id, company_id) references public.projects(id, company_id);
create index tasks_project_idx on public.tasks(project_id) where project_id is not null;
alter table public.unplanned_work_entries add column project_id uuid;
alter table public.unplanned_work_entries add foreign key (project_id, company_id) references public.projects(id, company_id);

-- the staff update that names a product. Append-only.
create table public.project_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  body text not null check (char_length(body) between 3 and 5000),
  hours numeric(5,2),
  task_id uuid,
  unplanned_entry_id uuid,
  source text not null default 'update' check (source in ('update','task_progress','task_completed','unplanned')),
  created_at timestamptz not null default now(),
  foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade,
  foreign key (company_id, user_id) references public.company_memberships(company_id, user_id),
  foreign key (task_id, company_id) references public.tasks(id, company_id),
  foreign key (unplanned_entry_id, company_id) references public.unplanned_work_entries(id, company_id)
);
create index project_updates_project_idx on public.project_updates(project_id, created_at desc);
create trigger project_updates_immutable before update or delete on public.project_updates
  for each row execute function public.forbid_mutation();

-- AI judgement of each update. contributes=false rows change nothing; kept so the decision is reviewable.
create table public.project_update_evaluations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  update_id uuid not null references public.project_updates(id) on delete cascade,
  contributes boolean not null,
  reasoning text not null,
  changes jsonb not null default '[]'::jsonb,       -- [{item_id, title, from, to}]
  progress_before int not null,
  progress_after int not null,
  source text not null check (source in ('ai','heuristic')),
  provider text, model text,
  overridden_by uuid,
  created_at timestamptz not null default now(),
  foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade
);
create index project_eval_project_idx on public.project_update_evaluations(project_id, created_at desc);
create trigger project_eval_immutable before update or delete on public.project_update_evaluations
  for each row execute function public.forbid_mutation();

-- helper: who can see a project (leaders all; staff only those they are assigned to)
create or replace function public.can_view_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p
    where p.id = pid and public.is_member(p.company_id)
      and (public.is_leader(p.company_id)
           or exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = auth.uid())))
$$;
create or replace function public.is_project_member(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = auth.uid())
$$;

-- audit
create trigger projects_audit after insert or update or delete on public.projects for each row execute function public.audit_row();
create trigger project_scope_audit after insert or update or delete on public.project_scope_items for each row execute function public.audit_row();
create trigger project_members_audit after insert or delete on public.project_members for each row execute function public.audit_row();

-- ---------- RLS ----------
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_scope_items enable row level security;
alter table public.project_updates enable row level security;
alter table public.project_update_evaluations enable row level security;
revoke all on public.projects, public.project_members, public.project_scope_items, public.project_updates, public.project_update_evaluations from anon, authenticated;

grant select, insert, delete on public.projects to authenticated;
grant update (name, description, status, start_date, target_date) on public.projects to authenticated;
-- inline (not via can_view_project) so INSERT ... RETURNING can see the new row
create policy projects_select on public.projects for select to authenticated
  using (public.is_leader(company_id) or (public.is_member(company_id) and public.is_project_member(id)));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.has_role(company_id, 'admin') and created_by = auth.uid());
create policy projects_update on public.projects for update to authenticated
  using (public.has_role(company_id, 'admin')) with check (public.has_role(company_id, 'admin'));
create policy projects_delete on public.projects for delete to authenticated using (public.has_role(company_id, 'admin'));

grant select, insert, delete on public.project_members to authenticated;
create policy pm_select on public.project_members for select to authenticated using (public.can_view_project(project_id));
create policy pm_insert on public.project_members for insert to authenticated with check (public.has_role(company_id, 'admin'));
create policy pm_delete on public.project_members for delete to authenticated using (public.has_role(company_id, 'admin'));

grant select, insert, update, delete on public.project_scope_items to authenticated;
create policy scope_select on public.project_scope_items for select to authenticated using (public.can_view_project(project_id));
create policy scope_write on public.project_scope_items for all to authenticated
  using (public.has_role(company_id, 'admin')) with check (public.has_role(company_id, 'admin'));

grant select, insert on public.project_updates to authenticated;
create policy pupd_select on public.project_updates for select to authenticated
  using (public.can_view_project(project_id) and (user_id = auth.uid() or public.is_leader(company_id)));
create policy pupd_insert on public.project_updates for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(company_id)
              and (public.is_project_member(project_id) or public.is_leader(company_id)));

grant select on public.project_update_evaluations to authenticated;
create policy peval_select on public.project_update_evaluations for select to authenticated
  using (public.can_view_project(project_id) and (public.is_leader(company_id)
        or exists (select 1 from public.project_updates u where u.id = update_id and u.user_id = auth.uid())));

grant execute on function public.can_view_project(uuid), public.is_project_member(uuid) to authenticated;
revoke execute on function public.recompute_project_progress(uuid) from public, anon, authenticated;
