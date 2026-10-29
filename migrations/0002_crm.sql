-- CRM: parties (brand owners and customers, up to four levels), contacts, investments, meetings/notes, tasks.
-- Rules every table follows (see STYLE-GUIDE.md section 6): organisation_id on every row and never changeable; row-level
-- security on; NO delete policy (archive instead); touch trigger stamps who/when; audit trigger records every change.
--
-- Two rules are enforced here, not just on screen:
--   1. Every note, call, meeting, visit or decision ends with a follow-up: a task with a revisit date, OR "no follow-up needed"
--      with a reason from the list AND a written comment. Entries are only created through public.entry_log().
--   2. Closing a task asks what happens next in the same way (public.task_complete()).
-- Tasks and new entries cannot be written to directly: only through the functions below, which check the rules.

-- ---- Lists the superuser can edit (investment kinds, reasons for "no follow-up") --------------------------------
create table public.list_items (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  list            text not null check (list in ('investment_kind', 'no_followup_reason')),
  name            text not null,
  sort_order      integer not null default 0,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create unique index list_items_unique on public.list_items (organisation_id, list, lower(name)) where archived_at is null;

-- ---- Parties: the brand side (owner > brand > product) and the customer side (group > sub-group > pub) ---------------
create table public.parties (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  side            text not null check (side in ('brand', 'customer')),
  parent_id       uuid references public.parties(id),
  node_type       text not null check (node_type in ('brand_owner', 'brand', 'product', 'group', 'sub_group', 'site')),
  name            text not null,
  status          text not null default 'active' check (status in ('prospect', 'active', 'dormant', 'ended')),
  owner_id        uuid,                      -- the Alchemy person who looks after this relationship
  phone           text, email text, website text, address text, notes text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid,
  check ((side = 'brand' and node_type in ('brand_owner', 'brand', 'product')) or (side = 'customer' and node_type in ('group', 'sub_group', 'site')))
);
create index parties_org_side on public.parties (organisation_id, side, name);
create index parties_parent on public.parties (parent_id);
create unique index parties_name_unique on public.parties (organisation_id, side, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where archived_at is null;

create or replace function app.parties_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.parties; depth int := 1; cur uuid;
begin
  if tg_op = 'UPDATE' and (new.side is distinct from old.side) then raise exception 'A record cannot move between the brand and customer sides' using errcode = '23514'; end if;
  if new.parent_id is not null then
    select * into p from public.parties where id = new.parent_id;
    if not found or p.organisation_id <> new.organisation_id then raise exception 'The parent does not exist' using errcode = '23503'; end if;
    if p.side <> new.side then raise exception 'The parent must be on the same side (brand or customer)' using errcode = '23514'; end if;
    if p.archived_at is not null and new.archived_at is null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then raise exception 'The parent is archived' using errcode = '23514'; end if;
    -- what may sit under what
    if not ((p.node_type = 'brand_owner' and new.node_type in ('brand', 'product'))
         or (p.node_type = 'brand' and new.node_type = 'product')
         or (p.node_type = 'group' and new.node_type in ('sub_group', 'site'))
         or (p.node_type = 'sub_group' and new.node_type in ('sub_group', 'site'))) then
      raise exception 'That type cannot sit under a %', replace(p.node_type, '_', ' ') using errcode = '23514';
    end if;
    -- depth (at most four levels) and no loops
    cur := new.parent_id;
    while cur is not null loop
      depth := depth + 1;
      if tg_op = 'UPDATE' and cur = new.id then raise exception 'That would put a record underneath itself' using errcode = '23514'; end if;
      select parent_id into cur from public.parties where id = cur;
      if depth > 6 then exit; end if;
    end loop;
    if depth > 4 then raise exception 'Records can be at most four levels deep' using errcode = '23514'; end if;
  else
    if new.node_type not in ('brand_owner', 'group', 'site') then raise exception 'A % must sit under another record', replace(new.node_type, '_', ' ') using errcode = '23514'; end if;
  end if;
  if tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null
     and exists (select 1 from public.parties c where c.parent_id = new.id and c.archived_at is null) then
    raise exception 'Archive the records underneath it first' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger parties_check before insert or update on public.parties for each row execute function app.parties_check();

-- ---- Contacts ----------------------------------------------------------------------------------------------------
create table public.contacts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  party_id        uuid not null references public.parties(id),
  name            text not null,
  job_title       text, email text, phone text, mobile text,
  is_key          boolean not null default false,
  notes           text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create index contacts_party on public.contacts (party_id);
create index contacts_org on public.contacts (organisation_id, name);

-- ---- Investments (agreements), with payments, volume targets and reviews ----------------------------------------------
create table public.agreements (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id),
  party_id            uuid not null references public.parties(id),     -- who the money is with: a brand owner (money in) or a customer (money out)
  title               text not null,
  kind                text not null,                                    -- from the "investment kind" list
  status              text not null default 'proposed' check (status in ('proposed', 'agreed', 'live', 'ended', 'cancelled')),
  amount              numeric(14, 2) check (amount is null or amount >= 0),
  amount_basis        text not null default 'total' check (amount_basis in ('total', 'per_year')),
  start_on            date,
  end_on              date,
  has_exclusivity     boolean not null default false,
  exclusivity_detail  text,
  exclusivity_ends_on date,
  end_action          text,                                             -- what happens when it ends (renew, review, clawback ...)
  owner_id            uuid,                                             -- the Alchemy person who looks after it (gets the reminders)
  notes               text,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(), created_by uuid,
  updated_at          timestamptz not null default now(), updated_by uuid,
  check (end_on is null or start_on is null or end_on >= start_on)
);
create index agreements_party on public.agreements (party_id);
create index agreements_org on public.agreements (organisation_id, status);

create table public.agreement_payments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  agreement_id    uuid not null references public.agreements(id),
  due_on          date not null,
  amount          numeric(14, 2) not null check (amount >= 0),
  status          text not null default 'planned' check (status in ('planned', 'done')),   -- done = received (money in) or paid (money out)
  done_on         date,
  reference       text,
  note            text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create index agreement_payments_agreement on public.agreement_payments (agreement_id);

create table public.agreement_targets (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  agreement_id    uuid not null references public.agreements(id),
  scope           text not null default 'all_sales' check (scope in ('all_sales', 'product')),
  product         text,
  quantity        numeric(14, 2) not null check (quantity > 0),
  unit            text not null,                                        -- kegs, cases, litres, units, ...
  period_start    date not null,
  period_end      date not null,
  note            text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid,
  check (period_end >= period_start),
  check (scope = 'all_sales' or product is not null)
);
create index agreement_targets_agreement on public.agreement_targets (agreement_id);

-- A review is a person's judgement of how it is going (no actual volumes are held here). A shortfall is recorded by hand.
create table public.agreement_reviews (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations(id),
  agreement_id      uuid not null references public.agreements(id),
  reviewed_on       date not null default current_date,
  status            text not null check (status in ('on_track', 'at_risk', 'missed', 'met')),
  note              text,
  shortfall_amount  numeric(14, 2) check (shortfall_amount is null or shortfall_amount >= 0),
  shortfall_outcome text check (shortfall_outcome is null or shortfall_outcome in ('pending', 'waived', 'clawed_back', 'carried_forward')),
  archived_at       timestamptz,
  created_at        timestamptz not null default now(), created_by uuid,
  updated_at        timestamptz not null default now(), updated_by uuid
);
create index agreement_reviews_agreement on public.agreement_reviews (agreement_id);

-- ---- Entries: notes, calls, emails, meetings, visits and decisions -----------------------------------------------------
create table public.entries (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id),
  party_id            uuid not null references public.parties(id),
  contact_id          uuid references public.contacts(id),
  agreement_id        uuid references public.agreements(id),
  related_entry_id    uuid references public.entries(id),              -- an outcome note points at its meeting
  kind                text not null check (kind in ('note', 'call', 'email', 'meeting', 'visit', 'decision')),
  title               text not null,
  body                text,
  occurred_at         timestamptz not null default now(),              -- when it happened, or when the meeting is
  location            text,
  attendees           text,
  is_decision         boolean not null default false,
  meeting_status      text check (meeting_status in ('scheduled', 'held', 'cancelled')),
  followup_mode       text not null check (followup_mode in ('task', 'none')),
  no_followup_reason  text,
  no_followup_comment text,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(), created_by uuid,
  updated_at          timestamptz not null default now(), updated_by uuid,
  check (followup_mode = 'task' or (no_followup_reason is not null and length(trim(coalesce(no_followup_comment, ''))) >= 5)),
  check ((kind = 'meeting') = (meeting_status is not null))
);
create index entries_party on public.entries (party_id, occurred_at desc);
create index entries_org_time on public.entries (organisation_id, occurred_at desc);

-- ---- Tasks ---------------------------------------------------------------------------------------------------------
create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id),
  party_id            uuid references public.parties(id),
  contact_id          uuid references public.contacts(id),
  agreement_id        uuid references public.agreements(id),
  entry_id            uuid references public.entries(id),
  previous_task_id    uuid references public.tasks(id),               -- the task this one followed on from
  title               text not null,
  details             text,
  due_on              date not null,
  owner_id            uuid not null,
  status              text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  source              text not null default 'manual' check (source in ('manual', 'follow_up', 'auto')),
  auto_key            text,                                            -- reminders made by the system (agreement ending, payment due ...)
  reschedule_count    integer not null default 0,
  reschedule_reason   text,
  completed_at        timestamptz,
  completed_by        uuid,
  outcome             text,
  closed_mode         text check (closed_mode in ('next_task', 'none', 'cancelled')),
  no_followup_reason  text,
  no_followup_comment text,
  created_at          timestamptz not null default now(), created_by uuid,
  updated_at          timestamptz not null default now(), updated_by uuid,
  check (status = 'open' or (closed_mode is not null and completed_at is not null)),
  check (closed_mode is distinct from 'none' or (no_followup_reason is not null and length(trim(coalesce(no_followup_comment, ''))) >= 5))
);
create index tasks_org_open on public.tasks (organisation_id, status, due_on);
create index tasks_party on public.tasks (party_id);
create index tasks_owner on public.tasks (owner_id, status, due_on);
create unique index tasks_auto_key on public.tasks (organisation_id, auto_key) where auto_key is not null;

-- ---- Triggers (touch, audit) -------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['list_items', 'parties', 'contacts', 'agreements', 'agreement_payments', 'agreement_targets', 'agreement_reviews', 'entries', 'tasks'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.touch()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row(''id'')', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from authenticated, anonymous', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (organisation_id in (select app.member_orgs()))', t || '_select', t);
  end loop;
end $$;

-- Direct writes (the database refuses everyone else): lists by the superuser; the rest by admins and the superuser.
grant insert, update on public.list_items to authenticated;
create policy list_items_insert on public.list_items for insert to authenticated with check (organisation_id in (select app.config_orgs()));
create policy list_items_update on public.list_items for update to authenticated using (organisation_id in (select app.config_orgs())) with check (organisation_id in (select app.config_orgs()));

do $$ declare t text; begin
  foreach t in array array['parties', 'contacts', 'agreements', 'agreement_payments', 'agreement_targets', 'agreement_reviews'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (organisation_id in (select app.write_orgs()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (organisation_id in (select app.write_orgs())) with check (organisation_id in (select app.write_orgs()))', t || '_update', t);
  end loop;
end $$;

-- Entries: created only through entry_log(); afterwards the wording can be corrected but the follow-up cannot be removed.
grant update (contact_id, agreement_id, title, body, occurred_at, location, attendees, is_decision, meeting_status, archived_at) on public.entries to authenticated;
create policy entries_update on public.entries for update to authenticated using (organisation_id in (select app.write_orgs())) with check (organisation_id in (select app.write_orgs()));
-- Tasks: written only through task_save(), task_complete() and task_cancel() (select only here).

-- ---- Reminders the system makes (agreement ending, payment due, volume review) ----------------------------------------------
create or replace function app.default_owner(p_org uuid, p_pref uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.user_id from public.memberships m where m.organisation_id = p_org and m.user_id = p_pref and m.status = 'active'),
    (select m.user_id from public.memberships m where m.organisation_id = p_org and m.status = 'active' and m.role in ('superuser', 'admin') order by (m.role = 'superuser') desc, m.created_at limit 1));
$$;

-- Makes, moves or cancels one automatic reminder. Keyed so the same reminder is never created twice.
create or replace function app.auto_task(p_org uuid, p_key text, p_wanted boolean, p_party uuid, p_agreement uuid, p_title text, p_details text, p_due date, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := app.default_owner(p_org, p_owner); v_today date := (now() at time zone 'Europe/London')::date;
begin
  if p_wanted and v_owner is not null and (p_due >= v_today or exists (select 1 from public.tasks where organisation_id = p_org and auto_key = p_key and status = 'open')) then
    insert into public.tasks (organisation_id, party_id, agreement_id, title, details, due_on, owner_id, source, auto_key)
    values (p_org, p_party, p_agreement, p_title, p_details, p_due, v_owner, 'auto', p_key)
    on conflict (organisation_id, auto_key) where auto_key is not null
    do update set title = excluded.title, details = excluded.details, due_on = excluded.due_on, party_id = excluded.party_id
      where public.tasks.status = 'open' and (public.tasks.due_on is distinct from excluded.due_on or public.tasks.title is distinct from excluded.title);
  else
    update public.tasks set status = 'cancelled', closed_mode = 'cancelled', completed_at = now(), completed_by = app.uid(), outcome = 'No longer needed: the record it was about has changed.'
     where organisation_id = p_org and auto_key = p_key and status = 'open';
  end if;
end $$;

create or replace function app.sync_payment_id(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.agreement_payments; a public.agreements; live boolean;
begin
  select * into r from public.agreement_payments where id = p_id;
  select * into a from public.agreements where id = r.agreement_id;
  live := a.status in ('agreed', 'live') and a.archived_at is null;
  perform app.auto_task(r.organisation_id, format('pay-%s', r.id), live and r.status = 'planned' and r.archived_at is null, a.party_id, a.id,
    format('Payment due: %s (%s)', a.title, to_char(r.amount, 'FM£999,999,990.00')), coalesce(r.note, 'Check the payment has been made or received, then mark it done on the investment.'), r.due_on, a.owner_id);
end $$;

create or replace function app.sync_target_id(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.agreement_targets; a public.agreements; live boolean;
begin
  select * into r from public.agreement_targets where id = p_id;
  select * into a from public.agreements where id = r.agreement_id;
  live := a.status in ('agreed', 'live') and a.archived_at is null;
  perform app.auto_task(r.organisation_id, format('tgt-%s', r.id), live and r.archived_at is null, a.party_id, a.id,
    format('Volume review due: %s (%s %s)', a.title, trim(to_char(r.quantity, 'FM999,999,990.##')), r.unit), 'The target period ends in two weeks. Record how it went in a review, and note any shortfall.', r.period_end - 14, a.owner_id);
end $$;

create or replace function app.sync_agreement() returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.agreements; d int; live boolean; r record;
begin
  select * into a from public.agreements where id = new.id;
  live := a.status in ('agreed', 'live') and a.archived_at is null;
  foreach d in array array[90, 60, 30] loop
    perform app.auto_task(a.organisation_id, format('agr-end-%s-%s', d, a.id), live and a.end_on is not null, a.party_id, a.id,
      format('Ends in %s days: %s', d, a.title), 'This investment is due to end. Decide whether to renew, change or let it end.', a.end_on - d, a.owner_id);
  end loop;
  perform app.auto_task(a.organisation_id, format('agr-excl-30-%s', a.id), live and a.has_exclusivity and a.exclusivity_ends_on is not null, a.party_id, a.id,
    format('Exclusivity ends in 30 days: %s', a.title), 'The exclusivity is due to end. Decide what happens next.', a.exclusivity_ends_on - 30, a.owner_id);
  for r in select id from public.agreement_payments where agreement_id = a.id loop perform app.sync_payment_id(r.id); end loop;
  for r in select id from public.agreement_targets where agreement_id = a.id loop perform app.sync_target_id(r.id); end loop;
  return null;
end $$;
create trigger agreements_sync after insert or update on public.agreements for each row execute function app.sync_agreement();

create or replace function app.sync_payment() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform app.sync_payment_id(new.id); return null; end $$;
create trigger agreement_payments_sync after insert or update on public.agreement_payments for each row execute function app.sync_payment();

create or replace function app.sync_target() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform app.sync_target_id(new.id); return null; end $$;
create trigger agreement_targets_sync after insert or update on public.agreement_targets for each row execute function app.sync_target();

-- ---- Writing entries and tasks: the follow-up rules ---------------------------------------------------------------------
create or replace function app.need_writer(p_org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if app.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_org is null or p_org not in (select app.write_orgs()) then raise exception 'You do not have permission to do that' using errcode = '42501'; end if;
end $$;

create or replace function app.london_today() returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/London')::date $$;

-- p: { organisation_id, party_id, kind, title, body, occurred_at, location, attendees, contact_id, agreement_id, is_decision,
--      meeting_status, related_entry_id,
--      followup: { mode: 'task', title, due_on, owner_id, details }  or  { mode: 'none', reason, comment } }
create or replace function public.entry_log(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (p ->> 'organisation_id')::uuid; v_party uuid := (p ->> 'party_id')::uuid; v_kind text := p ->> 'kind';
  v_f jsonb := p -> 'followup'; v_mode text := v_f ->> 'mode'; v_occ timestamptz := coalesce((p ->> 'occurred_at')::timestamptz, now());
  v_id uuid; v_ms text; v_owner uuid; v_due date; v_today date := app.london_today();
begin
  perform app.need_writer(v_org);
  if not exists (select 1 from public.parties where id = v_party and organisation_id = v_org and archived_at is null) then raise exception 'Choose who this is about'; end if;
  if v_kind is null or v_kind not in ('note', 'call', 'email', 'meeting', 'visit', 'decision') then raise exception 'Choose what kind of entry this is'; end if;
  if coalesce(trim(p ->> 'title'), '') = '' then raise exception 'Give it a short title'; end if;
  if v_mode = 'task' then
    if coalesce(trim(v_f ->> 'title'), '') = '' then raise exception 'Say what the follow-up is'; end if;
    v_due := (v_f ->> 'due_on')::date;
    if v_due is null then raise exception 'Choose when to revisit this'; end if;
    if v_due < v_today then raise exception 'The revisit date cannot be in the past'; end if;
    v_owner := app.default_owner(v_org, nullif(v_f ->> 'owner_id', '')::uuid);
    if v_owner is null then raise exception 'Choose who is following this up'; end if;
  elsif v_mode = 'none' then
    if coalesce(trim(v_f ->> 'reason'), '') = '' then raise exception 'Choose why no follow-up is needed'; end if;
    if length(trim(coalesce(v_f ->> 'comment', ''))) < 5 then raise exception 'Explain in a sentence why no follow-up is needed'; end if;
  else
    raise exception 'Choose a follow-up date, or say why none is needed';
  end if;
  v_ms := case when v_kind = 'meeting' then coalesce(nullif(p ->> 'meeting_status', ''), case when v_occ > now() then 'scheduled' else 'held' end) end;
  insert into public.entries (organisation_id, party_id, contact_id, agreement_id, related_entry_id, kind, title, body, occurred_at, location, attendees, is_decision, meeting_status,
                              followup_mode, no_followup_reason, no_followup_comment)
  values (v_org, v_party, nullif(p ->> 'contact_id', '')::uuid, nullif(p ->> 'agreement_id', '')::uuid, nullif(p ->> 'related_entry_id', '')::uuid, v_kind, trim(p ->> 'title'),
          nullif(trim(coalesce(p ->> 'body', '')), ''), v_occ, nullif(trim(coalesce(p ->> 'location', '')), ''), nullif(trim(coalesce(p ->> 'attendees', '')), ''),
          coalesce((p ->> 'is_decision')::boolean, false) or v_kind = 'decision', v_ms,
          v_mode, case when v_mode = 'none' then trim(v_f ->> 'reason') end, case when v_mode = 'none' then trim(v_f ->> 'comment') end)
  returning id into v_id;
  if nullif(p ->> 'related_entry_id', '') is not null then
    update public.entries set meeting_status = 'held' where id = (p ->> 'related_entry_id')::uuid and organisation_id = v_org and kind = 'meeting' and meeting_status = 'scheduled';
  end if;
  if v_mode = 'task' then
    insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, entry_id, title, details, due_on, owner_id, source)
    values (v_org, v_party, nullif(p ->> 'contact_id', '')::uuid, nullif(p ->> 'agreement_id', '')::uuid, v_id, trim(v_f ->> 'title'), nullif(trim(coalesce(v_f ->> 'details', '')), ''), v_due, v_owner, 'follow_up');
  end if;
  return v_id;
end $$;

-- A standalone task, or a change to one that is still open. Changing the date needs a reason (and is counted).
-- p: { id?, organisation_id, party_id, contact_id, agreement_id, title, details, due_on, owner_id, reschedule_reason }
create or replace function public.task_save(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_org uuid := (p ->> 'organisation_id')::uuid; t public.tasks; v_due date := (p ->> 'due_on')::date; v_owner uuid;
begin
  perform app.need_writer(v_org);
  if coalesce(trim(p ->> 'title'), '') = '' then raise exception 'Give the task a title'; end if;
  if v_due is null then raise exception 'Choose a due date'; end if;
  v_owner := app.default_owner(v_org, nullif(p ->> 'owner_id', '')::uuid);
  if v_owner is null or v_owner is distinct from nullif(p ->> 'owner_id', '')::uuid then raise exception 'Choose who the task is for'; end if;
  if v_id is null then
    if v_due < app.london_today() then raise exception 'The due date cannot be in the past'; end if;
    insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, title, details, due_on, owner_id, source)
    values (v_org, nullif(p ->> 'party_id', '')::uuid, nullif(p ->> 'contact_id', '')::uuid, nullif(p ->> 'agreement_id', '')::uuid, trim(p ->> 'title'),
            nullif(trim(coalesce(p ->> 'details', '')), ''), v_due, v_owner, 'manual') returning id into v_id;
    return v_id;
  end if;
  select * into t from public.tasks where id = v_id and organisation_id = v_org for update;
  if not found then raise exception 'That task no longer exists'; end if;
  if t.status <> 'open' then raise exception 'A closed task cannot be changed'; end if;
  if v_due is distinct from t.due_on then
    if v_due < app.london_today() then raise exception 'The new date cannot be in the past'; end if;
    if length(trim(coalesce(p ->> 'reschedule_reason', ''))) < 3 then raise exception 'Say why the date is moving'; end if;
    update public.tasks set due_on = v_due, reschedule_count = reschedule_count + 1, reschedule_reason = trim(p ->> 'reschedule_reason') where id = v_id;
  end if;
  update public.tasks set title = trim(p ->> 'title'), details = nullif(trim(coalesce(p ->> 'details', '')), ''), owner_id = v_owner,
         contact_id = nullif(p ->> 'contact_id', '')::uuid, agreement_id = coalesce(nullif(p ->> 'agreement_id', '')::uuid, agreement_id)
   where id = v_id;
  return v_id;
end $$;

-- Closing a task asks what happens next.
-- p: { id, organisation_id, outcome, mode: 'next_task'|'none', next: { title, due_on, owner_id, details }, reason, comment }
-- Returns the id of the next task, or null.
create or replace function public.task_complete(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := (p ->> 'organisation_id')::uuid; t public.tasks; v_mode text := p ->> 'mode'; n jsonb := p -> 'next'; v_next uuid; v_due date; v_owner uuid;
begin
  perform app.need_writer(v_org);
  select * into t from public.tasks where id = (p ->> 'id')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'That task no longer exists'; end if;
  if t.status <> 'open' then raise exception 'That task is already closed'; end if;
  if length(trim(coalesce(p ->> 'outcome', ''))) < 3 then raise exception 'Say what happened'; end if;
  if v_mode = 'next_task' then
    if coalesce(trim(n ->> 'title'), '') = '' then raise exception 'Say what the next step is'; end if;
    v_due := (n ->> 'due_on')::date;
    if v_due is null then raise exception 'Choose when to revisit'; end if;
    if v_due < app.london_today() then raise exception 'The revisit date cannot be in the past'; end if;
    v_owner := app.default_owner(v_org, nullif(n ->> 'owner_id', '')::uuid);
    if v_owner is null then raise exception 'Choose who the next step is for'; end if;
  elsif v_mode = 'none' then
    if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'Choose why nothing more is needed'; end if;
    if length(trim(coalesce(p ->> 'comment', ''))) < 5 then raise exception 'Explain in a sentence why nothing more is needed'; end if;
  else
    raise exception 'Choose the next step, or say why nothing more is needed';
  end if;
  update public.tasks set status = 'done', completed_at = now(), completed_by = app.uid(), outcome = trim(p ->> 'outcome'), closed_mode = v_mode,
         no_followup_reason = case when v_mode = 'none' then trim(p ->> 'reason') end, no_followup_comment = case when v_mode = 'none' then trim(p ->> 'comment') end
   where id = t.id;
  if v_mode = 'next_task' then
    insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, entry_id, previous_task_id, title, details, due_on, owner_id, source)
    values (v_org, t.party_id, t.contact_id, t.agreement_id, t.entry_id, t.id, trim(n ->> 'title'), nullif(trim(coalesce(n ->> 'details', '')), ''), v_due, v_owner, 'follow_up')
    returning id into v_next;
  end if;
  return v_next;
end $$;

create or replace function public.task_cancel(p_org uuid, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.need_writer(p_org);
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Explain why the task is being cancelled'; end if;
  update public.tasks set status = 'cancelled', closed_mode = 'cancelled', completed_at = now(), completed_by = app.uid(), outcome = trim(p_reason)
   where id = p_id and organisation_id = p_org and status = 'open';
  if not found then raise exception 'That task is not open'; end if;
end $$;

grant execute on function public.entry_log(jsonb), public.task_save(jsonb), public.task_complete(jsonb), public.task_cancel(uuid, uuid, text) to authenticated;
grant execute on function app.london_today() to authenticated;

-- ---- Roll-ups: figures for a record and everything underneath it ----------------------------------------------------------
-- security_invoker: the views see only what the signed-in person's own row-level security allows.
create view public.party_closure with (security_invoker = true) as
with recursive c as (
  select p.id as ancestor_id, p.id as descendant_id, 0 as depth, p.organisation_id from public.parties p
  union all
  select c.ancestor_id, p.id, c.depth + 1, p.organisation_id from c join public.parties p on p.parent_id = c.descendant_id
)
select * from c;

create view public.agreement_values with (security_invoker = true) as
select a.id as agreement_id, a.organisation_id, a.party_id,
       (a.status in ('agreed', 'live') and a.archived_at is null) as counts,
       case when a.amount_basis = 'per_year' then coalesce(a.amount, 0) else 0 end as per_year,
       case when a.amount_basis = 'total' then coalesce(a.amount, 0) else 0 end as total,
       coalesce((select sum(p.amount) from public.agreement_payments p where p.agreement_id = a.id and p.status = 'done' and p.archived_at is null), 0) as done,
       coalesce((select sum(p.amount) from public.agreement_payments p where p.agreement_id = a.id and p.status = 'planned' and p.archived_at is null), 0) as planned,
       coalesce((select sum(p.amount) from public.agreement_payments p where p.agreement_id = a.id and p.status = 'planned' and p.archived_at is null and p.due_on < (now() at time zone 'Europe/London')::date), 0) as overdue
  from public.agreements a;

create view public.party_rollup with (security_invoker = true) as
select c.ancestor_id as party_id, c.organisation_id,
       count(*) filter (where v.counts and c.depth = 0) as own_count,
       count(*) filter (where v.counts and c.depth > 0) as below_count,
       coalesce(sum(v.per_year) filter (where v.counts and c.depth = 0), 0) as own_per_year,
       coalesce(sum(v.per_year) filter (where v.counts and c.depth > 0), 0) as below_per_year,
       coalesce(sum(v.total) filter (where v.counts and c.depth = 0), 0) as own_total,
       coalesce(sum(v.total) filter (where v.counts and c.depth > 0), 0) as below_total,
       coalesce(sum(v.done) filter (where v.counts and c.depth = 0), 0) as own_done,
       coalesce(sum(v.done) filter (where v.counts and c.depth > 0), 0) as below_done,
       coalesce(sum(v.planned) filter (where v.counts and c.depth = 0), 0) as own_planned,
       coalesce(sum(v.planned) filter (where v.counts and c.depth > 0), 0) as below_planned,
       coalesce(sum(v.overdue) filter (where v.counts and c.depth = 0), 0) as own_overdue,
       coalesce(sum(v.overdue) filter (where v.counts and c.depth > 0), 0) as below_overdue
  from public.party_closure c left join public.agreement_values v on v.party_id = c.descendant_id
 group by c.ancestor_id, c.organisation_id;

-- Targets whose period includes today, added up by unit (kegs with kegs, never kegs with cases).
create view public.party_target_rollup with (security_invoker = true) as
select c.ancestor_id as party_id, c.organisation_id, t.unit,
       coalesce(sum(t.quantity) filter (where c.depth = 0), 0) as own_qty,
       coalesce(sum(t.quantity) filter (where c.depth > 0), 0) as below_qty
  from public.party_closure c
  join public.agreements a on a.party_id = c.descendant_id and a.status in ('agreed', 'live') and a.archived_at is null
  join public.agreement_targets t on t.agreement_id = a.id and t.archived_at is null
   and (now() at time zone 'Europe/London')::date between t.period_start and t.period_end
 group by c.ancestor_id, c.organisation_id, t.unit;

revoke all on public.party_closure, public.agreement_values, public.party_rollup, public.party_target_rollup from authenticated, anonymous;
grant select on public.party_closure, public.agreement_values, public.party_rollup, public.party_target_rollup to authenticated;

-- ---- Starting lists for every new organisation --------------------------------------------------------------------------
create or replace function app.seed_lists() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'investment_kind', n, i * 10 from unnest(array['Cash contribution', 'Discount or price support', 'Free stock', 'Equipment', 'Marketing or promotion', 'Rebate', 'Listing fee', 'Other']) with ordinality as t(n, i);
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'no_followup_reason', n, i * 10 from unnest(array['No longer a customer', 'Decision: no investment going forward', 'Brand delisted or relationship ended', 'Information only, nothing to chase', 'Handed to someone else', 'Other (explain below)']) with ordinality as t(n, i);
  return new;
end $$;
create trigger organisations_seed_lists after insert on public.organisations for each row execute function app.seed_lists();

notify pgrst, 'reload schema';
