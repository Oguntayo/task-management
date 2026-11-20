-- =====================================================================
-- Workline: Row Level Security + grants
-- Principle: deny by default. Writes that must be validated or recorded
-- (approvals, deadlines, reviews, logs) have NO direct write policy and
-- go through SECURITY DEFINER functions. service_role bypasses RLS.
-- =====================================================================

-- lock everything down first
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- reference data ------------------------------------------
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
create policy ref_roles_read on public.roles for select to authenticated using (true);
create policy ref_perms_read on public.permissions for select to authenticated using (true);
create policy ref_roleperms_read on public.role_permissions for select to authenticated using (true);

-- ---------- profiles --------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, avatar_public_id) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_company_with(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- companies -------------------------------------------------
grant select on public.companies to authenticated;
grant update (name, industry, timezone, logo_url, logo_public_id, settings) on public.companies to authenticated;
create policy companies_select on public.companies for select to authenticated
  using (public.is_member(id) or public.is_super_admin()
         or exists (select 1 from public.company_memberships m
                    where m.company_id = companies.id and m.user_id = auth.uid() and m.status = 'active'));
create policy companies_update on public.companies for update to authenticated
  using (public.has_role(id, 'admin')) with check (public.has_role(id, 'admin'));

-- ---------- departments & categories ----------------------------------
grant select, insert, update, delete on public.departments, public.task_categories to authenticated;
create policy departments_select on public.departments for select to authenticated using (public.is_member(company_id));
create policy departments_write on public.departments for all to authenticated
  using (public.has_role(company_id, 'admin')) with check (public.has_role(company_id, 'admin'));
create policy categories_select on public.task_categories for select to authenticated using (public.is_member(company_id));
create policy categories_write on public.task_categories for all to authenticated
  using (public.has_role(company_id, 'admin')) with check (public.has_role(company_id, 'admin'));

-- ---------- memberships & roles ---------------------------------------
grant select, update on public.company_memberships to authenticated;
create policy memberships_select on public.company_memberships for select to authenticated
  using (public.is_member(company_id) or user_id = auth.uid());
create policy memberships_update on public.company_memberships for update to authenticated
  using (public.has_role(company_id, 'admin')) with check (public.has_role(company_id, 'admin'));

grant select, insert, delete on public.membership_roles to authenticated;
create policy membership_roles_select on public.membership_roles for select to authenticated
  using (public.is_member(company_id)
         or exists (select 1 from public.company_memberships m
                    where m.id = membership_id and m.user_id = auth.uid()));
create policy membership_roles_insert on public.membership_roles for insert to authenticated
  with check (public.has_role(company_id, 'admin'));
create policy membership_roles_delete on public.membership_roles for delete to authenticated
  using (public.has_role(company_id, 'admin'));

grant select, insert, update on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_role(company_id, 'admin'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.has_role(company_id, 'admin') and invited_by = auth.uid());
create policy invitations_update on public.invitations for update to authenticated
  using (public.has_role(company_id, 'admin')) with check (public.has_role(company_id, 'admin'));

-- ---------- tasks -----------------------------------------------------
grant select, insert, update on public.tasks to authenticated;
-- creator_id check is evaluated inline so INSERT ... RETURNING works (a STABLE function
-- would not see the row being inserted in the same statement).
create policy tasks_select on public.tasks for select to authenticated
  using ((creator_id = auth.uid() and public.is_member(company_id)) or public.can_view_task(id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_member(company_id) and creator_id = auth.uid());
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_view_task(id)) with check (public.is_member(company_id));

grant select, insert, delete on public.task_assignees, public.task_dependencies to authenticated;
create policy assignees_select on public.task_assignees for select to authenticated using (public.can_view_task(task_id));
create policy assignees_insert on public.task_assignees for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_id
                      and (t.creator_id = auth.uid() or public.is_manager(t.company_id))));
create policy assignees_delete on public.task_assignees for delete to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id
                 and (t.creator_id = auth.uid() or public.is_manager(t.company_id))));
create policy deps_select on public.task_dependencies for select to authenticated using (public.can_view_task(task_id));
create policy deps_insert on public.task_dependencies for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_id
                      and (t.creator_id = auth.uid() or public.is_manager(t.company_id))));
create policy deps_delete on public.task_dependencies for delete to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id
                 and (t.creator_id = auth.uid() or public.is_manager(t.company_id))));

-- ---------- unplanned work --------------------------------------------
grant select, insert, update on public.unplanned_work_entries to authenticated;
create policy unplanned_select on public.unplanned_work_entries for select to authenticated
  using (public.is_member(company_id) and (user_id = auth.uid() or public.is_leader(company_id)));
create policy unplanned_insert on public.unplanned_work_entries for insert to authenticated
  with check (public.is_member(company_id) and user_id = auth.uid());
create policy unplanned_update on public.unplanned_work_entries for update to authenticated
  using (user_id = auth.uid() and public.is_member(company_id))
  with check (user_id = auth.uid());

-- ---------- comments & attachments (task or unplanned parent) ---------
grant select, insert on public.task_comments to authenticated;
grant select, insert, delete on public.task_attachments to authenticated;

create policy comments_select on public.task_comments for select to authenticated
  using ((task_id is not null and public.can_view_task(task_id))
      or (unplanned_entry_id is not null and exists (
            select 1 from public.unplanned_work_entries u where u.id = unplanned_entry_id)));
create policy comments_insert on public.task_comments for insert to authenticated
  with check (author_id = auth.uid()
      and ((task_id is not null and public.can_view_task(task_id))
        or (unplanned_entry_id is not null and exists (
              select 1 from public.unplanned_work_entries u where u.id = unplanned_entry_id))));

create policy attachments_select on public.task_attachments for select to authenticated
  using ((task_id is not null and public.can_view_task(task_id))
      or (unplanned_entry_id is not null and exists (
            select 1 from public.unplanned_work_entries u where u.id = unplanned_entry_id)));
create policy attachments_insert on public.task_attachments for insert to authenticated
  with check (uploaded_by = auth.uid()
      and ((task_id is not null and public.can_view_task(task_id))
        or (unplanned_entry_id is not null and exists (
              select 1 from public.unplanned_work_entries u where u.id = unplanned_entry_id and u.user_id = auth.uid()))));
create policy attachments_delete on public.task_attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_manager(company_id));

-- ---------- append-only history: read only ----------------------------
grant select on public.task_activity_logs, public.task_approvals,
                public.task_deadline_change_requests to authenticated;
create policy activity_select on public.task_activity_logs for select to authenticated
  using ((task_id is not null and public.can_view_task(task_id))
      or (unplanned_entry_id is not null and exists (
            select 1 from public.unplanned_work_entries u where u.id = unplanned_entry_id)));
create policy approvals_select on public.task_approvals for select to authenticated
  using (public.can_view_task(task_id));
create policy deadline_req_select on public.task_deadline_change_requests for select to authenticated
  using (public.can_view_task(task_id));

-- ---------- blockers --------------------------------------------------
grant select, insert, update on public.task_blockers to authenticated;
create policy blockers_select on public.task_blockers for select to authenticated using (public.can_view_task(task_id));
create policy blockers_insert on public.task_blockers for insert to authenticated
  with check (reported_by = auth.uid() and public.can_view_task(task_id));
create policy blockers_update on public.task_blockers for update to authenticated
  using (public.can_view_task(task_id)
         and (reported_by = auth.uid() or responsible_user_id = auth.uid() or public.is_leader(company_id)))
  with check (public.is_member(company_id));

-- ---------- reports ---------------------------------------------------
grant select, insert, update on public.standup_reports, public.weekly_reports to authenticated;
create policy standup_select on public.standup_reports for select to authenticated
  using (public.is_member(company_id) and (user_id = auth.uid() or public.is_leader(company_id)));
create policy standup_insert on public.standup_reports for insert to authenticated
  with check (public.is_member(company_id) and user_id = auth.uid());
create policy standup_update on public.standup_reports for update to authenticated
  using (user_id = auth.uid() and status = 'draft') with check (user_id = auth.uid());
create policy weekly_select on public.weekly_reports for select to authenticated
  using (public.is_member(company_id) and (user_id = auth.uid() or public.is_leader(company_id)));
create policy weekly_insert on public.weekly_reports for insert to authenticated
  with check (public.is_member(company_id) and user_id = auth.uid());
create policy weekly_update on public.weekly_reports for update to authenticated
  using (user_id = auth.uid() and status = 'draft') with check (user_id = auth.uid());

-- ---------- AI (written by service role only) -------------------------
grant select on public.ai_task_estimates, public.ai_recommendations to authenticated;
create policy ai_estimates_select on public.ai_task_estimates for select to authenticated
  using (public.can_view_task(task_id));
create policy ai_recs_select on public.ai_recommendations for select to authenticated
  using ((task_id is not null and public.can_view_task(task_id))
      or (task_id is null and public.is_member(company_id)
          and (subject_user_id = auth.uid() or public.is_manager(company_id))));

-- ---------- notifications ---------------------------------------------
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

grant select, insert, update on public.notification_preferences to authenticated;
create policy prefs_select on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_insert on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(company_id));
create policy prefs_update on public.notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(company_id));

grant select on public.email_delivery_logs, public.audit_logs to authenticated;
create policy email_logs_select on public.email_delivery_logs for select to authenticated
  using (company_id is not null and public.has_role(company_id, 'admin'));
create policy audit_select on public.audit_logs for select to authenticated
  using (company_id is not null and public.has_role(company_id, 'admin'));
-- rate_limits: RLS on, no policies, no grants => service role only

-- ---------- function privileges ---------------------------------------
grant execute on function
  public.is_super_admin(), public.is_member(uuid), public.has_any_role(uuid, text[]),
  public.has_role(uuid, text), public.is_manager(uuid), public.is_leader(uuid),
  public.can_view_task(uuid), public.shares_company_with(uuid), public._priv(),
  public.company_setting(uuid, text),
  public.create_company(text, text, text, text), public.accept_invitation(text),
  public.invitation_hash(text),
  public.request_deadline_extension(uuid, timestamptz, text),
  public.respond_deadline_clarification(uuid, text), public.withdraw_deadline_request(uuid),
  public.decide_deadline_request(uuid, text, text),
  public.decide_task_approval(uuid, approval_decision, text, task_priority, timestamptz),
  public.review_unplanned_entry(uuid, text, text),
  public.platform_stats(), public.platform_list_companies(),
  public.platform_set_company_status(uuid, company_status)
to authenticated;

grant execute on function public.consume_rate_limit(text, int, int) to service_role;
