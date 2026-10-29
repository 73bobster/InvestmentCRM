-- Demo support: when the first superuser joins the "Alchemy Demo" organisation they take over the seat of the demo user "Sam Hartley",
-- so their Tasks screen and dashboard are full of example work straight away. Does nothing in any other organisation.
create or replace function app.demo_adopt() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_slug text; v_sam constant uuid := '00000000-0000-4000-8000-0000000000a1';
begin
  select slug into v_slug from public.organisations where id = new.organisation_id;
  if v_slug = 'alchemy-demo' and new.role = 'superuser' and new.status = 'active' then
    update public.tasks set owner_id = new.user_id where organisation_id = new.organisation_id and owner_id = v_sam and status = 'open';
    update public.parties set owner_id = new.user_id where organisation_id = new.organisation_id and owner_id = v_sam;
    update public.agreements set owner_id = new.user_id where organisation_id = new.organisation_id and owner_id = v_sam;
  end if;
  return new;
end $$;
create trigger memberships_demo_adopt after insert on public.memberships for each row execute function app.demo_adopt();

-- One more reason for the "no follow-up" list: a meeting that is already in the diary is itself the next step.
create or replace function app.seed_lists() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'investment_kind', n, i * 10 from unnest(array['Cash contribution', 'Discount or price support', 'Free stock', 'Equipment', 'Marketing or promotion', 'Rebate', 'Listing fee', 'Other']) with ordinality as t(n, i);
  insert into public.list_items (organisation_id, list, name, sort_order)
  select new.id, 'no_followup_reason', n, i * 10 from unnest(array['No longer a customer', 'Decision: no investment going forward', 'Brand delisted or relationship ended', 'Information only, nothing to chase', 'Handed to someone else', 'Other (explain below)']) with ordinality as t(n, i);
  return new;
end $$;
notify pgrst, 'reload schema';
