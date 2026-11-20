-- Ensure PostgREST exposes the rate limiter RPC on projects where earlier
-- migrations were not fully applied, then refresh its schema cache.
create or replace function public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

revoke all on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, int) to service_role;

-- Keep the argument names aligned with the named RPC call from onboarding.
create or replace function public.create_company(
  p_name text, p_slug text, p_timezone text default 'UTC', p_industry text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

revoke all on function public.create_company(text, text, text, text) from public, anon;
grant execute on function public.create_company(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
