-- =====================================================================
-- Workline: helper functions, integrity triggers, RPCs, reference data
-- =====================================================================

-- ---------- reference data -------------------------------------------
insert into public.roles(key,label,description) values
  ('admin','Company Admin','Manages the workspace, people and settings'),
  ('pm','Project Manager','Reviews and approves work, deadlines and unplanned work'),
  ('tech_lead','Technical Lead','Validates technical estimates, blockers and completions'),
  ('employee','Employee','Plans, tracks and reports their own work');

insert into public.permissions(key,description) values
  ('company.manage','Edit company settings, departments and categories'),
  ('members.manage','Invite/remove members and assign roles'),
  ('tasks.view_all','View all company tasks'),
  ('tasks.create','Create and submit tasks'),
  ('tasks.approve','Approve/reject tasks and request clarification'),
  ('deadlines.decide','Approve/reject deadline extension requests'),
  ('unplanned.review','Review unplanned work'),
  ('unplanned.verify','Technically verify unplanned work'),
  ('unplanned.admin_approve','Admin-approve unplanned work'),
  ('blockers.manage','Monitor and resolve any blocker'),
  ('reports.team','View team and company reports'),
  ('analytics.company','View company-wide analytics');

insert into public.role_permissions(role_key,permission_key) values
  ('admin','company.manage'),('admin','members.manage'),('admin','tasks.view_all'),('admin','tasks.create'),
  ('admin','tasks.approve'),('admin','deadlines.decide'),('admin','unplanned.review'),
  ('admin','unplanned.verify'),('admin','unplanned.admin_approve'),('admin','blockers.manage'),
  ('admin','reports.team'),('admin','analytics.company'),
  ('pm','tasks.view_all'),('pm','tasks.create'),('pm','tasks.approve'),('pm','deadlines.decide'),
  ('pm','unplanned.review'),('pm','blockers.manage'),('pm','reports.team'),
  ('tech_lead','tasks.view_all'),('tech_lead','tasks.create'),('tech_lead','unplanned.verify'),
  ('tech_lead','blockers.manage'),('tech_lead','reports.team'),
  ('employee','tasks.create');

-- ---------- authorization helpers (SECURITY DEFINER avoids RLS recursion)
create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_memberships m
    join public.companies c on c.id = m.company_id
    where m.company_id = cid and m.user_id = auth.uid()
      and m.status = 'active' and c.status = 'active')
$$;

create or replace function public.has_any_role(cid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_memberships m
    join public.companies c on c.id = m.company_id
    join public.membership_roles mr on mr.membership_id = m.id
    where m.company_id = cid and m.user_id = auth.uid()
      and m.status = 'active' and c.status = 'active'
      and mr.role_key = any(roles))
$$;

create or replace function public.has_role(cid uuid, r text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(cid, array[r])
$$;
create or replace function public.is_manager(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(cid, array['admin','pm'])
$$;
create or replace function public.is_leader(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(cid, array['admin','pm','tech_lead'])
$$;

create or replace function public.can_view_task(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = tid and public.is_member(t.company_id)
      and (public.is_leader(t.company_id)
           or t.creator_id = auth.uid()
           or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid())))
$$;

create or replace function public.shares_company_with(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_memberships a
    join public.company_memberships b on b.company_id = a.company_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = uid and b.status = 'active')
$$;

create or replace function public.company_setting(cid uuid, k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select settings -> k from public.companies where id = cid
$$;

-- privileged flag: only set inside SECURITY DEFINER functions below
create or replace function public._priv() returns boolean language sql stable as $$
  select coalesce(current_setting('app.privileged', true), '') = 'on'
$$;

-- ---------- immutability ----------------------------------------------
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  -- cascade deletes from a parent (e.g. whole-company deletion) run at trigger depth > 1
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op
    using errcode = 'integrity_constraint_violation';
end $$;

create trigger task_activity_logs_immutable before update or delete on public.task_activity_logs
  for each row execute function public.forbid_mutation();
create trigger task_approvals_immutable before update or delete on public.task_approvals
  for each row execute function public.forbid_mutation();
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.forbid_mutation();

create or replace function public.log_activity(
  p_company uuid, p_task uuid, p_unplanned uuid, p_event text, p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.task_activity_logs(company_id, task_id, unplanned_entry_id, actor_id, event, details)
  values (p_company, p_task, p_unplanned, auth.uid(), p_event, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------- task state machine ----------------------------------------
create or replace function public.task_transition_allowed(o task_status, n task_status)
returns boolean language sql immutable as $$
  select case o
    when 'draft'            then n in ('submitted','pending_approval','cancelled')
    when 'submitted'        then n in ('pending_approval','approved','rejected','draft','cancelled')
    when 'pending_approval' then n in ('approved','rejected','draft','cancelled')
    when 'approved'         then n in ('in_progress','blocked','under_review','completed','cancelled')
    when 'in_progress'      then n in ('blocked','under_review','completed','cancelled')
    when 'blocked'          then n in ('in_progress','cancelled')
    when 'under_review'     then n in ('in_progress','completed')
    when 'completed'        then n in ('in_progress')
    when 'rejected'         then n in ('draft')
    else false end
$$;

create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pre_approval constant task_status[] := array['draft','submitted','pending_approval','rejected']::task_status[];
  priv boolean := public._priv();
  uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if not priv and uid is not null and new.creator_id <> uid then
      raise exception 'creator_id must be the authenticated user';
    end if;
    if not priv and new.status not in ('draft','submitted','pending_approval') then
      raise exception 'new tasks must start as draft or submitted';
    end if;
    new.current_deadline := new.original_deadline;
    return new;
  end if;

  -- UPDATE
  if new.company_id <> old.company_id or new.creator_id <> old.creator_id or new.created_at <> old.created_at then
    raise exception 'company_id, creator_id and created_at are immutable';
  end if;

  if new.status <> old.status then
    if not public.task_transition_allowed(old.status, new.status) then
      raise exception 'illegal task status transition % -> %', old.status, new.status;
    end if;
    if not priv then
      if new.status in ('approved','rejected') then
        raise exception 'approval decisions must go through decide_task_approval()';
      end if;
      if new.status = 'blocked' then
        raise exception 'report a blocker to block a task';
      end if;
      if old.status = 'blocked' and exists (select 1 from public.task_blockers b where b.task_id = new.id and b.status = 'open') then
        raise exception 'task has open blockers; resolve them first';
      end if;
      if old.status = 'completed' and uid is not null and not public.is_leader(new.company_id) then
        raise exception 'only a lead can reopen a completed task';
      end if;
      if new.status = 'cancelled' and uid is not null
         and not (old.creator_id = uid or public.is_leader(new.company_id)) then
        raise exception 'only the creator or a lead can cancel a task';
      end if;
      if new.status = 'completed' and uid is not null
         and coalesce((public.company_setting(new.company_id, 'require_completion_review'))::boolean, false)
         and not public.is_leader(new.company_id) then
        raise exception 'completion requires review: move the task to under_review';
      end if;
    end if;
    if new.status = 'completed' then
      new.progress := 100;
      new.completed_at := now();
    elsif old.status = 'completed' then
      new.completed_at := null;
    end if;
  end if;

  -- deadline protection ------------------------------------------------
  if old.status = any(pre_approval) and new.status = any(pre_approval) then
    -- still a proposal: both deadlines move together
    new.current_deadline := new.original_deadline;
  elsif not priv then
    if new.original_deadline is distinct from old.original_deadline then
      raise exception 'original_deadline is immutable once a task is approved';
    end if;
    if new.current_deadline is distinct from old.current_deadline then
      raise exception 'current_deadline can only change through an approved deadline request';
    end if;
  end if;
  return new;
end $$;

create trigger tasks_guard_biu before insert or update on public.tasks
  for each row execute function public.tasks_guard();

create or replace function public.tasks_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changes jsonb := '{}'::jsonb;
  req text := nullif(current_setting('app.deadline_request_id', true), '');
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.company_id, new.id, null, 'created',
      jsonb_build_object('status', new.status, 'task_type', new.task_type,
        'original_deadline', new.original_deadline, 'estimated_hours', new.estimated_hours));
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.log_activity(new.company_id, new.id, null, 'status_changed',
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.progress is distinct from old.progress then
    perform public.log_activity(new.company_id, new.id, null, 'progress_updated',
      jsonb_build_object('from', old.progress, 'to', new.progress));
  end if;
  if new.current_deadline is distinct from old.current_deadline
     and old.status <> all (array['draft','submitted','pending_approval','rejected']::task_status[]) then
    perform public.log_activity(new.company_id, new.id, null, 'deadline_changed',
      jsonb_build_object('from', old.current_deadline, 'to', new.current_deadline,
        'original_deadline', new.original_deadline, 'request_id', req));
  end if;
  if new.original_deadline is distinct from old.original_deadline
     and old.status = any (array['draft','submitted','pending_approval','rejected']::task_status[]) then
    changes := changes || jsonb_build_object('original_deadline',
      jsonb_build_object('from', old.original_deadline, 'to', new.original_deadline));
  end if;
  if new.title is distinct from old.title then
    changes := changes || jsonb_build_object('title', jsonb_build_object('from', old.title, 'to', new.title)); end if;
  if new.description is distinct from old.description then
    changes := changes || jsonb_build_object('description', jsonb_build_object(
      'from', left(old.description, 500), 'to', left(new.description, 500))); end if;
  if new.priority is distinct from old.priority then
    changes := changes || jsonb_build_object('priority', jsonb_build_object('from', old.priority, 'to', new.priority)); end if;
  if new.estimated_hours is distinct from old.estimated_hours then
    changes := changes || jsonb_build_object('estimated_hours', jsonb_build_object('from', old.estimated_hours, 'to', new.estimated_hours)); end if;
  if new.category_id is distinct from old.category_id then
    changes := changes || jsonb_build_object('category_id', jsonb_build_object('from', old.category_id, 'to', new.category_id)); end if;
  if new.expected_deliverable is distinct from old.expected_deliverable then
    changes := changes || jsonb_build_object('expected_deliverable', jsonb_build_object('from', old.expected_deliverable, 'to', new.expected_deliverable)); end if;
  if changes <> '{}'::jsonb then
    perform public.log_activity(new.company_id, new.id, null, 'fields_updated', changes);
  end if;
  return new;
end $$;

create trigger tasks_activity_aiu after insert or update on public.tasks
  for each row execute function public.tasks_activity();

create or replace function public.assignees_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.company_id, new.task_id, null, 'assignee_added', jsonb_build_object('user_id', new.user_id));
    return new;
  else
    if pg_trigger_depth() > 1 then return old; end if;  -- cascade from task deletion
    perform public.log_activity(old.company_id, old.task_id, null, 'assignee_removed', jsonb_build_object('user_id', old.user_id));
    return old;
  end if;
end $$;
create trigger task_assignees_activity after insert or delete on public.task_assignees
  for each row execute function public.assignees_activity();

-- ---------- blockers ----------------------------------------------------
create or replace function public.blockers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'resolved' then
      raise exception 'resolved blockers are immutable';
    end if;
    if new.task_id <> old.task_id or new.company_id <> old.company_id or new.reported_by <> old.reported_by
       or new.reported_at <> old.reported_at then
      raise exception 'blocker identity fields are immutable';
    end if;
    if new.status = 'resolved' then
      new.resolved_at := now();
      new.resolved_by := coalesce(auth.uid(), new.resolved_by);
    end if;
  end if;
  return new;
end $$;
create trigger task_blockers_guard_bu before update on public.task_blockers
  for each row execute function public.blockers_guard();

create or replace function public.blockers_effects() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prev text := coalesce(current_setting('app.privileged', true), '');
  t_status task_status;
begin
  select status into t_status from public.tasks where id = new.task_id;
  if tg_op = 'INSERT' then
    perform public.log_activity(new.company_id, new.task_id, null, 'blocker_reported',
      jsonb_build_object('blocker_id', new.id, 'category', new.category, 'is_external', new.is_external));
    if t_status in ('approved','in_progress') then
      perform set_config('app.privileged', 'on', true);
      update public.tasks set status = 'blocked' where id = new.task_id;
      perform set_config('app.privileged', prev, true);
    end if;
  elsif new.status = 'resolved' and old.status = 'open' then
    perform public.log_activity(new.company_id, new.task_id, null, 'blocker_resolved',
      jsonb_build_object('blocker_id', new.id));
    if t_status = 'blocked' and not exists (
         select 1 from public.task_blockers b where b.task_id = new.task_id and b.status = 'open' and b.id <> new.id) then
      perform set_config('app.privileged', 'on', true);
      update public.tasks set status = 'in_progress' where id = new.task_id;
      perform set_config('app.privileged', prev, true);
    end if;
  end if;
  return new;
end $$;
create trigger task_blockers_effects_aiu after insert or update on public.task_blockers
  for each row execute function public.blockers_effects();

-- ---------- deadline requests ------------------------------------------
create or replace function public.deadline_request_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('approved','rejected','withdrawn') then
    raise exception 'decided deadline requests are immutable';
  end if;
  if new.task_id <> old.task_id or new.company_id <> old.company_id or new.requested_by <> old.requested_by
     or new.previous_deadline <> old.previous_deadline or new.requested_deadline <> old.requested_deadline
     or new.reason <> old.reason or new.original_deadline is distinct from old.original_deadline then
    raise exception 'deadline request content is immutable';
  end if;
  return new;
end $$;
create trigger deadline_request_guard_bu before update on public.task_deadline_change_requests
  for each row execute function public.deadline_request_guard();

create or replace function public.request_deadline_extension(
  p_task_id uuid, p_requested_deadline timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  rid uuid;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found or not public.can_view_task(p_task_id) then
    raise exception 'task not found';
  end if;
  if not (t.creator_id = auth.uid()
          or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid())) then
    raise exception 'only the creator or an assignee can request an extension';
  end if;
  if t.status not in ('approved','in_progress','blocked','under_review') then
    raise exception 'extensions apply to approved, active tasks only (status: %)', t.status;
  end if;
  if p_requested_deadline <= t.current_deadline then
    raise exception 'requested deadline must be later than the current deadline';
  end if;
  insert into public.task_deadline_change_requests(
      company_id, task_id, requested_by, original_deadline, previous_deadline, requested_deadline, reason)
  values (t.company_id, t.id, auth.uid(), t.original_deadline, t.current_deadline, p_requested_deadline, p_reason)
  returning id into rid;
  perform public.log_activity(t.company_id, t.id, null, 'deadline_extension_requested',
    jsonb_build_object('request_id', rid, 'from', t.current_deadline, 'requested', p_requested_deadline, 'reason', p_reason));
  return rid;
end $$;

create or replace function public.respond_deadline_clarification(p_request_id uuid, p_response text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.task_deadline_change_requests%rowtype;
begin
  select * into r from public.task_deadline_change_requests where id = p_request_id;
  if not found or r.requested_by <> auth.uid() then raise exception 'request not found'; end if;
  if r.status <> 'clarification_requested' then raise exception 'no clarification was requested'; end if;
  update public.task_deadline_change_requests
     set employee_response = p_response, status = 'pending' where id = p_request_id;
  perform public.log_activity(r.company_id, r.task_id, null, 'deadline_clarification_provided',
    jsonb_build_object('request_id', p_request_id));
end $$;

create or replace function public.withdraw_deadline_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.task_deadline_change_requests%rowtype;
begin
  select * into r from public.task_deadline_change_requests where id = p_request_id;
  if not found or r.requested_by <> auth.uid() then raise exception 'request not found'; end if;
  if r.status not in ('pending','clarification_requested') then raise exception 'request already decided'; end if;
  update public.task_deadline_change_requests set status = 'withdrawn', decided_at = now() where id = p_request_id;
  perform public.log_activity(r.company_id, r.task_id, null, 'deadline_request_withdrawn',
    jsonb_build_object('request_id', p_request_id));
end $$;

create or replace function public.decide_deadline_request(
  p_request_id uuid, p_decision text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r public.task_deadline_change_requests%rowtype;
  t public.tasks%rowtype;
  prev text := coalesce(current_setting('app.privileged', true), '');
begin
  select * into r from public.task_deadline_change_requests where id = p_request_id;
  if not found or not public.is_manager(r.company_id) then raise exception 'request not found'; end if;
  if p_decision not in ('approved','rejected','clarification_requested') then
    raise exception 'invalid decision %', p_decision;
  end if;
  if r.status <> 'pending' then raise exception 'request is not pending (status: %)', r.status; end if;
  if r.requested_by = auth.uid()
     and not coalesce((public.company_setting(r.company_id, 'allow_self_approval'))::boolean, false) then
    raise exception 'you cannot decide your own request';
  end if;
  if p_decision in ('rejected','clarification_requested') and coalesce(btrim(p_note), '') = '' then
    raise exception 'a note is required for this decision';
  end if;
  select * into t from public.tasks where id = r.task_id for update;

  if p_decision = 'approved' then
    if t.current_deadline <> r.previous_deadline then
      raise exception 'task deadline changed since this request was made; ask the employee to re-request';
    end if;
    update public.task_deadline_change_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
     where id = p_request_id;
    perform set_config('app.privileged', 'on', true);
    perform set_config('app.deadline_request_id', p_request_id::text, true);
    update public.tasks set current_deadline = r.requested_deadline where id = r.task_id;
    perform set_config('app.deadline_request_id', '', true);
    perform set_config('app.privileged', prev, true);
  elsif p_decision = 'rejected' then
    update public.task_deadline_change_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
     where id = p_request_id;
  else
    update public.task_deadline_change_requests
       set status = 'clarification_requested', decision_note = p_note where id = p_request_id;
  end if;
  perform public.log_activity(r.company_id, r.task_id, null, 'deadline_request_' || p_decision,
    jsonb_build_object('request_id', p_request_id, 'note', p_note,
      'previous', r.previous_deadline, 'requested', r.requested_deadline));
end $$;

-- ---------- task approval ----------------------------------------------
create or replace function public.decide_task_approval(
  p_task_id uuid, p_decision approval_decision, p_note text default null,
  p_suggested_priority task_priority default null, p_suggested_deadline timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  prev text := coalesce(current_setting('app.privileged', true), '');
  self_ok boolean;
begin
  select * into t from public.tasks where id = p_task_id for update;
  if not found or not public.is_manager(t.company_id) then raise exception 'task not found'; end if;
  if t.status not in ('submitted','pending_approval') then
    raise exception 'task is not awaiting approval (status: %)', t.status;
  end if;
  self_ok := coalesce((public.company_setting(t.company_id, 'allow_self_approval'))::boolean, false);
  if not self_ok and (t.creator_id = auth.uid()
      or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid())) then
    raise exception 'you cannot approve work you created or are assigned to; ask another PM or admin';
  end if;
  if p_decision in ('rejected','clarification_requested','revision_requested') and coalesce(btrim(p_note), '') = '' then
    raise exception 'a note is required for this decision';
  end if;
  if p_decision = 'approved' and t.current_deadline is null then
    raise exception 'a deadline is required before a task can become a commitment';
  end if;

  insert into public.task_approvals(company_id, task_id, decided_by, decision, note, suggested_priority, suggested_deadline)
  values (t.company_id, t.id, auth.uid(), p_decision, p_note, p_suggested_priority, p_suggested_deadline);

  perform set_config('app.privileged', 'on', true);
  if p_decision = 'approved' then
    update public.tasks set status = 'approved', approved_at = now(), original_deadline = current_deadline
     where id = t.id;
  elsif p_decision = 'rejected' then
    update public.tasks set status = 'rejected' where id = t.id;
  elsif p_decision in ('clarification_requested','revision_requested') then
    update public.tasks set status = 'draft' where id = t.id;  -- returned to the employee
  end if;
  perform set_config('app.privileged', prev, true);

  perform public.log_activity(t.company_id, t.id, null, 'approval_' || p_decision,
    jsonb_build_object('note', p_note, 'suggested_priority', p_suggested_priority,
      'suggested_deadline', p_suggested_deadline));
end $$;

-- ---------- unplanned work ---------------------------------------------
create or replace function public.unplanned_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare priv boolean := public._priv();
begin
  if tg_op = 'INSERT' then
    if not priv and auth.uid() is not null and new.user_id <> auth.uid() then
      raise exception 'unplanned work can only be logged for yourself';
    end if;
    if not priv and (new.review_status <> 'reported' or new.reviewed_by is not null
        or new.verified_by is not null or new.admin_approved_by is not null) then
      raise exception 'review fields cannot be set on submission';
    end if;
    return new;
  end if;

  if new.company_id <> old.company_id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'company_id, user_id and created_at are immutable';
  end if;
  if not priv then
    if new.review_status is distinct from old.review_status
       or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at
       or new.review_note is distinct from old.review_note
       or new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at
       or new.admin_approved_by is distinct from old.admin_approved_by
       or new.admin_approved_at is distinct from old.admin_approved_at then
      raise exception 'review fields can only change through review_unplanned_entry()';
    end if;
    if old.review_status not in ('reported','clarification_requested') then
      raise exception 'entries cannot be edited after review (status: %)', old.review_status;
    end if;
    if old.review_status = 'clarification_requested' then
      new.review_status := 'reported';  -- employee responded; back to the queue
    end if;
  end if;
  return new;
end $$;
create trigger unplanned_guard_biu before insert or update on public.unplanned_work_entries
  for each row execute function public.unplanned_guard();

create or replace function public.unplanned_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.company_id, null, new.id, 'unplanned_reported',
      jsonb_build_object('hours_spent', new.hours_spent, 'is_urgent', new.is_urgent, 'work_status', new.work_status));
  elsif not public._priv() then
    perform public.log_activity(new.company_id, null, new.id, 'unplanned_updated',
      jsonb_build_object('hours_spent', jsonb_build_array(old.hours_spent, new.hours_spent),
                         'work_status', jsonb_build_array(old.work_status, new.work_status)));
  end if;
  return new;
end $$;
create trigger unplanned_activity_aiu after insert or update on public.unplanned_work_entries
  for each row execute function public.unplanned_activity();

create or replace function public.review_unplanned_entry(
  p_entry_id uuid, p_action text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  e public.unplanned_work_entries%rowtype;
  prev text := coalesce(current_setting('app.privileged', true), '');
  self_ok boolean;
begin
  select * into e from public.unplanned_work_entries where id = p_entry_id for update;
  if not found or not public.is_member(e.company_id) then raise exception 'entry not found'; end if;
  self_ok := coalesce((public.company_setting(e.company_id, 'allow_self_approval'))::boolean, false);
  if e.user_id = auth.uid() and not self_ok then
    raise exception 'you cannot review your own unplanned work';
  end if;
  if p_action in ('reject','request_clarification') and coalesce(btrim(p_note), '') = '' then
    raise exception 'a note is required for this action';
  end if;

  perform set_config('app.privileged', 'on', true);
  if p_action in ('approve','reject','request_clarification','needs_further_review') then
    if not public.is_manager(e.company_id) then raise exception 'only a PM or admin can do this'; end if;
    update public.unplanned_work_entries set
      review_status = case p_action when 'approve' then 'approved'
                                    when 'reject' then 'rejected'
                                    when 'request_clarification' then 'clarification_requested'
                                    else 'needs_further_review' end::unplanned_review_status,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     where id = e.id;
  elsif p_action = 'verify' then
    if not public.has_any_role(e.company_id, array['tech_lead','admin']) then
      raise exception 'only a technical lead or admin can verify'; end if;
    update public.unplanned_work_entries set verified_by = auth.uid(), verified_at = now() where id = e.id;
  elsif p_action = 'admin_approve' then
    if not public.has_role(e.company_id, 'admin') then raise exception 'only an admin can do this'; end if;
    update public.unplanned_work_entries set admin_approved_by = auth.uid(), admin_approved_at = now() where id = e.id;
  else
    perform set_config('app.privileged', prev, true);
    raise exception 'unknown action %', p_action;
  end if;
  perform set_config('app.privileged', prev, true);

  perform public.log_activity(e.company_id, null, e.id, 'unplanned_' || p_action, jsonb_build_object('note', p_note));
end $$;

-- ---------- tenancy: company creation & invitations --------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.protect_profile() returns trigger
language plpgsql as $$
begin
  if new.is_super_admin is distinct from old.is_super_admin and auth.uid() is not null then
    raise exception 'is_super_admin can only be changed by the platform operator';
  end if;
  if new.id <> old.id then raise exception 'profile id is immutable'; end if;
  return new;
end $$;
create trigger profiles_protect_bu before update on public.profiles
  for each row execute function public.protect_profile();

create or replace function public.create_company(
  p_name text, p_slug text, p_timezone text default 'UTC', p_industry text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.companies(name, slug, timezone, industry, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), coalesce(p_timezone, 'UTC'), p_industry, auth.uid())
  returning id into cid;
  insert into public.company_memberships(company_id, user_id) values (cid, auth.uid()) returning id into mid;
  insert into public.membership_roles(membership_id, company_id, role_key) values (mid, cid, 'admin');
  insert into public.task_categories(company_id, name, sort_order) values
    (cid,'Development',1),(cid,'Customer Service',2),(cid,'Operations',3),(cid,'Administration',4),
    (cid,'Finance',5),(cid,'Maintenance',6),(cid,'Other',7);
  insert into public.departments(company_id, name) values (cid, 'General');
  return cid;
end $$;

create or replace function public.invitation_hash(p_token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_token, 'utf8')), 'hex') $$;

create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations%rowtype;
  my_email text;
  mid uuid;
  r text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into my_email from public.profiles where id = auth.uid();
  select * into inv from public.invitations where token_hash = public.invitation_hash(p_token) for update;
  if not found then raise exception 'invalid invitation'; end if;
  if inv.status <> 'pending' then raise exception 'invitation is no longer valid'; end if;
  if inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = inv.id;
    raise exception 'invitation has expired';
  end if;
  if lower(inv.email) <> lower(my_email) then
    raise exception 'this invitation was issued to a different email address';
  end if;
  if not exists (select 1 from public.companies where id = inv.company_id and status = 'active') then
    raise exception 'company is not active';
  end if;

  insert into public.company_memberships(company_id, user_id, department_id, job_title)
  values (inv.company_id, auth.uid(), inv.department_id, inv.job_title)
  on conflict (company_id, user_id) do update
    set status = 'active', department_id = excluded.department_id, job_title = excluded.job_title
  returning id into mid;

  foreach r in array inv.roles loop
    if exists (select 1 from public.roles where key = r) then
      insert into public.membership_roles(membership_id, company_id, role_key)
      values (mid, inv.company_id, r) on conflict do nothing;
    end if;
  end loop;
  insert into public.membership_roles(membership_id, company_id, role_key)
  values (mid, inv.company_id, 'employee') on conflict do nothing;

  update public.invitations set status = 'accepted', accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.company_id;
end $$;

-- never remove the last admin
create or replace function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_table_name = 'membership_roles' then
    if old.role_key <> 'admin' then return old; end if;
    cid := old.company_id; mid := old.membership_id;
  else
    if not (old.status = 'active' and new.status = 'removed') then return new; end if;
    cid := old.company_id; mid := old.id;
    if not exists (select 1 from public.membership_roles where membership_id = mid and role_key = 'admin') then
      return new;
    end if;
  end if;
  if not exists (
    select 1 from public.membership_roles mr
    join public.company_memberships m on m.id = mr.membership_id
    where mr.company_id = cid and mr.role_key = 'admin' and m.status = 'active' and mr.membership_id <> mid) then
    raise exception 'a company must keep at least one active admin';
  end if;
  return coalesce(new, old);
end $$;
create trigger membership_roles_last_admin_bd before delete on public.membership_roles
  for each row execute function public.protect_last_admin();
create trigger memberships_last_admin_bu before update on public.company_memberships
  for each row execute function public.protect_last_admin();

-- ---------- audit ------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(coalesce(new, old)); cid uuid;
begin
  cid := case when tg_table_name = 'companies' then (j ->> 'id')::uuid else (j ->> 'company_id')::uuid end;
  insert into public.audit_logs(company_id, actor_id, action, entity_table, entity_id, old_data, new_data)
  values (cid, auth.uid(), lower(tg_op), tg_table_name,
          coalesce(j ->> 'id', (j ->> 'membership_id') || ':' || (j ->> 'role_key')),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'token_hash' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'token_hash' end);
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['companies','company_memberships','membership_roles','invitations','departments','task_categories']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- ---------- rate limiting (service role only) -------------------------
create or replace function public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare h int;
begin
  insert into public.rate_limits(key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                then 1 else public.rate_limits.hits + 1 end,
    window_start = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                then now() else public.rate_limits.window_start end
  returning hits into h;
  return h <= p_limit;
end $$;

-- ---------- platform (super admin) : counts and status only -----------
create or replace function public.platform_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'companies', (select count(*) from public.companies),
    'active_companies', (select count(*) from public.companies where status = 'active'),
    'suspended_companies', (select count(*) from public.companies where status = 'suspended'),
    'users', (select count(*) from public.profiles),
    'memberships', (select count(*) from public.company_memberships where status = 'active'),
    'tasks_last_30d', (select count(*) from public.tasks where created_at > now() - interval '30 days'));
end $$;

create or replace function public.platform_list_companies()
returns table (id uuid, name text, slug text, status company_status, plan text, subscription_status text,
               member_count bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  return query
    select c.id, c.name, c.slug, c.status, c.plan, c.subscription_status,
           (select count(*) from public.company_memberships m where m.company_id = c.id and m.status = 'active'),
           c.created_at
    from public.companies c order by c.created_at desc;
end $$;

create or replace function public.platform_set_company_status(p_company uuid, p_status company_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  update public.companies set status = p_status where id = p_company;
  insert into public.audit_logs(company_id, actor_id, action, entity_table, entity_id, new_data)
  values (p_company, auth.uid(), 'platform_status_change', 'companies', p_company::text,
          jsonb_build_object('status', p_status));
end $$;
