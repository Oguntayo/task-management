-- The auth trigger only creates profiles for users added after migration 0002.
-- Backfill existing email users so their company.created_by FK can resolve.
insert into public.profiles (id, email, full_name)
select
  u.id,
  u.email,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
from auth.users u
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
