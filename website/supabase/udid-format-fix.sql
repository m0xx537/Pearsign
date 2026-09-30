-- Fix UDID storage for modern iPhones and iPads. Retains all existing rows.
-- Run the whole file in the Supabase SQL Editor before retrying on your device.
begin;

alter table public.pear_sign_device_udids
  drop constraint if exists pear_sign_device_udids_udid_check;
alter table public.pear_sign_device_udids
  add constraint pear_sign_device_udids_udid_check
  check (udid ~ '^([A-F0-9]{40}|[A-F0-9]{8}-[A-F0-9]{16})$');

create or replace function public.complete_pear_sign_udid_enrollment(p_token_hash text, p_udid text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_user_id uuid;
begin
  if p_udid is null or p_udid !~ '^([A-F0-9]{40}|[A-F0-9]{8}-[A-F0-9]{16})$' then
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

-- CREATE OR REPLACE preserves the existing service-role-only permissions.

commit;
