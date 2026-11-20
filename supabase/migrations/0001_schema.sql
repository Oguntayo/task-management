-- =====================================================================
-- Workline: schema
-- Tenant integrity strategy: every tenant-owned child table carries
-- company_id and references its parent through a COMPOSITE foreign key
-- (id, company_id), so a row can never point at another company's data,
-- even if an application bug or a malicious client supplies a foreign id.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- enums -----------------------------------------------------
create type task_status as enum (
  'draft','submitted','pending_approval','approved','in_progress',
  'blocked','under_review','completed','rejected','cancelled'
);
create type task_priority as enum ('low','medium','high','urgent');
create type task_type as enum ('planned','ad_hoc','follow_up');
create type planning_period as enum ('daily','weekly','custom');
create type approval_decision as enum (
  'approved','rejected','clarification_requested','revision_requested','priority_change_suggested'
);
create type deadline_request_status as enum (
  'pending','clarification_requested','approved','rejected','withdrawn'
);
create type blocker_category as enum (
  'waiting_for_employee','api_credentials','management_approval','external_outage',
  'missing_information','technical_dependency','customer_delay','other'
);
create type blocker_status as enum ('open','resolved');
create type unplanned_work_status as enum ('completed','in_progress','awaiting_action');
create type unplanned_review_status as enum (
  'reported','approved','rejected','clarification_requested','needs_further_review'
);
create type invitation_status as enum ('pending','accepted','revoked','expired');
create type company_status as enum ('active','suspended');
create type email_status as enum ('queued','sent','failed','skipped');

-- ---------- generic helpers ------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- identity --------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  avatar_public_id text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_lower_idx on public.profiles (lower(email));

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  status company_status not null default 'active',
  plan text not null default 'trial',
  subscription_status text not null default 'trialing',
  industry text,
  timezone text not null default 'UTC',
  logo_url text,
  logo_public_id text,
  -- reminder_offsets_hours: hours BEFORE deadline; overdue_notify: who gets overdue mail
  settings jsonb not null default jsonb_build_object(
    'reminder_offsets_hours', jsonb_build_array(24),
    'remind_on_deadline', true,
    'remind_overdue', true,
    'overdue_notify_roles', jsonb_build_array('pm','admin'),
    'require_completion_review', false,
    'working_hours_per_day', 8,
    'working_days', jsonb_build_array(1,2,3,4,5),
    'retention_days', null
  ),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid,
  job_title text,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id),
  unique (id, company_id),
  foreign key (department_id, company_id) references public.departments(id, company_id)
);
create index company_memberships_user_idx on public.company_memberships(user_id) where status = 'active';

-- Reference data: roles & permissions (global, read-only to tenants)
create table public.roles (
  key text primary key,
  label text not null,
  description text
);
create table public.permissions (
  key text primary key,
  description text
);
create table public.role_permissions (
  role_key text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);
-- A member can hold several roles at once (e.g. PM + developer).
create table public.membership_roles (
  membership_id uuid not null,
  company_id uuid not null,
  role_key text not null references public.roles(key),
  created_at timestamptz not null default now(),
  primary key (membership_id, role_key),
  foreign key (membership_id, company_id) references public.company_memberships(id, company_id) on delete cascade
);
create index membership_roles_company_idx on public.membership_roles(company_id, role_key);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  roles text[] not null default array['employee'],
  department_id uuid,
  job_title text,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  status invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (department_id, company_id) references public.departments(id, company_id)
);
create unique index invitations_pending_email_idx
  on public.invitations (company_id, lower(email)) where status = 'pending';

-- ---------- tasks -----------------------------------------------------
create table public.task_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  description text not null default '',
  category_id uuid,
  task_type task_type not null default 'planned',
  creator_id uuid not null,
  department_id uuid,
  priority task_priority not null default 'medium',
  planning_period planning_period not null default 'weekly',
  period_start date,
  period_end date,
  expected_start_date date,
  -- original_deadline is frozen once the task is approved (see tasks_guard trigger)
  original_deadline timestamptz,
  current_deadline timestamptz,
  estimated_hours numeric(7,2) check (estimated_hours is null or estimated_hours > 0),
  ai_suggested_hours numeric(7,2),
  status task_status not null default 'draft',
  progress int not null default 0 check (progress between 0 and 100),
  complexity int check (complexity between 1 and 5),
  expected_deliverable text,
  completed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (company_id, creator_id) references public.company_memberships(company_id, user_id),
  foreign key (category_id, company_id) references public.task_categories(id, company_id),
  foreign key (department_id, company_id) references public.departments(id, company_id),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index tasks_company_status_idx on public.tasks(company_id, status);
create index tasks_company_deadline_idx on public.tasks(company_id, current_deadline) where status not in ('completed','cancelled','rejected');
create index tasks_creator_idx on public.tasks(company_id, creator_id);

create table public.task_assignees (
  task_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (company_id, user_id) references public.company_memberships(company_id, user_id)
);
create index task_assignees_user_idx on public.task_assignees(company_id, user_id);

create table public.task_dependencies (
  task_id uuid not null,
  depends_on_task_id uuid not null,
  company_id uuid not null,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (depends_on_task_id, company_id) references public.tasks(id, company_id) on delete cascade
);

-- Unplanned / urgent work: an independent record, never a silent edit of a planned task.
create table public.unplanned_work_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  title text not null check (char_length(title) between 3 and 200),
  what_happened text not null,
  action_taken text not null,
  why_necessary text not null,
  requested_by_name text,
  requested_by_user_id uuid,
  occurred_at timestamptz not null,
  hours_spent numeric(6,2) not null check (hours_spent >= 0 and hours_spent <= 168),
  priority task_priority not null default 'high',
  is_urgent boolean not null default false,
  incident_reference text,
  work_status unplanned_work_status not null default 'completed',
  related_task_id uuid,
  category_id uuid,
  -- review chain: reported -> reviewed (PM) -> verified (tech lead) -> admin approved
  review_status unplanned_review_status not null default 'reported',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  verified_by uuid,
  verified_at timestamptz,
  admin_approved_by uuid,
  admin_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (company_id, user_id) references public.company_memberships(company_id, user_id),
  foreign key (company_id, requested_by_user_id) references public.company_memberships(company_id, user_id),
  foreign key (related_task_id, company_id) references public.tasks(id, company_id),
  foreign key (category_id, company_id) references public.task_categories(id, company_id),
  foreign key (company_id, reviewed_by) references public.company_memberships(company_id, user_id),
  foreign key (company_id, verified_by) references public.company_memberships(company_id, user_id),
  foreign key (company_id, admin_approved_by) references public.company_memberships(company_id, user_id)
);
create index unplanned_company_user_idx on public.unplanned_work_entries(company_id, user_id, occurred_at desc);
create index unplanned_review_idx on public.unplanned_work_entries(company_id, review_status);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid,
  unplanned_entry_id uuid,
  author_id uuid not null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  check ((task_id is not null)::int + (unplanned_entry_id is not null)::int = 1),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (unplanned_entry_id, company_id) references public.unplanned_work_entries(id, company_id) on delete cascade,
  foreign key (company_id, author_id) references public.company_memberships(company_id, user_id)
);
create index task_comments_task_idx on public.task_comments(task_id, created_at);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid,
  unplanned_entry_id uuid,
  uploaded_by uuid not null,
  cloudinary_public_id text not null,
  cloudinary_url text not null check (cloudinary_url ~ '^https://res\.cloudinary\.com/'),
  resource_type text not null default 'image',
  format text,
  bytes bigint check (bytes is null or bytes <= 26214400),
  original_filename text,
  created_at timestamptz not null default now(),
  check ((task_id is not null)::int + (unplanned_entry_id is not null)::int = 1),
  unique (company_id, cloudinary_public_id),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (unplanned_entry_id, company_id) references public.unplanned_work_entries(id, company_id) on delete cascade,
  foreign key (company_id, uploaded_by) references public.company_memberships(company_id, user_id)
);

-- Immutable history (enforced by triggers + revoked privileges, see 0002/0003)
create table public.task_activity_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid,
  unplanned_entry_id uuid,
  actor_id uuid,
  event text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((task_id is not null)::int + (unplanned_entry_id is not null)::int = 1)
);
create index task_activity_task_idx on public.task_activity_logs(task_id, created_at);
create index task_activity_unplanned_idx on public.task_activity_logs(unplanned_entry_id, created_at);
create index task_activity_company_idx on public.task_activity_logs(company_id, created_at desc);

create table public.task_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null,
  decided_by uuid not null,
  decision approval_decision not null,
  note text,
  suggested_priority task_priority,
  suggested_deadline timestamptz,
  created_at timestamptz not null default now(),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (company_id, decided_by) references public.company_memberships(company_id, user_id)
);
create index task_approvals_task_idx on public.task_approvals(task_id, created_at);

create table public.task_deadline_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null,
  requested_by uuid not null,
  original_deadline timestamptz,
  previous_deadline timestamptz not null,
  requested_deadline timestamptz not null,
  reason text not null check (char_length(reason) between 5 and 3000),
  status deadline_request_status not null default 'pending',
  employee_response text,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requested_deadline > previous_deadline),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (company_id, requested_by) references public.company_memberships(company_id, user_id),
  foreign key (company_id, decided_by) references public.company_memberships(company_id, user_id)
);
create unique index deadline_req_one_open_idx
  on public.task_deadline_change_requests(task_id) where status in ('pending','clarification_requested');

create table public.task_blockers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null,
  reported_by uuid not null,
  category blocker_category not null default 'other',
  description text not null check (char_length(description) between 5 and 3000),
  is_external boolean not null default false,
  responsible_user_id uuid,
  responsible_department_id uuid,
  expected_resolution_date date,
  status blocker_status not null default 'open',
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (company_id, reported_by) references public.company_memberships(company_id, user_id),
  foreign key (company_id, responsible_user_id) references public.company_memberships(company_id, user_id),
  foreign key (responsible_department_id, company_id) references public.departments(id, company_id),
  foreign key (company_id, resolved_by) references public.company_memberships(company_id, user_id)
);
create index task_blockers_open_idx on public.task_blockers(company_id, task_id) where status = 'open';

-- ---------- reports ---------------------------------------------------
create table public.standup_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  report_date date not null,
  generated jsonb not null default '{}'::jsonb,
  employee_notes text,
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, report_date),
  foreign key (company_id, user_id) references public.company_memberships(company_id, user_id)
);
create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  week_start date not null,
  generated jsonb not null default '{}'::jsonb,
  employee_notes text,
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, week_start),
  foreign key (company_id, user_id) references public.company_memberships(company_id, user_id)
);

-- ---------- AI --------------------------------------------------------
create table public.ai_task_estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null,
  requested_by uuid,
  employee_estimate_hours numeric(7,2),
  recommended_min_hours numeric(7,2),
  recommended_max_hours numeric(7,2),
  verdict text check (verdict in ('reasonable','too_low','too_high','insufficient_info')),
  explanation text,
  missing_information jsonb not null default '[]'::jsonb,
  used_company_history boolean not null default false,
  provider text,
  model text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade
);
create index ai_task_estimates_task_idx on public.ai_task_estimates(task_id, created_at desc);

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('deadline_extension','workload')),
  task_id uuid,
  deadline_request_id uuid,
  subject_user_id uuid,
  verdict text check (verdict in ('reasonable','questionable','insufficient_info')),
  recommendation text not null,
  factors jsonb not null default '{}'::jsonb,
  used_company_history boolean not null default false,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  foreign key (task_id, company_id) references public.tasks(id, company_id) on delete cascade,
  foreign key (deadline_request_id) references public.task_deadline_change_requests(id) on delete cascade
);
create index ai_recs_task_idx on public.ai_recommendations(task_id, created_at desc);

-- ---------- notifications --------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_idx on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;

create table public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null,
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id, type)
);

create table public.email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  to_email text not null,
  template text not null,
  subject text not null,
  status email_status not null default 'queued',
  error text,
  provider_message_id text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- A given email (dedupe_key) is only ever recorded once as queued/sent per recipient.
create unique index email_dedupe_idx on public.email_delivery_logs(to_email, dedupe_key)
  where dedupe_key is not null and status in ('queued','sent');

-- ---------- audit & rate limiting ------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid,
  actor_id uuid,
  action text not null,
  entity_table text,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_logs_company_idx on public.audit_logs(company_id, created_at desc);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['profiles','companies','departments','company_memberships','tasks',
    'unplanned_work_entries','task_deadline_change_requests','standup_reports','weekly_reports']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
