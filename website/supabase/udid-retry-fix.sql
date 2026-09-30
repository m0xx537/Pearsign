-- Keep each profile request independent and allow safe iOS callback retries.
-- Existing saved device UDIDs and account permissions are retained.
begin;

alter table public.pear_sign_udid_enrollments
  add column if not exists completed_udid text,
  add column if not exists completed_at timestamptz;

-- Starting another download must not invalidate an earlier downloaded profile.
drop index if exists public.pear_sign_udid_enrollments_user_id_key;
create index if not exists pear_sign_udid_enrollments_expires_at_idx
  on public.pear_sign_udid_enrollments (expires_at);

create or replace function public.complete_pear_sign_udid_enrollment(p_token_hash text, p_udid text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  enrollment public.pear_sign_udid_enrollments%rowtype;
begin
  if p_udid is null or p_udid !~ '^([A-F0-9]{40}|[A-F0-9]{8}-[A-F0-9]{16})$' then
    return false;
  end if;

  -- Serialize simultaneous responses for the same request. The completion
  -- record and the account UDID are committed together, or neither is saved.
  select * into enrollment
  from public.pear_sign_udid_enrollments
  where token_hash = p_token_hash and expires_at > now()
  for update;

  if not found then
    return false;
  end if;

  -- A retry can acknowledge the same device only. It cannot register a second
  -- device or overwrite a later manual change to the account's saved UDID.
  if enrollment.completed_at is not null then
    return enrollment.completed_udid = p_udid;
  end if;

  insert into public.pear_sign_device_udids (user_id, udid)
  values (enrollment.user_id, p_udid)
  on conflict (user_id) do update set udid = excluded.udid;

  update public.pear_sign_udid_enrollments
  set completed_udid = p_udid, completed_at = now()
  where token_hash = p_token_hash;

  return true;
end;
$$;

-- CREATE OR REPLACE preserves the existing service-role-only permissions.
commit;
