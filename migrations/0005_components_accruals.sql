-- Deal components, coverage checklist, deal terms, payout schedule, "what it was used for" and accruals.
--
--  * An agreement (deal) holds one or more COMPONENTS (listing fee, retro / rebate, marketing support, customer investment, new business ...).
--    Each component has its own amount, how often it is paid out and how often it is accrued.
--  * Retro is a payment earned by hitting volume targets, so it is the same kind as a rebate: "Retro / rebate".
--  * A deal's length is either typed in (x months or years from the start) or worked out from the start and end dates.
--  * The payout frequency creates the planned payments, and every planned payment already creates its own reminder task.
--  * COVERAGE: which brands / products (brand side) or sub-groups / pubs (customer side) a deal covers. No ticks = everything below.
--  * USES: what the investment was actually spent on (van branding and so on).
--  * ACCRUALS: a forecast per period, with the actual entered alongside it, for the people who look after the money and for Finance.

-- ---- Lists --------------------------------------------------------------------------------------------------------------------
alter table public.list_items drop constraint list_items_list_check;
alter table public.list_items add constraint list_items_list_check check (list in ('investment_kind', 'no_followup_reason', 'task_outcome', 'task_category', 'investment_use'));

-- Retro is paid for hitting volume targets, which is what a rebate is, so one kind covers both.
update public.list_items set name = 'Retro / rebate' where list = 'investment_kind' and lower(name) = 'rebate'
  and not exists (select 1 from public.list_items x where x.organisation_id = list_items.organisation_id and x.list = 'investment_kind' and lower(x.name) = 'retro / rebate');
update public.agreements set kind = 'Retro / rebate' where kind = 'Rebate';

insert into public.list_items (organisation_id, list, name, sort_order)
select o.id, 'investment_kind', t.n, t.s from public.organisations o, (values ('Customer investment', 75), ('New business', 85)) as t(n, s)
 where not exists (select 1 from public.list_items l where l.organisation_id = o.id and l.list = 'investment_kind' and lower(l.name) = lower(t.n));
insert into public.list_items (organisation_id, list, name, sort_order)
select o.id, 'investment_use', n, i * 10 from public.organisations o,
  unnest(array['Van or vehicle branding', 'Point of sale materials', 'Staff incentives', 'Events and promotions', 'Equipment', 'Glassware and menus', 'Other']) with ordinality as t(n, i);

create or replace function app.seed_lists() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'investment_kind', n, i * 10 from unnest(array['Cash contribution', 'Discount or price support', 'Free stock', 'Equipment', 'Marketing or promotion', 'Retro / rebate', 'Listing fee', 'Customer investment', 'New business', 'Other']) with ordinality as t(n, i);
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'no_followup_reason', n, i * 10 from unnest(array['No longer a customer', 'Decision: no investment going forward', 'Brand delisted or relationship ended', 'Information only, nothing to chase', 'Handed to someone else', 'Meeting already in the diary', 'Other (explain below)']) with ordinality as t(n, i);
  insert into public.list_items (organisation_id, list, name, sort_order, ends_work)
  select new.id, 'task_outcome', n, i * 10, e from unnest(array['Resolved', 'Information received', 'Chased, awaiting reply', 'Escalated', 'Blocked', 'Postponed'], array[true, true, false, false, false, false]) with ordinality as t(n, e, i);
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'task_category', n, i * 10 from unnest(array['Chase', 'Prepare', 'Send', 'Review', 'Payment', 'Meeting prep']) with ordinality as t(n, i);
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'investment_use', n, i * 10 from unnest(array['Van or vehicle branding', 'Point of sale materials', 'Staff incentives', 'Events and promotions', 'Equipment', 'Glassware and menus', 'Other']) with ordinality as t(n, i);
  return new;
end $$;

-- ---- Deal terms ---------------------------------------------------------------------------------------------------------------
alter table public.agreements
  add column agreed_on   date,                                                                        -- the date the deal was agreed
  add column length_mode text not null default 'dates' check (length_mode in ('dates', 'term')),     -- 'dates': start and end typed in. 'term': a length from the start
  add column term_months integer check (term_months is null or term_months > 0),                      -- the length, in months (years are entered as 12 months each)
  add column renewal_on  date;                                                                        -- when the deal is due for renewal (reminders follow this, else the end date)
alter table public.agreements alter column kind drop not null;   -- the kinds now live on the components; this holds a summary of them

create or replace function app.agreements_terms() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.length_mode = 'term' then
    if new.term_months is null then raise exception 'Say how long the deal runs' using errcode = '23514'; end if;
    if new.start_on is null then raise exception 'A deal with a set length needs a start date' using errcode = '23514'; end if;
    new.end_on := (new.start_on + make_interval(months => new.term_months))::date - 1;
  else
    new.term_months := null;
  end if;
  return new;
end $$;
create trigger agreements_terms before insert or update on public.agreements for each row execute function app.agreements_terms();

-- ---- Components ---------------------------------------------------------------------------------------------------------------
create table public.agreement_components (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations(id),
  agreement_id      uuid not null references public.agreements(id),
  kind              text not null,                                                   -- from the "investment kind" list
  description       text,
  amount            numeric(14, 2) check (amount is null or amount >= 0),
  amount_basis      text not null default 'per_year' check (amount_basis in ('total', 'per_year')),
  payout_frequency  text not null default 'none' check (payout_frequency in ('none', 'one_off', 'monthly', 'quarterly', 'half_yearly', 'annual')),   -- none = payments are added by hand
  first_payout_on   date,                                                            -- blank: the deal's start date
  accrual_frequency text not null default 'monthly' check (accrual_frequency in ('monthly', 'quarterly', 'annual')),
  notes             text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(), created_by uuid,
  updated_at        timestamptz not null default now(), updated_by uuid
);
create index agreement_components_agreement on public.agreement_components (agreement_id);
create index agreement_components_org on public.agreement_components (organisation_id);

alter table public.agreement_payments add column component_id uuid references public.agreement_components(id), add column generated boolean not null default false;
alter table public.agreement_targets  add column component_id uuid references public.agreement_components(id);   -- e.g. the retro a target earns
create index agreement_payments_component on public.agreement_payments (component_id);

-- Every existing investment becomes a deal with one component (payments stay as they were: added by hand).
insert into public.agreement_components (organisation_id, agreement_id, kind, amount, amount_basis, payout_frequency, created_at)
select a.organisation_id, a.id, a.kind, a.amount, a.amount_basis, 'none', a.created_at from public.agreements a where a.kind is not null;

-- ---- Coverage, uses, accruals ------------------------------------------------------------------------------------------------------
create table public.agreement_scope (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  agreement_id    uuid not null references public.agreements(id),
  party_id        uuid not null references public.parties(id),                       -- a brand / product / sub-group / pub the deal covers
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create unique index agreement_scope_unique on public.agreement_scope (agreement_id, party_id) where archived_at is null;
create index agreement_scope_party on public.agreement_scope (party_id);

create or replace function app.scope_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.agreements; cur uuid; found_it boolean := false;
begin
  select * into a from public.agreements where id = new.agreement_id;
  if not found or a.organisation_id <> new.organisation_id then raise exception 'The investment does not exist' using errcode = '23503'; end if;
  cur := new.party_id;
  while cur is not null loop
    if cur = a.party_id then found_it := true; exit; end if;
    select parent_id into cur from public.parties where id = cur;
  end loop;
  if not found_it then raise exception 'That record is not part of the brand owner or customer the investment is with' using errcode = '23514'; end if;
  return new;
end $$;
create trigger agreement_scope_check before insert or update on public.agreement_scope for each row execute function app.scope_check();

create table public.investment_uses (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  agreement_id    uuid not null references public.agreements(id),
  component_id    uuid references public.agreement_components(id),
  used_on         date not null default current_date,
  used_for        text not null,                                                      -- from the "what it was used for" list
  amount          numeric(14, 2) check (amount is null or amount >= 0),
  note            text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create index investment_uses_agreement on public.investment_uses (agreement_id);

-- One line per component per accrual period. The forecast is worked out by the database; the actual is typed in by a person.
create table public.agreement_accruals (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  agreement_id    uuid not null references public.agreements(id),
  component_id    uuid not null references public.agreement_components(id),
  period_start    date not null,
  period_end      date not null,
  forecast_amount numeric(14, 2) not null,
  actual_amount   numeric(14, 2),
  actual_on       date,                                                                 -- when the actual was entered or confirmed
  note            text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid,
  check (period_end >= period_start)
);
create unique index agreement_accruals_unique on public.agreement_accruals (component_id, period_start) where archived_at is null;
create index agreement_accruals_org on public.agreement_accruals (organisation_id, period_start);
create index agreement_accruals_agreement on public.agreement_accruals (agreement_id);

-- ---- Triggers, security (same rules as every other table) --------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['agreement_components', 'agreement_scope', 'investment_uses', 'agreement_accruals'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.touch()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row(''id'')', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from authenticated, anonymous', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (organisation_id in (select app.member_orgs()))', t || '_select', t);
  end loop;
  foreach t in array array['agreement_components', 'agreement_scope', 'investment_uses'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (organisation_id in (select app.write_orgs()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (organisation_id in (select app.write_orgs())) with check (organisation_id in (select app.write_orgs()))', t || '_update', t);
  end loop;
end $$;
-- Accrual lines are made by the database; people can only enter the actual, add a note, or archive one.
grant update (actual_amount, actual_on, note, archived_at) on public.agreement_accruals to authenticated;
create policy agreement_accruals_update on public.agreement_accruals for update to authenticated using (organisation_id in (select app.write_orgs())) with check (organisation_id in (select app.write_orgs()));

-- ---- Payout schedule: creates the planned payments (each one makes its own reminder task) ----------------------------------------------------
create or replace function app.freq_per_year(p_freq text) returns integer language sql immutable set search_path = '' as $$
  select case p_freq when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 when 'annual' then 1 end
$$;

create or replace function app.generate_payments(p_component uuid) returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.agreement_components; a public.agreements; v_wanted boolean; v_end date; v_first date; v_ppy int; v_step int; v_i int := 0; v_d date;
  v_dues date[] := '{}'; v_amts numeric[] := '{}'; v_n int; v_each numeric(14, 2);
begin
  select * into c from public.agreement_components where id = p_component;
  if not found then return; end if;
  select * into a from public.agreements where id = c.agreement_id;
  v_wanted := c.archived_at is null and a.archived_at is null and a.status in ('agreed', 'live') and c.payout_frequency <> 'none' and coalesce(c.amount, 0) > 0 and a.start_on is not null;
  if v_wanted then
    v_first := coalesce(c.first_payout_on, a.start_on);
    if c.payout_frequency = 'one_off' then
      v_dues := array[v_first]; v_amts := array[c.amount];
    else
      v_ppy := app.freq_per_year(c.payout_frequency); v_step := 12 / v_ppy;
      v_end := coalesce(a.end_on, (greatest(a.start_on + make_interval(months => 12), app.london_today() + make_interval(months => 12)))::date - 1);
      loop
        v_d := (v_first + make_interval(months => v_step * v_i))::date;
        exit when v_d > v_end or v_i >= 240;
        v_dues := v_dues || v_d; v_i := v_i + 1;
      end loop;
      v_n := coalesce(array_length(v_dues, 1), 0);
      if v_n > 0 then
        v_each := case when c.amount_basis = 'per_year' then round(c.amount / v_ppy, 2) else round(c.amount / v_n, 2) end;
        for v_i in 1..v_n loop
          v_amts := v_amts || (case when c.amount_basis = 'total' and v_i = v_n then c.amount - v_each * (v_n - 1) else v_each end);
        end loop;
      end if;
    end if;
  end if;
  -- planned payments the schedule made that are no longer wanted
  update public.agreement_payments set archived_at = now()
   where component_id = c.id and generated and status = 'planned' and archived_at is null and not (due_on = any (v_dues));
  for v_i in 1..coalesce(array_length(v_dues, 1), 0) loop
    update public.agreement_payments set amount = v_amts[v_i]
     where component_id = c.id and generated and status = 'planned' and archived_at is null and due_on = v_dues[v_i] and amount is distinct from v_amts[v_i];
    insert into public.agreement_payments (organisation_id, agreement_id, component_id, due_on, amount, generated, note)
    select c.organisation_id, c.agreement_id, c.id, v_dues[v_i], v_amts[v_i], true, c.kind
     where not exists (select 1 from public.agreement_payments x where x.component_id = c.id and x.due_on = v_dues[v_i] and x.archived_at is null);
  end loop;
end $$;

-- ---- Accrual schedule: a forecast for each period (whole calendar periods, starting in the month the deal starts) ---------------------------------
create or replace function app.generate_accruals(p_component uuid) returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.agreement_components; a public.agreements; v_wanted boolean; v_end date; v_first date; v_ppy int; v_step int; v_i int := 0; v_d date;
  v_starts date[] := '{}'; v_amts numeric[] := '{}'; v_n int; v_each numeric(14, 2);
begin
  select * into c from public.agreement_components where id = p_component;
  if not found then return; end if;
  select * into a from public.agreements where id = c.agreement_id;
  v_wanted := c.archived_at is null and a.archived_at is null and a.status in ('agreed', 'live', 'ended') and coalesce(c.amount, 0) > 0 and a.start_on is not null;
  if v_wanted then
    v_ppy := app.freq_per_year(c.accrual_frequency); v_step := 12 / v_ppy;
    v_first := date_trunc('month', a.start_on)::date;
    v_end := coalesce(a.end_on, (greatest(a.start_on + make_interval(months => 12), app.london_today() + make_interval(months => 12)))::date - 1);
    loop
      v_d := (v_first + make_interval(months => v_step * v_i))::date;
      exit when v_d > v_end or v_i >= 240;
      v_starts := v_starts || v_d; v_i := v_i + 1;
    end loop;
    v_n := coalesce(array_length(v_starts, 1), 0);
    if v_n > 0 then
      v_each := case when c.amount_basis = 'per_year' then round(c.amount / v_ppy, 2) else round(c.amount / v_n, 2) end;
      for v_i in 1..v_n loop
        v_amts := v_amts || (case when c.amount_basis = 'total' and v_i = v_n then c.amount - v_each * (v_n - 1) else v_each end);
      end loop;
    end if;
  end if;
  -- forecast-only lines no longer wanted are archived; a line with an actual is never touched
  update public.agreement_accruals set archived_at = now()
   where component_id = c.id and archived_at is null and actual_amount is null and not (period_start = any (v_starts));
  for v_i in 1..coalesce(array_length(v_starts, 1), 0) loop
    update public.agreement_accruals set forecast_amount = v_amts[v_i]
     where component_id = c.id and archived_at is null and actual_amount is null and period_start = v_starts[v_i] and forecast_amount is distinct from v_amts[v_i];
    insert into public.agreement_accruals (organisation_id, agreement_id, component_id, period_start, period_end, forecast_amount)
    select c.organisation_id, c.agreement_id, c.id, v_starts[v_i], (v_starts[v_i] + make_interval(months => v_step))::date - 1, v_amts[v_i]
     where not exists (select 1 from public.agreement_accruals x where x.component_id = c.id and x.period_start = v_starts[v_i] and x.archived_at is null);
  end loop;
end $$;

-- ---- When to regenerate -------------------------------------------------------------------------------------------------------------
create or replace function app.sync_component() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  if tg_op = 'INSERT' or (old.kind, old.amount, old.amount_basis, old.payout_frequency, old.first_payout_on, old.accrual_frequency, old.archived_at)
                         is distinct from (new.kind, new.amount, new.amount_basis, new.payout_frequency, new.first_payout_on, new.accrual_frequency, new.archived_at) then
    perform app.generate_payments(new.id);
    perform app.generate_accruals(new.id);
  end if;
  select string_agg(kind, ' + ' order by created_at, id) into v_kind from public.agreement_components where agreement_id = new.agreement_id and archived_at is null;
  update public.agreements set kind = v_kind where id = new.agreement_id and kind is distinct from v_kind;
  return null;
end $$;
create trigger agreement_components_sync after insert or update on public.agreement_components for each row execute function app.sync_component();

create or replace function app.sync_schedule() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'INSERT' or (old.start_on, old.end_on, old.status, old.archived_at) is distinct from (new.start_on, new.end_on, new.status, new.archived_at) then
    for r in select id from public.agreement_components where agreement_id = new.id loop
      perform app.generate_payments(r.id);
      perform app.generate_accruals(r.id);
    end loop;
  end if;
  return null;
end $$;
create trigger agreements_schedule after insert or update on public.agreements for each row execute function app.sync_schedule();

-- For deals with no end date the schedule looks 12 months ahead; this pushes it forward (button on the Accruals screen).
create or replace function public.schedules_refresh(p_org uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  perform app.need_writer(p_org);
  for r in select id from public.agreement_components where organisation_id = p_org and archived_at is null loop
    perform app.generate_payments(r.id); perform app.generate_accruals(r.id); n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.schedules_refresh(uuid) to authenticated;

-- ---- Reminders: payment titles name the component; renewal date drives the ending reminders ------------------------------------------------------
create or replace function app.sync_payment_id(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.agreement_payments; a public.agreements; live boolean; k text;
begin
  select * into r from public.agreement_payments where id = p_id;
  select * into a from public.agreements where id = r.agreement_id;
  select kind into k from public.agreement_components where id = r.component_id;
  live := a.status in ('agreed', 'live') and a.archived_at is null;
  perform app.auto_task(r.organisation_id, format('pay-%s', r.id), live and r.status = 'planned' and r.archived_at is null, a.party_id, a.id,
    format('Payment due: %s (%s%s)', a.title, case when k is not null then k || ', ' else '' end, to_char(r.amount, 'FM£999,999,990.00')),
    coalesce(r.note, 'Check the payment has been made or received, then mark it done on the investment.'), r.due_on, a.owner_id);
end $$;

create or replace function app.sync_agreement() returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.agreements; d int; live boolean; r record; v_on date;
begin
  select * into a from public.agreements where id = new.id;
  live := a.status in ('agreed', 'live') and a.archived_at is null;
  v_on := coalesce(a.renewal_on, a.end_on);
  foreach d in array array[90, 60, 30] loop
    perform app.auto_task(a.organisation_id, format('agr-end-%s-%s', d, a.id), live and v_on is not null, a.party_id, a.id,
      case when a.renewal_on is not null then format('Renewal in %s days: %s', d, a.title) else format('Ends in %s days: %s', d, a.title) end,
      'This investment is due to end or renew. Decide whether to renew, change or let it end.', v_on - d, a.owner_id);
  end loop;
  perform app.auto_task(a.organisation_id, format('agr-excl-30-%s', a.id), live and a.has_exclusivity and a.exclusivity_ends_on is not null, a.party_id, a.id,
    format('Exclusivity ends in 30 days: %s', a.title), 'The exclusivity is due to end. Decide what happens next.', a.exclusivity_ends_on - 30, a.owner_id);
  for r in select id from public.agreement_payments where agreement_id = a.id loop perform app.sync_payment_id(r.id); end loop;
  for r in select id from public.agreement_targets where agreement_id = a.id loop perform app.sync_target_id(r.id); end loop;
  return null;
end $$;

-- ---- Roll-ups now add up the components -------------------------------------------------------------------------------------------------------
drop view public.party_rollup;
drop view public.agreement_values;
create view public.agreement_values with (security_invoker = true) as
select a.id as agreement_id, a.organisation_id, a.party_id,
       (a.status in ('agreed', 'live') and a.archived_at is null) as counts,
       coalesce((select sum(c.amount) from public.agreement_components c where c.agreement_id = a.id and c.archived_at is null and c.amount_basis = 'per_year'), 0) as per_year,
       coalesce((select sum(c.amount) from public.agreement_components c where c.agreement_id = a.id and c.archived_at is null and c.amount_basis = 'total'), 0) as total,
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
revoke all on public.agreement_values, public.party_rollup from authenticated, anonymous;
grant select on public.agreement_values, public.party_rollup to authenticated;

-- Existing deals get their forecast accruals straight away (their payments stay as entered by hand).
select app.generate_accruals(id) from public.agreement_components;

notify pgrst, 'reload schema';
