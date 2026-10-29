-- Fictional demo data for an organisation called "Alchemy Demo": 5 inbound (brand owner) and 5 outbound (customer) investments,
-- with contacts, meetings, notes, decisions, tasks, payments, volume targets and reviews. Safe to run once; it does nothing if the demo exists.
-- Replace __OWNER_EMAIL__ with the email address of the person who will be the demo's superuser. Needs 0003_demo_support.sql first.
create function pg_temp.ts(d int, t text default '10:00') returns timestamptz language sql as $$ select ((current_date + d) + t::time) at time zone 'Europe/London' $$;

create function pg_temp.mk_party(p_org uuid, p_side text, p_parent uuid, p_type text, p_name text, p_status text, p_owner uuid, p_phone text, p_email text, p_web text, p_addr text, p_notes text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.parties (organisation_id, side, parent_id, node_type, name, status, owner_id, phone, email, website, address, notes, created_by)
  values (p_org, p_side, p_parent, p_type, p_name, p_status, p_owner, p_phone, p_email, p_web, p_addr, p_notes, p_owner) returning id into v_id;
  return v_id;
end $$;

create function pg_temp.mk_contact(p_org uuid, p_party uuid, p_name text, p_title text, p_email text, p_phone text, p_mobile text, p_key boolean, p_notes text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.contacts (organisation_id, party_id, name, job_title, email, phone, mobile, is_key, notes, created_by)
  values (p_org, p_party, p_name, p_title, p_email, p_phone, p_mobile, p_key, p_notes, '00000000-0000-4000-8000-0000000000a1') returning id into v_id;
  return v_id;
end $$;

create function pg_temp.mk_agr(p_org uuid, p_party uuid, p_title text, p_kind text, p_status text, p_amount numeric, p_basis text, p_start date, p_end date, p_excl boolean, p_excl_detail text, p_excl_end date, p_end_action text, p_owner uuid, p_notes text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.agreements (organisation_id, party_id, title, kind, status, amount, amount_basis, start_on, end_on, has_exclusivity, exclusivity_detail, exclusivity_ends_on, end_action, owner_id, notes, created_by)
  values (p_org, p_party, p_title, p_kind, p_status, p_amount, p_basis, p_start, p_end, p_excl, p_excl_detail, p_excl_end, p_end_action, p_owner, p_notes, p_owner) returning id into v_id;
  return v_id;
end $$;

create function pg_temp.mk_pay(p_org uuid, p_agr uuid, p_due date, p_amount numeric, p_status text, p_done date, p_ref text) returns void language plpgsql as $$
begin
  insert into public.agreement_payments (organisation_id, agreement_id, due_on, amount, status, done_on, reference, created_by) values (p_org, p_agr, p_due, p_amount, p_status, p_done, p_ref, '00000000-0000-4000-8000-0000000000a1');
end $$;

create function pg_temp.mk_tgt(p_org uuid, p_agr uuid, p_scope text, p_product text, p_qty numeric, p_unit text, p_ps date, p_pe date, p_note text) returns void language plpgsql as $$
begin
  insert into public.agreement_targets (organisation_id, agreement_id, scope, product, quantity, unit, period_start, period_end, note, created_by) values (p_org, p_agr, p_scope, p_product, p_qty, p_unit, p_ps, p_pe, p_note, '00000000-0000-4000-8000-0000000000a1');
end $$;

create function pg_temp.mk_rev(p_org uuid, p_agr uuid, p_on date, p_status text, p_note text, p_short numeric, p_outcome text) returns void language plpgsql as $$
begin
  insert into public.agreement_reviews (organisation_id, agreement_id, reviewed_on, status, note, shortfall_amount, shortfall_outcome, created_by) values (p_org, p_agr, p_on, p_status, p_note, p_short, p_outcome, '00000000-0000-4000-8000-0000000000a1');
end $$;

-- An entry, and (when p_task is given) the follow-up task it must come with. Otherwise a reason and comment are required.
create function pg_temp.mk_entry(p_org uuid, p_party uuid, p_contact uuid, p_agr uuid, p_kind text, p_title text, p_body text, p_when timestamptz, p_where text, p_who text, p_decision boolean, p_by uuid,
                                 p_task text, p_due int, p_owner uuid, p_reason text, p_comment text) returns uuid language plpgsql as $$
declare v_id uuid; v_status text;
begin
  v_status := case when p_kind = 'meeting' then case when p_when > now() then 'scheduled' else 'held' end end;
  insert into public.entries (organisation_id, party_id, contact_id, agreement_id, kind, title, body, occurred_at, location, attendees, is_decision, meeting_status, followup_mode, no_followup_reason, no_followup_comment, created_by)
  values (p_org, p_party, p_contact, p_agr, p_kind, p_title, p_body, p_when, p_where, p_who, p_decision or p_kind = 'decision', v_status, case when p_task is null then 'none' else 'task' end,
          case when p_task is null then p_reason end, case when p_task is null then p_comment end, p_by) returning id into v_id;
  if p_task is not null then
    insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, entry_id, title, due_on, owner_id, source, created_by)
    values (p_org, p_party, p_contact, p_agr, v_id, p_task, current_date + p_due, p_owner, 'follow_up', p_by);
  end if;
  return v_id;
end $$;

do $$
declare
  sam constant uuid := '00000000-0000-4000-8000-0000000000a1'; priya constant uuid := '00000000-0000-4000-8000-0000000000a2'; tom constant uuid := '00000000-0000-4000-8000-0000000000a3';
  v_org uuid; r jsonb;
  mc uuid; carling uuid; carling_keg uuid; coorslight uuid; hv uuid; amstel uuid; dg uuid; guinness uuid; asahi uuid; peroni uuid; mahou uuid;
  bp uuid; mid uuid; plough uuid; redlion uuid; nt uuid; york uuid; leeds uuid; tapped uuid; ginnel uuid; rr uuid; rrb uuid; rrbath uuid; crown uuid; harvest uuid;
  c_hannah uuid; c_eleanor uuid; c_callum uuid; c_nina uuid; c_oliver uuid; c_sofia uuid; c_gareth uuid; c_sandra uuid; c_ian uuid; c_rachel uuid; c_daniel uuid; c_fiona uuid; c_pete uuid; c_marcus uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  t1 uuid; t2 uuid; e uuid;
begin
  if exists (select 1 from public.organisations where slug = 'alchemy-demo') then raise notice 'The demo organisation already exists'; return; end if;
  r := public.create_organisation('Alchemy Demo', 'alchemy-demo', '__OWNER_EMAIL__');
  v_org := (r ->> 'organisation_id')::uuid;
  insert into public.profiles (id, email, display_name) values (sam, 'sam.hartley@demo.invalid', 'Sam Hartley (demo)'), (priya, 'priya.nair@demo.invalid', 'Priya Nair (demo)'), (tom, 'tom.beaumont@demo.invalid', 'Tom Beaumont (demo)');
  insert into public.memberships (organisation_id, user_id, role) values (v_org, sam, 'admin'), (v_org, priya, 'admin'), (v_org, tom, 'reviewer');

  -- ===== Brand owners (money in) =====
  mc := pg_temp.mk_party(v_org, 'brand', null, 'brand_owner', 'Molson Coors', 'active', sam, '0121 496 0100', 'trade@molsoncoors.example', 'molsoncoors.example', 'Burton upon Trent', 'Main supplier of lager to the Alchemy draught range.');
  carling := pg_temp.mk_party(v_org, 'brand', mc, 'brand', 'Carling', 'active', sam, null, null, null, null, 'Volume brand. Quarterly volume reviews.');
  carling_keg := pg_temp.mk_party(v_org, 'brand', carling, 'product', 'Carling 50L keg', 'active', sam, null, null, null, null, null);
  coorslight := pg_temp.mk_party(v_org, 'brand', mc, 'brand', 'Coors Light', 'active', priya, null, null, null, null, 'Launch push this winter.');
  hv := pg_temp.mk_party(v_org, 'brand', null, 'brand_owner', 'Heineken UK', 'active', sam, '020 7946 0200', 'freetrade@heineken.example', 'heineken.example', 'Hammersmith, London', 'Exclusivity renewal due in the spring.');
  amstel := pg_temp.mk_party(v_org, 'brand', hv, 'brand', 'Amstel', 'active', sam, null, null, null, null, null);
  dg := pg_temp.mk_party(v_org, 'brand', null, 'brand_owner', 'Diageo GB', 'active', priya, '020 7946 0300', 'gb.trade@diageo.example', 'diageo.example', 'Park Royal, London', null);
  guinness := pg_temp.mk_party(v_org, 'brand', dg, 'brand', 'Guinness', 'active', priya, null, null, null, null, null);
  asahi := pg_temp.mk_party(v_org, 'brand', null, 'brand_owner', 'Asahi UK', 'active', priya, '01923 555 0400', 'uk.sales@asahi.example', 'asahi.example', 'Watford', 'Peroni Nastro Azzurro and Grolsch.');
  peroni := pg_temp.mk_party(v_org, 'brand', asahi, 'brand', 'Peroni Nastro Azzurro', 'active', priya, null, null, null, null, null);
  mahou := pg_temp.mk_party(v_org, 'brand', null, 'brand_owner', 'Mahou San Miguel UK', 'active', sam, null, 'uk@mahou.example', null, null, 'Early conversations only. Nothing is scheduled.');

  c_eleanor := pg_temp.mk_contact(v_org, mc, 'Eleanor Whitfield', 'Key Account Director', 'eleanor.whitfield@molsoncoors.example', '0121 496 0101', '07700 900101', true, 'Decision maker for all Molson Coors support.');
  c_marcus := pg_temp.mk_contact(v_org, mc, 'Marcus Reid', 'Trade Marketing Manager', 'marcus.reid@molsoncoors.example', null, '07700 900102', false, null);
  c_hannah := pg_temp.mk_contact(v_org, carling, 'Hannah Doyle', 'Carling Brand Manager', 'hannah.doyle@molsoncoors.example', '0121 496 0105', '07700 900103', true, 'Prefers a short email before a call.');
  c_callum := pg_temp.mk_contact(v_org, hv, 'Callum Rhodes', 'Head of Free Trade', 'callum.rhodes@heineken.example', '020 7946 0201', '07700 900201', true, null);
  c_nina := pg_temp.mk_contact(v_org, amstel, 'Nina Verma', 'Amstel Brand Manager', 'nina.verma@heineken.example', null, '07700 900202', false, null);
  c_oliver := pg_temp.mk_contact(v_org, guinness, 'Oliver Grant', 'Account Manager', 'oliver.grant@diageo.example', '020 7946 0301', '07700 900301', true, null);
  c_sofia := pg_temp.mk_contact(v_org, asahi, 'Sofia Marchetti', 'Customer Director', 'sofia.marchetti@asahi.example', '01923 555 0401', '07700 900401', true, null);

  a1 := pg_temp.mk_agr(v_org, carling, 'Carling keg volume support 2026', 'Cash contribution', 'live', 50000, 'per_year', '2026-01-01', '2026-12-31', false, null, null, 'Review and renegotiate for 2027', sam, 'Paid quarterly against volume.');
  perform pg_temp.mk_pay(v_org, a1, '2026-01-31', 12500, 'done', '2026-02-03', 'MC-INV-2026-001');
  perform pg_temp.mk_pay(v_org, a1, '2026-04-30', 12500, 'done', '2026-05-06', 'MC-INV-2026-014');
  perform pg_temp.mk_pay(v_org, a1, '2026-07-31', 12500, 'done', '2026-08-04', 'MC-INV-2026-027');
  perform pg_temp.mk_pay(v_org, a1, '2026-11-15', 12500, 'planned', null, null);
  perform pg_temp.mk_tgt(v_org, a1, 'product', 'Carling 50L keg', 4000, 'kegs', '2026-01-01', '2026-12-31', 'Calendar year target');
  perform pg_temp.mk_rev(v_org, a1, '2026-07-15', 'on_track', 'H1 volumes 4% ahead of the profile.', null, null);
  perform pg_temp.mk_rev(v_org, a1, '2026-10-12', 'at_risk', 'September fell back after the heatwave ended. Need roughly 520 kegs a month to land the target.', null, null);

  a2 := pg_temp.mk_agr(v_org, coorslight, 'Coors Light launch marketing fund', 'Marketing or promotion', 'agreed', 15000, 'total', '2026-11-01', '2027-03-31', false, null, null, 'Final report to Molson Coors', priya, 'Funds point of sale and a social campaign.');
  perform pg_temp.mk_pay(v_org, a2, '2026-11-30', 7500, 'planned', null, null);
  perform pg_temp.mk_pay(v_org, a2, '2027-02-28', 7500, 'planned', null, null);
  perform pg_temp.mk_tgt(v_org, a2, 'product', 'Coors Light 50L keg', 600, 'kegs', '2026-11-01', '2027-03-31', 'Launch period');

  a3 := pg_temp.mk_agr(v_org, amstel, 'Amstel draught exclusivity deal', 'Cash contribution', 'live', 30000, 'per_year', '2026-04-01', '2027-03-31', true, 'Amstel is the only premium lager on Alchemy draught lines', '2027-03-31', 'Renew on the same terms if volumes are met', sam, null);
  perform pg_temp.mk_pay(v_org, a3, '2026-04-15', 15000, 'done', '2026-04-22', 'HUK-5530');
  perform pg_temp.mk_pay(v_org, a3, '2026-10-15', 15000, 'planned', null, null);
  perform pg_temp.mk_tgt(v_org, a3, 'product', 'Amstel 50L keg', 2500, 'kegs', '2026-04-01', '2027-03-31', null);
  perform pg_temp.mk_rev(v_org, a3, '2026-09-30', 'missed', 'First half-year came in 12% short of the target profile.', 2400, 'carried_forward');

  a4 := pg_temp.mk_agr(v_org, guinness, 'Guinness font and glassware package', 'Equipment', 'live', 22000, 'total', '2026-01-01', '2026-12-31', false, null, null, 'Equipment stays with Alchemy', priya, null);
  perform pg_temp.mk_pay(v_org, a4, '2026-02-01', 22000, 'done', '2026-02-12', 'DG-7781');
  perform pg_temp.mk_tgt(v_org, a4, 'product', 'Guinness Draught 50L keg', 600, 'kegs', '2026-01-01', '2026-12-31', null);
  perform pg_temp.mk_rev(v_org, a4, '2026-09-20', 'on_track', 'Ahead of target after the autumn promotion.', null, null);

  a5 := pg_temp.mk_agr(v_org, peroni, 'Peroni listing rebate 2027', 'Rebate', 'agreed', 18000, 'per_year', '2027-01-01', '2027-12-31', false, null, null, 'Review', priya, 'Terms agreed in principle; contract in draft.');
  perform pg_temp.mk_pay(v_org, a5, '2027-03-31', 9000, 'planned', null, null);
  perform pg_temp.mk_pay(v_org, a5, '2027-09-30', 9000, 'planned', null, null);
  perform pg_temp.mk_tgt(v_org, a5, 'all_sales', null, 1200, 'cases', '2027-01-01', '2027-12-31', 'Bottled Peroni across the estate');

  -- ===== Customers (money out) =====
  bp := pg_temp.mk_party(v_org, 'customer', null, 'group', 'Brightside Pub Co', 'active', sam, '0121 496 0500', 'office@brightside.example', 'brightside.example', 'Birmingham', 'Twelve pubs across the Midlands. Our largest customer.');
  mid := pg_temp.mk_party(v_org, 'customer', bp, 'sub_group', 'Midlands', 'active', sam, null, null, null, null, null);
  plough := pg_temp.mk_party(v_org, 'customer', mid, 'site', 'The Plough, Harborne', 'active', priya, '0121 496 0510', 'plough@brightside.example', null, '14 High Street, Harborne', 'Refitted in June. Busy food trade.');
  redlion := pg_temp.mk_party(v_org, 'customer', mid, 'site', 'The Red Lion, Moseley', 'active', priya, '0121 496 0511', null, null, 'Moseley Village', null);
  nt := pg_temp.mk_party(v_org, 'customer', null, 'group', 'Northern Taverns', 'active', sam, '0113 496 0600', 'hello@northerntaverns.example', 'northerntaverns.example', 'Leeds', 'Thirty-one pubs. Price sensitive.');
  york := pg_temp.mk_party(v_org, 'customer', nt, 'sub_group', 'Yorkshire', 'active', sam, null, null, null, null, null);
  leeds := pg_temp.mk_party(v_org, 'customer', york, 'sub_group', 'Leeds', 'active', sam, null, null, null, null, null);
  tapped := pg_temp.mk_party(v_org, 'customer', leeds, 'site', 'The Tapped Barrel', 'active', sam, '0113 496 0610', null, null, 'Call Lane, Leeds', null);
  ginnel := pg_temp.mk_party(v_org, 'customer', leeds, 'site', 'The Ginnel Arms', 'active', sam, '0113 496 0611', null, null, 'The Ginnel, Leeds', null);
  rr := pg_temp.mk_party(v_org, 'customer', null, 'group', 'Riverside Restaurants', 'prospect', priya, '0117 496 0700', 'bar@riverside.example', 'riverside.example', 'Bristol', 'Two restaurants with large cocktail and beer menus.');
  rrb := pg_temp.mk_party(v_org, 'customer', rr, 'site', 'Riverside Bristol', 'prospect', priya, null, null, null, 'Harbourside, Bristol', null);
  rrbath := pg_temp.mk_party(v_org, 'customer', rr, 'site', 'Riverside Bath', 'prospect', priya, null, null, null, 'Pulteney Bridge, Bath', null);
  crown := pg_temp.mk_party(v_org, 'customer', null, 'site', 'The Crown and Anchor, Margate', 'ended', sam, '01843 555 0800', null, null, 'Margate', 'Left Alchemy in the summer.');
  harvest := pg_temp.mk_party(v_org, 'customer', null, 'group', 'Harvest Table Inns', 'prospect', priya, null, 'info@harvesttable.example', 'harvesttable.example', 'Norwich', 'Seven country inns. Introductory stage.');

  c_gareth := pg_temp.mk_contact(v_org, bp, 'Gareth Lloyd', 'Operations Director', 'gareth.lloyd@brightside.example', '0121 496 0501', '07700 900501', true, 'Signs off all investment. Likes numbers on one page.');
  perform pg_temp.mk_contact(v_org, bp, 'Jo Patel', 'Procurement Manager', 'jo.patel@brightside.example', '0121 496 0502', null, false, null);
  c_sandra := pg_temp.mk_contact(v_org, plough, 'Sandra Kerr', 'Landlady', 'sandra.kerr@brightside.example', '0121 496 0510', '07700 900511', true, null);
  c_ian := pg_temp.mk_contact(v_org, nt, 'Ian McBride', 'Managing Director', 'ian.mcbride@northerntaverns.example', '0113 496 0601', '07700 900601', true, null);
  c_rachel := pg_temp.mk_contact(v_org, york, 'Rachel Ford', 'Area Manager, Yorkshire', 'rachel.ford@northerntaverns.example', null, '07700 900602', false, null);
  c_daniel := pg_temp.mk_contact(v_org, rr, 'Daniel Okafor', 'Group Bar Manager', 'daniel.okafor@riverside.example', '0117 496 0701', '07700 900701', true, null);
  c_pete := pg_temp.mk_contact(v_org, crown, 'Pete Marlow', 'Licensee', null, '01843 555 0800', '07700 900801', true, null);
  c_fiona := pg_temp.mk_contact(v_org, harvest, 'Fiona Gallagher', 'Director', 'fiona.gallagher@harvesttable.example', null, '07700 900901', true, null);

  c1 := pg_temp.mk_agr(v_org, bp, 'Brightside draught investment 2026-27', 'Cash contribution', 'live', 40000, 'per_year', '2026-02-01', '2028-01-31', true, 'Alchemy lager range on every tap in every Brightside pub', '2028-01-31', 'Renegotiate in the final six months', sam, 'Two-year deal agreed after the 2025 review.');
  perform pg_temp.mk_pay(v_org, c1, '2026-02-15', 20000, 'done', '2026-02-16', 'PAY-0211');
  perform pg_temp.mk_pay(v_org, c1, '2026-08-15', 20000, 'done', '2026-08-14', 'PAY-0348');
  perform pg_temp.mk_pay(v_org, c1, '2027-02-15', 20000, 'planned', null, null);
  perform pg_temp.mk_tgt(v_org, c1, 'all_sales', null, 3000, 'kegs', '2026-02-01', '2027-01-31', 'Year one, whole estate');
  perform pg_temp.mk_tgt(v_org, c1, 'product', 'Peroni 30L keg', 800, 'kegs', '2026-02-01', '2027-01-31', null);
  perform pg_temp.mk_rev(v_org, c1, '2026-09-10', 'on_track', 'Seven months in, 61% of the year-one target.', null, null);

  c2 := pg_temp.mk_agr(v_org, plough, 'The Plough bar refit contribution', 'Equipment', 'live', 12000, 'total', '2026-06-01', '2027-05-31', false, null, null, 'Equipment remains the pub''s', priya, null);
  perform pg_temp.mk_pay(v_org, c2, '2026-06-01', 12000, 'done', '2026-06-02', 'PAY-0301');
  perform pg_temp.mk_tgt(v_org, c2, 'product', 'Carling 50L keg', 250, 'kegs', '2026-06-01', '2027-05-31', null);
  perform pg_temp.mk_rev(v_org, c2, '2026-10-05', 'on_track', 'On pace after the first four months.', null, null);

  c3 := pg_temp.mk_agr(v_org, nt, 'Northern Taverns price support 2026', 'Discount or price support', 'live', 60000, 'per_year', '2026-01-01', '2026-12-31', false, null, null, 'Renegotiate for 2027', sam, 'Quarterly payments against agreed prices.');
  perform pg_temp.mk_pay(v_org, c3, '2026-01-31', 15000, 'done', '2026-01-30', 'PAY-0188');
  perform pg_temp.mk_pay(v_org, c3, '2026-04-30', 15000, 'done', '2026-04-29', 'PAY-0262');
  perform pg_temp.mk_pay(v_org, c3, '2026-07-31', 15000, 'done', '2026-07-31', 'PAY-0330');
  perform pg_temp.mk_pay(v_org, c3, current_date + 2, 15000, 'planned', null, null);
  perform pg_temp.mk_tgt(v_org, c3, 'all_sales', null, 5500, 'kegs', '2026-01-01', '2026-12-31', 'Whole estate');
  perform pg_temp.mk_rev(v_org, c3, '2026-09-25', 'at_risk', 'Volumes are about 8% below profile. Ian blames the weather and two closures for refurbishment.', null, null);

  c4 := pg_temp.mk_agr(v_org, leeds, 'Leeds tap takeover free stock', 'Free stock', 'agreed', 5000, 'total', '2026-11-01', '2027-01-31', false, null, null, 'Review the effect on Leeds volumes', sam, 'Free kegs for a winter tap takeover in the Leeds pubs.');
  perform pg_temp.mk_tgt(v_org, c4, 'all_sales', null, 400, 'kegs', '2026-11-01', '2027-01-31', 'Both Leeds pubs');

  c5 := pg_temp.mk_agr(v_org, rrb, 'Riverside Bristol listing fee', 'Listing fee', 'proposed', 8000, 'total', '2027-01-01', '2027-12-31', true, 'Alchemy beer on the main bar', '2027-12-31', 'Review', priya, 'Proposal sent. Not yet agreed.');
  perform pg_temp.mk_tgt(v_org, c5, 'all_sales', null, 300, 'kegs', '2027-01-01', '2027-12-31', null);

  -- ===== Notes, calls and meetings. Each ends with a follow-up task, or a reason and a comment. =====
  e := pg_temp.mk_entry(v_org, carling, c_hannah, a1, 'meeting', 'Q3 volume review with Carling', 'Walked through July to September volumes. Draught is on plan but the heatwave flattered August. Hannah will see if the autumn promotion can be brought forward.', pg_temp.ts(-45, '14:00'), 'Molson Coors office, Birmingham', 'Hannah Doyle, Eleanor Whitfield, Sam Hartley', false, sam, 'Send Q3 draught volumes pack to Hannah', 3, sam, null, null);
  e := pg_temp.mk_entry(v_org, carling, c_hannah, a1, 'call', 'Kegs behind plan: agreed to push the autumn promotion', 'September fell short. Agreed to run a two-week Carling promotion across the Brightside pubs in November.', pg_temp.ts(-10, '11:30'), null, 'Hannah Doyle', true, sam, 'Agree the November Carling promotion plan', 6, priya, null, null);
  e := pg_temp.mk_entry(v_org, mc, c_eleanor, a2, 'decision', 'Agreed £15k Coors Light launch fund', 'Eleanor confirmed £15,000 for the Coors Light launch, paid in two halves. Side letter to follow.', pg_temp.ts(-30, '16:00'), null, 'Eleanor Whitfield', true, priya, 'Get the signed side letter back from Molson Coors', 9, priya, null, null);
  e := pg_temp.mk_entry(v_org, amstel, c_nina, a3, 'email', 'Amstel October payment chased', 'The £15,000 October payment is two weeks late. Emailed Nina to find out where it is stuck.', pg_temp.ts(-6, '09:15'), null, null, false, sam, 'Chase Heineken finance for the £15k Amstel payment', -2, sam, null, null);
  e := pg_temp.mk_entry(v_org, hv, c_callum, a3, 'meeting', 'Exclusivity renewal discussion', 'Open the renewal conversation ahead of the March expiry. Bring the volume position and the shortfall carried forward.', pg_temp.ts(5, '10:30'), 'Heineken UK, Hammersmith', 'Callum Rhodes, Sam Hartley', false, sam, 'Prepare the renewal position paper', 3, sam, null, null);
  e := pg_temp.mk_entry(v_org, guinness, c_oliver, a4, 'note', 'Glassware and font delivery confirmed', 'All branded glassware delivered and the new fonts installed in the first six pubs.', pg_temp.ts(-20, '12:00'), null, null, false, priya, null, null, null, 'Information only, nothing to chase', 'Delivery confirmed by Oliver. Nothing outstanding on the equipment.');
  e := pg_temp.mk_entry(v_org, peroni, c_sofia, a5, 'call', 'Peroni 2027 listing rebate terms', 'Agreed in principle: £18k a year, paid half-yearly, against 1,200 cases. Sofia will send a draft contract.', pg_temp.ts(-3, '15:00'), null, 'Sofia Marchetti', true, priya, 'Review the Peroni rebate draft contract', 12, priya, null, null);
  e := pg_temp.mk_entry(v_org, mahou, null, null, 'note', 'Introduced by a mutual contact', 'Brief chat at a trade event. They are looking for a UK draught partner but have nothing to discuss yet.', pg_temp.ts(-35, '18:00'), 'Trade show', null, false, sam, null, null, null, 'Information only, nothing to chase', 'Nothing to follow up until they come back to us.');

  e := pg_temp.mk_entry(v_org, bp, c_gareth, c1, 'meeting', 'Annual investment review', 'Reviewed year one. Gareth is happy with the draught range and wants a higher contribution tied to Peroni. We agreed to model a 2027 proposal.', pg_temp.ts(-28, '10:00'), 'Brightside head office, Birmingham', 'Gareth Lloyd, Jo Patel, Sam Hartley', true, sam, 'Draft the 2027 draught investment proposal', 14, sam, null, null);
  e := pg_temp.mk_entry(v_org, plough, c_sandra, c2, 'visit', 'Post-refit visit', 'Bar looks excellent and food trade is strong. Sandra would like a second Peroni font.', pg_temp.ts(-14, '17:00'), 'The Plough, Harborne', 'Sandra Kerr', false, priya, 'Check Carling keg volumes with Sandra', 7, priya, null, null);
  e := pg_temp.mk_entry(v_org, nt, c_ian, a3 /* placeholder replaced below */, 'call', 'Volumes running 8% under target', 'Ian explained the weather and two closed pubs. Agreed to look at options before the October payment.', pg_temp.ts(-4, '14:30'), null, 'Ian McBride', false, sam, 'Prepare shortfall options for Ian', 2, sam, null, null);
  update public.entries set agreement_id = c3 where id = e;
  e := pg_temp.mk_entry(v_org, york, c_rachel, null, 'meeting', 'Yorkshire area manager catch-up', 'Regular catch-up with Rachel to go through site by site sales.', pg_temp.ts(9, '11:00'), 'Leeds', 'Rachel Ford, Sam Hartley', false, sam, 'Collect Q3 sales by site from Rachel', 8, sam, null, null);
  e := pg_temp.mk_entry(v_org, leeds, c_rachel, c4, 'decision', 'Free stock for the Leeds tap takeover approved', 'Approved £5,000 of free stock for November to January across both Leeds pubs.', pg_temp.ts(-2, '13:00'), null, 'Rachel Ford', true, priya, 'Confirm the free stock delivery date', 4, priya, null, null);
  e := pg_temp.mk_entry(v_org, rr, c_daniel, null, 'email', 'Listing fee proposal sent', 'Sent Daniel the proposal for Riverside Bristol: £8,000 listing fee for exclusive beer on the main bar.', pg_temp.ts(-9, '10:45'), null, null, false, priya, 'Follow up on the Riverside listing proposal', 6, sam, null, null);
  update public.entries set agreement_id = c5 where id = e;
  e := pg_temp.mk_entry(v_org, crown, c_pete, null, 'call', 'Pete is moving to a rival supplier', 'Pete called to say he has signed with another supplier from next month. No investment was ever made at this pub.', pg_temp.ts(-60, '16:20'), null, 'Pete Marlow', true, sam, null, null, null, 'No longer a customer', 'Pete has signed a supply agreement with a rival, so this relationship is closed.');
  e := pg_temp.mk_entry(v_org, harvest, c_fiona, null, 'meeting', 'Introduction to Harvest Table Inns', 'Fiona runs seven country inns and wants a draught supplier with some investment support. Discussed what Alchemy can offer.', pg_temp.ts(-7, '11:00'), 'Norwich', 'Fiona Gallagher, Priya Nair', false, priya, 'Send Fiona introductory pricing', -1, priya, null, null);

  -- A chain of tasks on Brightside: each closed task led to the next.
  insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, title, due_on, owner_id, status, source, completed_at, completed_by, outcome, closed_mode, created_by)
  values (v_org, bp, c_gareth, c1, 'Prepare the annual review pack for Brightside', current_date - 36, sam, 'done', 'manual', now() - interval '31 days', sam, 'Pack sent to Gareth with the year-one figures.', 'next_task', sam) returning id into t1;
  insert into public.tasks (organisation_id, party_id, contact_id, agreement_id, previous_task_id, title, due_on, owner_id, status, source, completed_at, completed_by, outcome, closed_mode, created_by)
  values (v_org, bp, c_gareth, c1, t1, 'Hold the annual review meeting with Gareth', current_date - 28, sam, 'done', 'follow_up', now() - interval '28 days', sam, 'Meeting held, decisions recorded.', 'next_task', sam) returning id into t2;
  update public.tasks set previous_task_id = t2 where entry_id = (select id from public.entries where party_id = bp and kind = 'meeting' limit 1) and status = 'open';
  -- One task whose date has moved twice.
  update public.tasks set reschedule_count = 2, reschedule_reason = 'Waiting for Heineken finance to confirm the payment run' where title = 'Chase Heineken finance for the £15k Amstel payment' and organisation_id = v_org;
  -- Some tasks that are not tied to a note.
  insert into public.tasks (organisation_id, title, details, due_on, owner_id, source, created_by) values
    (v_org, 'Prepare the quarterly investment pack for the MD', 'Money in and out, by brand owner and customer, with shortfalls.', current_date + 20, sam, 'manual', sam),
    (v_org, 'Review the list of investment kinds with Finance', null, current_date + 30, priya, 'manual', priya);
end $$;
