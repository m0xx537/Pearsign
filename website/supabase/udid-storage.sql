-- Run this once in Supabase Dashboard → SQL Editor.
-- Stores one validated device UDID per signed-in Pearsign account.

create table if not exists public.pear_sign_device_udids (
  user_id uuid primary key references auth.users (id) on delete cascade,
  udid text not null check (udid ~ '^[A-F0-9]{40}$'),
  created_at timestamptz not null default now()
);

alter table public.pear_sign_device_udids enable row level security;

revoke all on table public.pear_sign_device_udids from public, anon, authenticated;
grant select, insert, update, delete on table public.pear_sign_device_udids to authenticated;

drop policy if exists "Users can read their own device UDID" on public.pear_sign_device_udids;
create policy "Users can read their own device UDID"
  on public.pear_sign_device_udids for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can save their own device UDID" on public.pear_sign_device_udids;
create policy "Users can save their own device UDID"
  on public.pear_sign_device_udids for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own device UDID" on public.pear_sign_device_udids;
create policy "Users can update their own device UDID"
  on public.pear_sign_device_udids for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own device UDID" on public.pear_sign_device_udids;
create policy "Users can remove their own device UDID"
  on public.pear_sign_device_udids for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Short-lived, one-time links associate Apple's profile response with the
-- account that requested it. Only the server's Supabase secret key can use this table.
create table if not exists public.pear_sign_udid_enrollments (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.pear_sign_udid_enrollments enable row level security;
create unique index if not exists pear_sign_udid_enrollments_user_id_key
  on public.pear_sign_udid_enrollments (user_id);
revoke all on table public.pear_sign_udid_enrollments from public, anon, authenticated;
grant select, insert, update, delete on table public.pear_sign_udid_enrollments to service_role;

create or replace function public.complete_pear_sign_udid_enrollment(p_token_hash text, p_udid text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_user_id uuid;
begin
  if p_udid !~ '^[A-F0-9]{40}$' then
    return false;
  end if;

  delete from public.pear_sign_udid_enrollments
  where token_hash = p_token_hash and expires_at > now()
  returning user_id into requested_user_id;

  if requested_user_id is null then
    return false;
  end if;

  insert into public.pear_sign_device_udids (user_id, udid)
  values (requested_user_id, p_udid)
  on conflict (user_id) do update set udid = excluded.udid;

  return true;
end;
$$;

revoke all on function public.complete_pear_sign_udid_enrollment(text, text) from public, anon, authenticated;
grant execute on function public.complete_pear_sign_udid_enrollment(text, text) to service_role;
