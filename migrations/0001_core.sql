-- CORE: organisations, users, invitations, audit. Adapted from the Alchemy starter kit for Neon (Neon Auth + Data API).
--
-- Differences from the Supabase kit:
--   * Neon's `authenticated` role cannot use Neon's `auth` schema directly, so every rule reaches the signed-in person
--     through app.uid() / app.my_email(), which run with the database owner's rights.
--   * Users live in neon_auth."user" (managed by Neon Auth). `profiles` keeps a copy of the email and name for screens.
--   * Roles are: superuser, admin (read and write), reviewer (review only).
--   * Trigger functions are security definer, so they work for people who cannot read the auth schema themselves.
--
-- Pattern: every record belongs to an organisation. A person belongs to organisations through `memberships` (with a role).
-- Row-level security says "you can only touch rows of organisations you are an active member of, and only write if your role
-- allows". Nothing is deleted (archive instead). Every insert, update and delete is written to `audit_log`, which nobody can edit.

create schema if not exists app;

-- Functions are executable by PUBLIC by default in Postgres. Turn that off for everything created from here on.
alter default privileges revoke execute on functions from public;

grant usage on schema public to authenticated;
grant usage on schema app to authenticated;

-- ---- Who is signed in --------------------------------------------------------------------------------------------
create or replace function app.uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  return auth.user_id()::uuid;
exception when others then
  return null;      -- no signed-in person (for example a script run by the database owner)
end $$;

create or replace function app.my_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email) from neon_auth."user" u where u.id = app.uid();
$$;

-- ---- Tables --------------------------------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  country     text not null default 'GB',
  timezone    text not null default 'Europe/London',
  locale      text not null default 'en-GB',
  currency    text not null default 'GBP',
  brand       jsonb not null default '{}'::jsonb,        -- { "colours": { "primary": "#FF0066", "accent": "#A8895B" }, "logo_url": "https://..." }
  terminology jsonb not null default '{}'::jsonb,
  settings    jsonb not null default '{}'::jsonb,        -- { "date_format": "dd-Mmm-yy", ... }
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  user_id         uuid not null,
  role            text not null check (role in ('superuser', 'admin', 'reviewer')),
  status          text not null default 'active' check (status in ('active', 'disabled', 'removed')),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  unique (organisation_id, user_id)
);

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  email           text not null,
  role            text not null check (role in ('superuser', 'admin', 'reviewer')),
  token           uuid not null unique default gen_random_uuid(),
  expires_at      timestamptz not null default now() + interval '14 days',
  accepted_at     timestamptz,
  accepted_by     uuid,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

create table public.audit_log (
  id              bigint generated always as identity primary key,
  organisation_id uuid,
  table_name      text not null,
  record_id       uuid,
  action          text not null,                          -- INSERT, UPDATE, DELETE
  actor_id        uuid,
  actor_label     text,                                   -- the person's email at the time
  occurred_at     timestamptz not null default now(),
  changed_fields  text[],
  old_data        jsonb,
  new_data        jsonb
);
create index audit_log_org_time on public.audit_log (organisation_id, occurred_at desc);
create index audit_log_record on public.audit_log (record_id);

-- ---- Helper functions (security definer, so row-level security can call them without recursing) ----------------
create or replace function app.member_orgs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.organisation_id from public.memberships m join public.organisations o on o.id = m.organisation_id and o.status = 'active'
   where m.user_id = app.uid() and m.status = 'active';
$$;
create or replace function app.write_orgs() returns setof uuid          -- may add and change records
language sql stable security definer set search_path = '' as $$
  select m.organisation_id from public.memberships m join public.organisations o on o.id = m.organisation_id and o.status = 'active'
   where m.user_id = app.uid() and m.status = 'active' and m.role in ('superuser', 'admin');
$$;
create or replace function app.admin_orgs() returns setof uuid          -- may see the audit log
language sql stable security definer set search_path = '' as $$
  select m.organisation_id from public.memberships m join public.organisations o on o.id = m.organisation_id and o.status = 'active'
   where m.user_id = app.uid() and m.status = 'active' and m.role in ('superuser', 'admin');
$$;
create or replace function app.config_orgs() returns setof uuid         -- may change settings and users
language sql stable security definer set search_path = '' as $$
  select m.organisation_id from public.memberships m join public.organisations o on o.id = m.organisation_id and o.status = 'active'
   where m.user_id = app.uid() and m.status = 'active' and m.role = 'superuser';
$$;
create or replace function app.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships mine join public.memberships theirs on theirs.organisation_id = mine.organisation_id
                  where mine.user_id = app.uid() and mine.status = 'active' and theirs.user_id = p_user);
$$;

-- ---- Triggers ------------------------------------------------------------------------------------------------
-- Stamps created/updated by and when, and refuses to move a row to another organisation.
create or replace function app.touch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := coalesce(app.uid(), new.created_by);
    new.updated_at := new.created_at; new.updated_by := new.created_by;
  else
    if (to_jsonb(new) ->> 'organisation_id') is distinct from (to_jsonb(old) ->> 'organisation_id') then
      raise exception 'organisation_id cannot be changed' using errcode = '42501';
    end if;
    new.created_at := old.created_at; new.created_by := old.created_by;
    new.updated_at := now(); new.updated_by := app.uid();
  end if;
  return new;
end $$;

-- Writes the audit row. Usage: create trigger x_audit after insert or update or delete on x for each row execute function app.audit_row('id');
-- An optional second argument is a comma list of columns to show as "(hidden)" in the log.
create or replace function app.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pk text := coalesce(tg_argv[0], 'id');
  v_mask text[] := case when coalesce(tg_argv[1], '') = '' then '{}'::text[] else string_to_array(tg_argv[1], ',') end;
  v_old jsonb; v_new jsonb; v_row jsonb; v_changed text[]; v_org uuid; k text;
begin
  if tg_op = 'INSERT' then v_new := to_jsonb(new); v_row := v_new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_row := v_new;
    select coalesce(array_agg(t.k order by t.k), '{}') into v_changed from jsonb_object_keys(v_new) as t(k)
     where t.k not in ('updated_at', 'updated_by') and (v_new -> t.k) is distinct from (v_old -> t.k);
    if coalesce(array_length(v_changed, 1), 0) = 0 then return new; end if;   -- nothing really changed
  else v_old := to_jsonb(old); v_row := v_old; end if;
  v_org := case when tg_table_name = 'organisations' then (v_row ->> 'id')::uuid else (v_row ->> 'organisation_id')::uuid end;
  foreach k in array v_mask loop
    if v_old is not null and v_old ->> k is not null then v_old := jsonb_set(v_old, array[k], '"(hidden)"'); end if;
    if v_new is not null and v_new ->> k is not null then v_new := jsonb_set(v_new, array[k], '"(hidden)"'); end if;
  end loop;
  insert into public.audit_log (organisation_id, table_name, record_id, action, actor_id, actor_label, changed_fields, old_data, new_data)
  values (v_org, tg_table_name, (v_row ->> v_pk)::uuid, tg_op, app.uid(), coalesce(app.my_email(), 'system'), v_changed, v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function app.audit_immutable() returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
create trigger audit_log_no_change before update or delete on public.audit_log for each row execute function app.audit_immutable();

-- An organisation must always keep at least one active superuser.
create or replace function app.protect_last_superuser() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'superuser' and old.status = 'active' and (tg_op = 'DELETE' or new.role <> 'superuser' or new.status <> 'active')
     and not exists (select 1 from public.memberships m where m.organisation_id = old.organisation_id and m.id <> old.id and m.role = 'superuser' and m.status = 'active') then
    raise exception 'An organisation must keep at least one active superuser' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger organisations_touch before insert or update on public.organisations for each row execute function app.touch();
create trigger memberships_touch   before insert or update on public.memberships   for each row execute function app.touch();
create trigger invitations_touch   before insert or update on public.invitations   for each row execute function app.touch();
create trigger organisations_audit after insert or update or delete on public.organisations for each row execute function app.audit_row('id');
create trigger memberships_audit   after insert or update or delete on public.memberships   for each row execute function app.audit_row('id');
create trigger invitations_audit   after insert or update or delete on public.invitations   for each row execute function app.audit_row('id');
create trigger memberships_protect_superuser before update or delete on public.memberships for each row execute function app.protect_last_superuser();

-- ---- Row-level security and grants ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.organisations enable row level security;
alter table public.memberships   enable row level security;
alter table public.invitations   enable row level security;
alter table public.audit_log     enable row level security;

revoke all on public.profiles, public.organisations, public.memberships, public.invitations, public.audit_log from authenticated, anonymous;
grant select on public.profiles, public.organisations, public.memberships, public.invitations, public.audit_log to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (settings, brand) on public.organisations to authenticated;
grant update (role, status) on public.memberships to authenticated;
grant insert (organisation_id, email, role) on public.invitations to authenticated;
grant update (revoked_at) on public.invitations to authenticated;

create policy profiles_select      on public.profiles      for select to authenticated using (id = app.uid() or app.shares_org_with(id));
create policy profiles_update      on public.profiles      for update to authenticated using (id = app.uid()) with check (id = app.uid());
create policy organisations_select on public.organisations for select to authenticated using (id in (select app.member_orgs()));
create policy organisations_update on public.organisations for update to authenticated using (id in (select app.config_orgs())) with check (id in (select app.config_orgs()));
create policy memberships_select   on public.memberships   for select to authenticated using (organisation_id in (select app.member_orgs()));
create policy memberships_update   on public.memberships   for update to authenticated using (organisation_id in (select app.config_orgs())) with check (organisation_id in (select app.config_orgs()));
create policy invitations_select   on public.invitations   for select to authenticated using (organisation_id in (select app.config_orgs()));
create policy invitations_insert   on public.invitations   for insert to authenticated with check (organisation_id in (select app.config_orgs()));
create policy invitations_update   on public.invitations   for update to authenticated using (organisation_id in (select app.config_orgs())) with check (organisation_id in (select app.config_orgs()));
create policy audit_log_select     on public.audit_log     for select to authenticated using (organisation_id in (select app.admin_orgs()));
-- No insert/delete policies on purpose: memberships are created only by accept_invitation(), audit rows only by the trigger.

grant execute on function app.member_orgs(), app.write_orgs(), app.admin_orgs(), app.config_orgs(), app.shares_org_with(uuid), app.uid(), app.my_email() to authenticated;

-- ---- Joining an organisation, and creating one ---------------------------------------------------------------
-- The invitation is a secret link (token) made by a superuser for one email address. The person signs up with that address
-- and the token joins them. (Neon cannot yet restrict sign-up, so the database treats anyone without a membership as having no access.)
create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_inv public.invitations; v_email text := app.my_email(); v_name text;
begin
  if app.uid() is null or v_email is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into v_inv from public.invitations where token = p_token for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at < now() or lower(v_inv.email) is distinct from v_email then
    raise exception 'Invitation is invalid or has expired' using errcode = 'P0001';
  end if;
  select u.name into v_name from neon_auth."user" u where u.id = app.uid();
  insert into public.profiles (id, email, display_name) values (app.uid(), v_email, coalesce(nullif(trim(v_name), ''), split_part(v_email, '@', 1)))
    on conflict (id) do update set email = excluded.email;
  insert into public.memberships (organisation_id, user_id, role) values (v_inv.organisation_id, app.uid(), v_inv.role)
    on conflict (organisation_id, user_id) do update set role = excluded.role, status = 'active';
  update public.invitations set accepted_at = now(), accepted_by = app.uid() where id = v_inv.id;
  return v_inv.organisation_id;
end $$;
revoke all on function public.accept_invitation(uuid) from public, anonymous;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- Organisations are created by the database owner only (run from the SQL editor or by Claude), never from the app.
-- It makes the organisation and an invitation for its first superuser, and returns the invitation token.
create or replace function public.create_organisation(p_name text, p_slug text, p_superuser_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_token uuid;
begin
  insert into public.organisations (name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into v_org;
  insert into public.invitations (organisation_id, email, role) values (v_org, lower(trim(p_superuser_email)), 'superuser') returning token into v_token;
  return jsonb_build_object('organisation_id', v_org, 'invitation_token', v_token);
end $$;
revoke all on function public.create_organisation(text, text, text) from public, authenticated, anonymous;
