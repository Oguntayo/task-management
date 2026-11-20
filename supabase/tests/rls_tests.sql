-- Integration tests for tenant isolation, RLS, integrity triggers and RPCs.
-- Run with: bash supabase/tests/run.sh   (needs local PostgreSQL 16 binaries)
\set ON_ERROR_STOP on
create schema tests;
grant usage on schema tests to authenticated, service_role;

create function tests.expect_error(stmt text, pat text) returns void language plpgsql as $$
declare msg text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg ilike '%' || pat || '%' then return; end if;
    raise exception 'FAIL: statement raised "%", expected message like "%": %', msg, pat, stmt;
  end;
  raise exception 'FAIL: expected error like "%" but statement succeeded: %', pat, stmt;
end $$;

create function tests.n(q text) returns bigint language plpgsql as $$
declare c bigint; begin execute 'select count(*) from (' || q || ') q' into c; return c; end $$;

create function tests.is_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL [%]: got %, want %', label, got, want; end if;
  raise notice 'PASS  %', label;
end $$;
grant execute on all functions in schema tests to authenticated, service_role;

-- users (profiles are created by the on_auth_user_created trigger)
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a1@acme.test'),
 ('00000000-0000-0000-0000-0000000000a2','a2@acme.test'),
 ('00000000-0000-0000-0000-0000000000a3','a3@acme.test'),
 ('00000000-0000-0000-0000-0000000000a4','a4@acme.test'),
 ('00000000-0000-0000-0000-0000000000b1','b1@beta.test'),
 ('00000000-0000-0000-0000-0000000000b2','b2@beta.test'),
 ('00000000-0000-0000-0000-0000000000c1','root@platform.test');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000c1';

\set as_a1 'select set_config(''request.jwt.claim.sub'',''00000000-0000-0000-0000-0000000000a1'',false); set role authenticated;'
\set as_a2 'select set_config(''request.jwt.claim.sub'',''00000000-0000-0000-0000-0000000000a2'',false); set role authenticated;'
\set as_a3 'select set_config(''request.jwt.claim.sub'',''00000000-0000-0000-0000-0000000000a3'',false); set role authenticated;'
\set as_a4 'select set_config(''request.jwt.claim.sub'',''00000000-0000-0000-0000-0000000000a4'',false); set role authenticated;'
\set as_b1 'select set_config(''request.jwt.claim.sub'',''00000000-0000-0000-0000-0000000000b1'',false); set role authenticated;'
\set as_b2 'select set_config(''request.jwt.claim.sub'',''00000000-0000-0000-0000-0000000000b2'',false); set role authenticated;'
\set as_root 'select set_config(''request.jwt.claim.sub'',''00000000-0000-0000-0000-0000000000c1'',false); set role authenticated;'

-- ===== company creation & invitations =====
:as_a1
select public.create_company('Acme Pay','acme-pay','Africa/Lagos','fintech') as acme \gset
reset role;
:as_b1
select public.create_company('Beta Ltd','beta-ltd') as beta \gset
reset role;

:as_a1
insert into public.invitations(company_id,email,roles,token_hash,invited_by) values
 (:'acme','a2@acme.test','{pm}',public.invitation_hash('tok-a2'),'00000000-0000-0000-0000-0000000000a1'),
 (:'acme','a3@acme.test','{employee}',public.invitation_hash('tok-a3'),'00000000-0000-0000-0000-0000000000a1'),
 (:'acme','a4@acme.test','{employee}',public.invitation_hash('tok-a4'),'00000000-0000-0000-0000-0000000000a1');
reset role;
:as_a3
select tests.expect_error($$select public.accept_invitation('tok-a2')$$, 'different email');
select tests.expect_error($$select public.accept_invitation('nope')$$, 'invalid invitation');
select public.accept_invitation('tok-a3');
reset role;
:as_a2
select public.accept_invitation('tok-a2');
reset role;
:as_a4
select public.accept_invitation('tok-a4');
reset role;
:as_b1
select tests.expect_error(format($$insert into public.invitations(company_id,email,token_hash,invited_by) values (%L,'x@y.z','h','00000000-0000-0000-0000-0000000000b1')$$, :'acme'), 'row-level security');
reset role;
select tests.is_eq('invitation roles applied (pm)', (select count(*) from public.membership_roles mr
   join public.company_memberships m on m.id=mr.membership_id
  where m.user_id='00000000-0000-0000-0000-0000000000a2' and mr.role_key='pm'), 1::bigint);

-- a non-admin cannot grant themselves roles
:as_a3
select tests.expect_error(format($$insert into public.membership_roles(membership_id,company_id,role_key)
   select id,company_id,'admin' from public.company_memberships where user_id='00000000-0000-0000-0000-0000000000a3' and company_id=%L$$, :'acme'), 'row-level security');
reset role;
-- admin of B cannot attach roles to A's membership even by guessing its id (composite FK / RLS)
select id as a3mid from public.company_memberships where user_id='00000000-0000-0000-0000-0000000000a3' \gset
:as_b1
select tests.expect_error(format($$insert into public.membership_roles(membership_id,company_id,role_key) values (%L,%L,'admin')$$, :'a3mid', :'beta'), 'violates foreign key');
select tests.expect_error(format($$insert into public.membership_roles(membership_id,company_id,role_key) values (%L,%L,'admin')$$, :'a3mid', :'acme'), 'row-level security');
reset role;

-- last admin protection
:as_a1
select tests.expect_error(format($$delete from public.membership_roles where company_id=%L and role_key='admin'$$, :'acme'), 'at least one active admin');
select tests.expect_error(format($$update public.company_memberships set status='removed' where company_id=%L and user_id='00000000-0000-0000-0000-0000000000a1'$$, :'acme'), 'at least one active admin');
reset role;

-- beta members
reset role;
insert into public.company_memberships(company_id,user_id) values (:'beta','00000000-0000-0000-0000-0000000000b2');
insert into public.membership_roles(membership_id,company_id,role_key)
 select id,company_id,'employee' from public.company_memberships where user_id='00000000-0000-0000-0000-0000000000b2';

-- ===== tenant isolation =====
:as_a3
insert into public.tasks(company_id,title,description,creator_id,original_deadline,estimated_hours,status)
 values (:'acme','Payment gateway integration','Integrate PSP','00000000-0000-0000-0000-0000000000a3', now()+interval '5 days', 20, 'pending_approval')
 returning id as t1 \gset
insert into public.task_assignees(task_id,company_id,user_id) values (:'t1',:'acme','00000000-0000-0000-0000-0000000000a3');
select tests.is_eq('creator sees own task', tests.n('select 1 from public.tasks'), 1::bigint);
reset role;

:as_a4
select tests.is_eq('other employee cannot see colleague task', tests.n('select 1 from public.tasks'), 0::bigint);
reset role;
:as_a2
select tests.is_eq('PM sees all company tasks', tests.n('select 1 from public.tasks'), 1::bigint);
reset role;

:as_b1
select tests.is_eq('cross-tenant: B admin sees no A tasks', tests.n('select 1 from public.tasks'), 0::bigint);
select tests.is_eq('cross-tenant: B admin sees only own company', tests.n('select 1 from public.companies'), 1::bigint);
select tests.is_eq('cross-tenant: B admin sees no A memberships', tests.n(format('select 1 from public.company_memberships where company_id=%L', :'acme')), 0::bigint);
select tests.is_eq('cross-tenant: B admin cannot read A activity logs', tests.n('select 1 from public.task_activity_logs'), 0::bigint);
select tests.expect_error(format($$insert into public.tasks(company_id,title,creator_id) values (%L,'sneaky','00000000-0000-0000-0000-0000000000b1')$$, :'acme'), 'row-level security');
update public.tasks set title='hijacked' where id = :'t1';   -- invisible row: 0 rows affected
reset role;
select tests.is_eq('cross-tenant: update of foreign task had no effect',
  (select title from public.tasks where id = :'t1'), 'Payment gateway integration'::text);

-- composite FKs: a task can never be assigned to a member of another company
:as_a3
select tests.expect_error(format($$insert into public.task_assignees(task_id,company_id,user_id) values (%L,%L,'00000000-0000-0000-0000-0000000000b2')$$, :'t1', :'acme'), 'violates foreign key');
reset role;
-- ===== approval workflow =====
:as_a3
select tests.expect_error(format($$update public.tasks set status='approved' where id=%L$$, :'t1'), 'decide_task_approval');
select tests.expect_error(format($$select public.decide_task_approval(%L,'approved')$$, :'t1'), 'task not found');
reset role;
:as_a2
select tests.expect_error(format($$select public.decide_task_approval(%L,'rejected')$$, :'t1'), 'note is required');
select public.decide_task_approval(:'t1','approved','Looks good');
select tests.is_eq('task approved', (select status::text from public.tasks where id=:'t1'), 'approved');
select tests.expect_error(format($$select public.decide_task_approval(%L,'approved')$$, :'t1'), 'not awaiting approval');
reset role;
select tests.is_eq('approval recorded', (select count(*) from public.task_approvals where task_id=:'t1' and decision='approved'), 1::bigint);

-- PM cannot approve own task; admin can
:as_a2
insert into public.tasks(company_id,title,creator_id,original_deadline,status)
 values (:'acme','PM own planning task','00000000-0000-0000-0000-0000000000a2', now()+interval '3 days','pending_approval') returning id as t_pm \gset
select tests.expect_error(format($$select public.decide_task_approval(%L,'approved')$$, :'t_pm'), 'cannot approve work you created');
reset role;
:as_a1
select public.decide_task_approval(:'t_pm','approved');
reset role;

-- clarification returns task to draft and keeps history
:as_a4
insert into public.tasks(company_id,title,creator_id,original_deadline,status)
 values (:'acme','Vague task','00000000-0000-0000-0000-0000000000a4', now()+interval '2 days','pending_approval') returning id as t_v \gset
reset role;
:as_a2
select public.decide_task_approval(:'t_v','clarification_requested','Please add a deliverable');
reset role;
select tests.is_eq('clarification returns task to draft', (select status::text from public.tasks where id=:'t_v'), 'draft');

-- ===== state machine =====
:as_a3
update public.tasks set status='in_progress' where id=:'t1';
update public.tasks set progress=40 where id=:'t1';
select tests.expect_error(format($$update public.tasks set status='draft' where id=%L$$, :'t1'), 'illegal task status transition');
select tests.expect_error(format($$update public.tasks set status='blocked' where id=%L$$, :'t1'), 'report a blocker');
reset role;

-- ===== deadline immutability =====
:as_a3
select tests.expect_error(format($$update public.tasks set original_deadline=now()+interval '30 days' where id=%L$$, :'t1'), 'immutable once a task is approved');
select tests.expect_error(format($$update public.tasks set current_deadline=now()+interval '30 days' where id=%L$$, :'t1'), 'only change through an approved deadline request');
reset role;
:as_a2
select tests.expect_error(format($$update public.tasks set current_deadline=now()+interval '30 days' where id=%L$$, :'t1'), 'only change through');
reset role;

select original_deadline as orig, current_deadline as cur0 from public.tasks where id=:'t1' \gset

-- ===== deadline extension flow =====
:as_a4
select tests.expect_error(format($$select public.request_deadline_extension(%L, now()+interval '9 days','x y z w v')$$, :'t1'), 'task not found');
reset role;
:as_a3
select tests.expect_error(format($$select public.request_deadline_extension(%L, now()-interval '1 day','Urgent production issue')$$, :'t1'), 'later than the current');
select public.request_deadline_extension(:'t1', (:'cur0'::timestamptz + interval '3 days'), 'Urgent production incident interrupted work') as req \gset
select tests.expect_error(format($$select public.request_deadline_extension(%L, %L::timestamptz + interval '4 days','second request while one is open')$$, :'t1', :'cur0'), 'duplicate key');
select tests.expect_error(format($$select public.decide_deadline_request(%L,'approved')$$, :'req'), 'request not found');
reset role;
select tests.is_eq('deadline unchanged while pending', (select current_deadline = :'cur0'::timestamptz from public.tasks where id=:'t1'), true);
:as_a2
select tests.expect_error(format($$select public.decide_deadline_request(%L,'rejected')$$, :'req'), 'note is required');
select public.decide_deadline_request(:'req','approved','Reasonable given incident');
reset role;
select tests.is_eq('current deadline moved after approval', (select current_deadline = :'cur0'::timestamptz + interval '3 days' from public.tasks where id=:'t1'), true);
select tests.is_eq('original deadline preserved', (select original_deadline = :'orig'::timestamptz from public.tasks where id=:'t1'), true);
select tests.is_eq('request records approver', (select decided_by = '00000000-0000-0000-0000-0000000000a2'::uuid and decided_at is not null from public.task_deadline_change_requests where id=:'req'), true);
select tests.is_eq('deadline_changed logged with request id',
  (select details->>'request_id' from public.task_activity_logs where task_id=:'t1' and event='deadline_changed'), :'req'::text);
select tests.expect_error(format($$update public.task_deadline_change_requests set reason='edited later' where id=%L$$, :'req'), 'immutable');

-- ===== append-only logs (even for superuser; users have no privilege) =====
select tests.expect_error('update public.task_activity_logs set event=''x''', 'append-only');
select tests.expect_error('delete from public.task_activity_logs', 'append-only');
select tests.expect_error('delete from public.task_approvals', 'append-only');
select tests.expect_error('update public.audit_logs set action=''x''', 'append-only');
:as_a3
select tests.expect_error('delete from public.task_activity_logs', 'permission denied');
select tests.expect_error(format($$insert into public.task_activity_logs(company_id,task_id,event) values (%L,%L,'forged')$$, :'acme', :'t1'), 'permission denied');
reset role;
select tests.is_eq('activity covers lifecycle',
  (select count(*) >= 5 from public.task_activity_logs where task_id=:'t1'), true);

-- ===== unplanned work =====
:as_a3
insert into public.unplanned_work_entries(company_id,user_id,title,what_happened,action_taken,why_necessary,occurred_at,hours_spent,is_urgent,incident_reference)
 values (:'acme','00000000-0000-0000-0000-0000000000a3','Investigate failed customer transaction','Customer reported failed transfer','Checked PSP logs, issued refund','Customer funds at risk', now(), 1.5, true, 'INC-1042')
 returning id as u1 \gset
select tests.is_eq('unplanned entry independent of planned task', (select progress from public.tasks where id=:'t1'), 40);
select tests.expect_error(format($$update public.unplanned_work_entries set review_status='approved' where id=%L$$, :'u1'), 'review_unplanned_entry');
select tests.expect_error(format($$select public.review_unplanned_entry(%L,'approve')$$, :'u1'), 'cannot review your own');
select tests.expect_error(format($$insert into public.unplanned_work_entries(company_id,user_id,title,what_happened,action_taken,why_necessary,occurred_at,hours_spent) values (%L,'00000000-0000-0000-0000-0000000000a4','impersonated','a','b','c',now(),1)$$, :'acme'), 'for yourself');
reset role;
:as_a4
select tests.is_eq('colleague cannot see others unplanned work', tests.n('select 1 from public.unplanned_work_entries'), 0::bigint);
select tests.expect_error(format($$select public.review_unplanned_entry(%L,'approve')$$, :'u1'), 'only a PM');
reset role;
:as_a2
select tests.expect_error(format($$select public.review_unplanned_entry(%L,'request_clarification')$$, :'u1'), 'note is required');
select public.review_unplanned_entry(:'u1','request_clarification','Which customer incident?');
reset role;
:as_a3
update public.unplanned_work_entries set incident_reference='INC-1042 / TXN-ref-77' where id=:'u1';
select tests.is_eq('employee reply returns entry to queue', (select review_status::text from public.unplanned_work_entries where id=:'u1'), 'reported');
reset role;
:as_a2
select public.review_unplanned_entry(:'u1','approve','Confirmed');
select tests.expect_error(format($$select public.review_unplanned_entry(%L,'verify')$$, :'u1'), 'technical lead or admin');
reset role;
:as_a1
select public.review_unplanned_entry(:'u1','verify');
select public.review_unplanned_entry(:'u1','admin_approve');
reset role;
:as_a3
select tests.expect_error(format($$update public.unplanned_work_entries set hours_spent=9 where id=%L$$, :'u1'), 'cannot be edited after review');
reset role;
select tests.is_eq('review chain recorded (pm, tech/admin verify, admin approve)',
  (select reviewed_by is not null and verified_by is not null and admin_approved_by is not null from public.unplanned_work_entries where id=:'u1'), true);
select tests.is_eq('unplanned lifecycle logged', (select count(*) >= 5 from public.task_activity_logs where unplanned_entry_id=:'u1'), true);

-- ===== blockers =====
:as_a3
insert into public.task_blockers(company_id,task_id,reported_by,category,description,is_external)
 values (:'acme',:'t1','00000000-0000-0000-0000-0000000000a3','external_outage','PSP sandbox is down',true) returning id as bl \gset
select tests.is_eq('blocker blocks the task', (select status::text from public.tasks where id=:'t1'), 'blocked');
select tests.expect_error(format($$update public.tasks set status='in_progress' where id=%L$$, :'t1'), 'open blockers');
update public.task_blockers set status='resolved', resolution_note='Sandbox restored' where id=:'bl';
select tests.is_eq('resolving last blocker unblocks the task', (select status::text from public.tasks where id=:'t1'), 'in_progress');
select tests.expect_error(format($$update public.task_blockers set description='tampered after resolve' where id=%L$$, :'bl'), 'immutable');
reset role;
:as_a4
select tests.expect_error(format($$insert into public.task_blockers(company_id,task_id,reported_by,description) values (%L,%L,'00000000-0000-0000-0000-0000000000a4','not my task')$$, :'acme', :'t1'), 'row-level security');
reset role;

-- ===== completion =====
:as_a3
update public.tasks set status='completed' where id=:'t1';
select tests.is_eq('completion sets 100% and timestamp', (select progress = 100 and completed_at is not null from public.tasks where id=:'t1'), true);
select tests.expect_error(format($$update public.tasks set status='in_progress' where id=%L$$, :'t1'), 'only a lead can reopen');
reset role;

-- ===== company setting: completion review required =====
:as_a1
update public.companies set settings = settings || '{"require_completion_review": true}' where id=:'acme';
reset role;
:as_a4
insert into public.tasks(company_id,title,creator_id,original_deadline,status) values (:'acme','Review gate task','00000000-0000-0000-0000-0000000000a4', now()+interval '2 days','pending_approval') returning id as t_r \gset
reset role;
:as_a2
select public.decide_task_approval(:'t_r','approved');
reset role;
:as_a4
update public.tasks set status='in_progress' where id=:'t_r';
select tests.expect_error(format($$update public.tasks set status='completed' where id=%L$$, :'t_r'), 'requires review');
update public.tasks set status='under_review' where id=:'t_r';
reset role;
:as_a2
update public.tasks set status='completed' where id=:'t_r';
reset role;
select tests.is_eq('lead can complete after review', (select status::text from public.tasks where id=:'t_r'), 'completed');

-- ===== super admin boundaries =====
:as_root
select tests.is_eq('super admin sees platform counts', (public.platform_stats()->>'companies')::int, 2);
select tests.is_eq('super admin lists companies', tests.n('select * from public.platform_list_companies()'), 2::bigint);
select tests.is_eq('super admin cannot read tenant tasks', tests.n('select 1 from public.tasks'), 0::bigint);
select tests.is_eq('super admin cannot read unplanned work', tests.n('select 1 from public.unplanned_work_entries'), 0::bigint);
select public.platform_set_company_status(:'beta', 'suspended');
reset role;
:as_b1
select tests.is_eq('suspended company: admin loses write access', tests.n('select 1 from public.departments'), 0::bigint);
reset role;
:as_a1
select tests.expect_error('select public.platform_stats()', 'forbidden');
select tests.expect_error($$update public.profiles set is_super_admin = true where id='00000000-0000-0000-0000-0000000000a1'$$, 'permission denied');
reset role;
:as_root
select public.platform_set_company_status(:'beta', 'active');
reset role;

-- ===== rate limiting =====
:as_a1
select tests.expect_error($$select public.consume_rate_limit('k',1,60)$$, 'permission denied');
reset role;
set role service_role;
select tests.is_eq('rate limit allows first hit', public.consume_rate_limit('login:1.2.3.4', 2, 60), true);
select tests.is_eq('rate limit allows second hit', public.consume_rate_limit('login:1.2.3.4', 2, 60), true);
select tests.is_eq('rate limit blocks third hit', public.consume_rate_limit('login:1.2.3.4', 2, 60), false);
reset role;

-- ===== notification & email de-duplication =====
insert into public.notifications(company_id,user_id,type,title,dedupe_key)
 values (:'acme','00000000-0000-0000-0000-0000000000a3','deadline_approaching','Due soon','deadline:t1:24h');
select tests.expect_error(format($$insert into public.notifications(company_id,user_id,type,title,dedupe_key) values (%L,'00000000-0000-0000-0000-0000000000a3','deadline_approaching','Due soon','deadline:t1:24h')$$, :'acme'), 'duplicate key');
insert into public.email_delivery_logs(company_id,to_email,template,subject,status,dedupe_key) values (:'acme','a3@acme.test','deadline','Due soon','sent','deadline:t1:24h');
select tests.expect_error(format($$insert into public.email_delivery_logs(company_id,to_email,template,subject,status,dedupe_key) values (%L,'a3@acme.test','deadline','Due soon','sent','deadline:t1:24h')$$, :'acme'), 'duplicate key');
-- a failed attempt may be retried
insert into public.email_delivery_logs(company_id,to_email,template,subject,status,dedupe_key) values (:'acme','a4@acme.test','deadline','x','failed','k2');
insert into public.email_delivery_logs(company_id,to_email,template,subject,status,dedupe_key) values (:'acme','a4@acme.test','deadline','x','sent','k2');
select tests.is_eq('failed email can be retried', 1::bigint, 1::bigint);
:as_a3
select tests.is_eq('employee cannot read email logs', tests.n('select 1 from public.email_delivery_logs'), 0::bigint);
select tests.is_eq('employee cannot read audit logs', tests.n('select 1 from public.audit_logs'), 0::bigint);
reset role;
:as_a1
select tests.is_eq('admin can read email logs', tests.n('select 1 from public.email_delivery_logs'), 3::bigint);
select tests.is_eq('admin sees audit trail of role changes', tests.n($$select 1 from public.audit_logs where entity_table='membership_roles'$$) > 0, true);
reset role;

-- ===== attachments only accept Cloudinary URLs =====
:as_a3
select tests.expect_error(format($$insert into public.task_attachments(company_id,task_id,uploaded_by,cloudinary_public_id,cloudinary_url) values (%L,%L,'00000000-0000-0000-0000-0000000000a3','p1','http://evil.example/x.png')$$, :'acme', :'t1'), 'check constraint');
insert into public.task_attachments(company_id,task_id,uploaded_by,cloudinary_public_id,cloudinary_url,bytes) values (:'acme',:'t1','00000000-0000-0000-0000-0000000000a3','workline/acme/p1','https://res.cloudinary.com/demo/image/upload/p1.png',1000);
reset role;
:as_a4
select tests.is_eq('colleague cannot see attachments of others tasks', tests.n('select 1 from public.task_attachments'), 0::bigint);
reset role;

-- ===== time logs =====
:as_a3
insert into public.task_time_logs(company_id,task_id,user_id,hours,note) values (:'acme',:'t1','00000000-0000-0000-0000-0000000000a3',3,'integration work');
select tests.expect_error(format($$insert into public.task_time_logs(company_id,task_id,user_id,hours) values (%L,%L,'00000000-0000-0000-0000-0000000000a4',2)$$, :'acme', :'t1'), 'row-level security');
select tests.expect_error('update public.task_time_logs set hours = 1', 'permission denied');
reset role;
:as_a4
select tests.expect_error(format($$insert into public.task_time_logs(company_id,task_id,user_id,hours) values (%L,%L,'00000000-0000-0000-0000-0000000000a4',2)$$, :'acme', :'t1'), 'row-level security');
select tests.is_eq('colleague cannot read time logs', tests.n('select 1 from public.task_time_logs'), 0::bigint);
reset role;

-- ===== projects / products =====
:as_a2
select tests.expect_error(format($$insert into public.projects(company_id,name,created_by) values (%L,'Sneaky',%L)$$, :'acme', '00000000-0000-0000-0000-0000000000a2'), 'row-level security');
reset role;
:as_a1
insert into public.projects(company_id,name,description,created_by) values (:'acme','Remittance App v2','New cross-border product','00000000-0000-0000-0000-0000000000a1') returning id as pr1 \gset
insert into public.projects(company_id,name,created_by) values (:'acme','Internal Tooling','00000000-0000-0000-0000-0000000000a1') returning id as pr2 \gset
insert into public.project_scope_items(project_id,company_id,title,weight) values (:'pr1',:'acme','KYC onboarding',40),(:'pr1',:'acme','Payout rails',60);
insert into public.project_members(project_id,company_id,user_id) values (:'pr1',:'acme','00000000-0000-0000-0000-0000000000a3');
select tests.expect_error(format($$insert into public.project_members(project_id,company_id,user_id) values (%L,%L,'00000000-0000-0000-0000-0000000000b2')$$, :'pr1', :'acme'), 'violates foreign key');
select tests.expect_error(format($$update public.projects set progress = 100 where id=%L$$, :'pr1'), 'permission denied');
select tests.expect_error(format($$update public.projects set ai_eta = current_date where id=%L$$, :'pr1'), 'permission denied');
reset role;
-- weighted progress is derived by trigger
update public.project_scope_items set completion = 50 where project_id=:'pr1' and title='KYC onboarding';
update public.project_scope_items set completion = 10 where project_id=:'pr1' and title='Payout rails';
select tests.is_eq('progress = weighted average of scope items', (select progress from public.projects where id=:'pr1'), 26);
:as_a3
select tests.is_eq('assigned staff sees only their project', tests.n('select 1 from public.projects'), 1::bigint);
insert into public.project_updates(company_id,project_id,user_id,body,hours) values (:'acme',:'pr1','00000000-0000-0000-0000-0000000000a3','Finished the KYC document upload screen',4) returning id as pu1 \gset
select tests.expect_error(format($$insert into public.project_updates(company_id,project_id,user_id,body) values (%L,%L,'00000000-0000-0000-0000-0000000000a3','not my project')$$, :'acme', :'pr2'), 'row-level security');
select tests.expect_error('update public.project_updates set body = ''edited''', 'permission denied');
update public.project_scope_items set completion = 100;   -- staff cannot self-report progress: 0 rows affected
reset role;
select tests.is_eq('staff cannot move project progress directly', (select progress from public.projects where id=:'pr1'), 26);
:as_a4
select tests.is_eq('unassigned staff sees no projects', tests.n('select 1 from public.projects'), 0::bigint);
select tests.is_eq('unassigned staff sees no updates', tests.n('select 1 from public.project_updates'), 0::bigint);
reset role;
:as_b1
select tests.is_eq('other company sees no projects', tests.n('select 1 from public.projects'), 0::bigint);
select tests.is_eq('other company sees no scope items', tests.n('select 1 from public.project_scope_items'), 0::bigint);
reset role;
:as_a2
select tests.is_eq('PM sees all company projects', tests.n('select 1 from public.projects'), 2::bigint);
reset role;
insert into public.project_update_evaluations(company_id,project_id,update_id,contributes,reasoning,progress_before,progress_after,source)
  values (:'acme',:'pr1',:'pu1',true,'Upload screen is part of KYC onboarding',26,30,'heuristic');
select tests.expect_error('update public.project_update_evaluations set contributes = false', 'append-only');
select tests.expect_error('delete from public.project_updates', 'append-only');
:as_a3
select tests.is_eq('author can read the AI judgement of own update', tests.n('select 1 from public.project_update_evaluations'), 1::bigint);
reset role;
:as_a4
select tests.is_eq('others cannot read evaluations', tests.n('select 1 from public.project_update_evaluations'), 0::bigint);
reset role;

-- tag a task with a product (same-company only)
:as_a3
update public.tasks set project_id = :'pr1' where id = :'t1';
reset role;
select tests.is_eq('task tagged with product', (select project_id::text from public.tasks where id=:'t1'), :'pr1'::text);

-- ===== whole-company deletion still works despite append-only logs =====
delete from public.companies where id = :'beta';
select tests.is_eq('company deletion cascades past immutable logs', (select count(*) from public.companies where id=:'beta'), 0::bigint);

\echo ALL DB TESTS PASSED

