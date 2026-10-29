-- Outcome codes and task categories.
--  * task_outcome: chosen when a task's outcome is recorded. "ends_work" says whether that outcome may finish with "nothing more needed".
--  * task_category: optional label on a task (Chase, Prepare, Payment ...), for filtering and counting.
alter table public.list_items drop constraint list_items_list_check;
alter table public.list_items add constraint list_items_list_check check (list in ('investment_kind', 'no_followup_reason', 'task_outcome', 'task_category'));
alter table public.list_items add column ends_work boolean not null default false;
alter table public.tasks add column category text, add column outcome_code text;

-- Starting lists for every new organisation (adds the two new lists).
create or replace function app.seed_lists() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'investment_kind', n, i * 10 from unnest(array['Cash contribution', 'Discount or price support', 'Free stock', 'Equipment', 'Marketing or promotion', 'Rebate', 'Listing fee', 'Other']) with ordinality as t(n, i);
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'no_followup_reason', n, i * 10 from unnest(array['No longer a customer', 'Decision: no investment going forward', 'Brand delisted or relationship ended', 'Information only, nothing to chase', 'Handed to someone else', 'Meeting already in the diary', 'Other (explain below)']) with ordinality as t(n, i);
  insert into public.list_items (organisation_id, list, name, sort_order, ends_work)
  select new.id, 'task_outcome', n, i * 10, e from unnest(array['Resolved', 'Information received', 'Chased, awaiting reply', 'Escalated', 'Blocked', 'Postponed'], array[true, true, false, false, false, false]) with ordinality as t(n, e, i);
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'task_category', n, i * 10 from unnest(array['Chase', 'Prepare', 'Send', 'Review', 'Payment', 'Meeting prep']) with ordinality as t(n, i);
  return new;
end $$;

-- Existing organisations get the new lists (and the extra reason).
insert into public.list_items (organisation_id, list, name, sort_order, ends_work)
select o.id, 'task_outcome', n, i * 10, e from public.organisations o, unnest(array['Resolved', 'Information received', 'Chased, awaiting reply', 'Escalated', 'Blocked', 'Postponed'], array[true, true, false, false, false, false]) with ordinality as t(n, e, i);
insert into public.list_items (organisation_id, list, name, sort_order)
select o.id, 'task_category', n, i * 10 from public.organisations o, unnest(array['Chase', 'Prepare', 'Send', 'Review', 'Payment', 'Meeting prep']) with ordinality as t(n, i);
insert into public.list_items (organisation_id, list, name, sort_order)
select o.id, 'no_followup_reason', 'Meeting already in the diary', 60 from public.organisations o
 where not exists (select 1 from public.list_items l where l.organisation_id = o.id and l.list = 'no_followup_reason' and lower(l.name) = 'meeting already in the diary');

-- Tidy categories on existing tasks, by what the title says.
update public.tasks set category = case
  when source = 'auto' and title like 'Payment due:%' then 'Payment'
  when source = 'auto' then null
  when title ~* '^(chase|check|confirm|collect|follow up)' then 'Chase'
  when title ~* '^(prepare|draft)' then 'Prepare'
  when title ~* '^send' then 'Send'
  when title ~* '^(review|agree|hold)' then 'Review'
  else null end
 where category is null;

-- Saving a task takes a category.
create or replace function public.task_save(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_org uuid := (p ->> 'organisation_id')::uuid; t public.tasks; v_due date := (p ->> 'due_on')::date; v_owner uuid; v_cat text := nullif(trim(coalesce(p ->> 'category', '')), '');
begin
  perform app.need_writer(v_org);
  if coalesce(trim(p ->> 'title'), '') = '' then raise exception 'Give the task a title'; end if;
  if v_due is null then raise exception 'Choose a due date'; end if;
  v_owner := app.default_owner(v_org, nullif(p ->> 'owner_id', '')::uuid);
  if v_owner is null or v_owner is distinct from nullif(p ->> 'owner_id', '')::uuid then raise exception 'Choose who the task is for'; end if;
  if v_id is null then
    if v_due < app.london_today() then raise exception 'The due date cannot be in the past'; end if;
    insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, title, details, due_on, owner_id, source, category)
    values (v_org, nullif(p ->> 'party_id', '')::uuid, nullif(p ->> 'contact_id', '')::uuid, nullif(p ->> 'agreement_id', '')::uuid, trim(p ->> 'title'),
            nullif(trim(coalesce(p ->> 'details', '')), ''), v_due, v_owner, 'manual', v_cat) returning id into v_id;
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
  update public.tasks set title = trim(p ->> 'title'), details = nullif(trim(coalesce(p ->> 'details', '')), ''), owner_id = v_owner, category = v_cat,
         contact_id = nullif(p ->> 'contact_id', '')::uuid, agreement_id = coalesce(nullif(p ->> 'agreement_id', '')::uuid, agreement_id)
   where id = v_id;
  return v_id;
end $$;

-- Recording an outcome: choose an outcome, say what happened, then set the next step (or, for an outcome that ends the work, say why nothing more is needed).
-- p: { id, organisation_id, outcome_code, outcome, mode: 'next_task'|'none', next: { title, due_on, owner_id, details, category }, reason, comment }
create or replace function public.task_complete(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := (p ->> 'organisation_id')::uuid; t public.tasks; v_mode text := p ->> 'mode'; n jsonb := p -> 'next'; v_next uuid; v_due date; v_owner uuid;
        v_code text := nullif(trim(coalesce(p ->> 'outcome_code', '')), ''); v_ends boolean;
begin
  perform app.need_writer(v_org);
  select * into t from public.tasks where id = (p ->> 'id')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'That task no longer exists'; end if;
  if t.status <> 'open' then raise exception 'That task already has its outcome recorded'; end if;
  if v_code is null then raise exception 'Choose the outcome'; end if;
  if length(trim(coalesce(p ->> 'outcome', ''))) < 3 then raise exception 'Say what happened'; end if;
  select coalesce(bool_or(l.ends_work), false) into v_ends from public.list_items l where l.organisation_id = v_org and l.list = 'task_outcome' and lower(l.name) = lower(v_code);
  if v_mode = 'next_task' then
    if coalesce(trim(n ->> 'title'), '') = '' then raise exception 'Say what the next step is'; end if;
    v_due := (n ->> 'due_on')::date;
    if v_due is null then raise exception 'Choose when to revisit'; end if;
    if v_due < app.london_today() then raise exception 'The revisit date cannot be in the past'; end if;
    v_owner := app.default_owner(v_org, nullif(n ->> 'owner_id', '')::uuid);
    if v_owner is null then raise exception 'Choose who the next step is for'; end if;
  elsif v_mode = 'none' then
    if not v_ends then raise exception 'That outcome needs a next step. Choose "Resolved" or "Information received" if nothing more is needed'; end if;
    if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'Choose why nothing more is needed'; end if;
    if length(trim(coalesce(p ->> 'comment', ''))) < 5 then raise exception 'Explain in a sentence why nothing more is needed'; end if;
  else
    raise exception 'Choose the next step, or say why nothing more is needed';
  end if;
  update public.tasks set status = 'done', completed_at = now(), completed_by = app.uid(), outcome = trim(p ->> 'outcome'), outcome_code = v_code, closed_mode = v_mode,
         no_followup_reason = case when v_mode = 'none' then trim(p ->> 'reason') end, no_followup_comment = case when v_mode = 'none' then trim(p ->> 'comment') end
   where id = t.id;
  if v_mode = 'next_task' then
    insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, entry_id, previous_task_id, title, details, due_on, owner_id, source, category)
    values (v_org, t.party_id, t.contact_id, t.agreement_id, t.entry_id, t.id, trim(n ->> 'title'), nullif(trim(coalesce(n ->> 'details', '')), ''), v_due, v_owner, 'follow_up',
            coalesce(nullif(trim(coalesce(n ->> 'category', '')), ''), t.category))
    returning id into v_next;
  end if;
  return v_next;
end $$;

-- Demo tasks already closed get an outcome code.
update public.tasks set outcome_code = case when closed_mode = 'next_task' then 'Information received' when closed_mode = 'none' then 'Resolved' end where status = 'done' and outcome_code is null;

notify pgrst, 'reload schema';
