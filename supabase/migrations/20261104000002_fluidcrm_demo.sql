-- FluidCRM's part of the workspace demo (AGENT_DATA_ACCESS_PLAN.md, "Demo data"). The platform
-- loads the shared demo first (the demo team, 21 companies with contacts, the copier catalogue),
-- then calls load_demo() here as postgres; unload_demo() takes it out again. Every demo row has a
-- demo id (core.demo_uuid), so real deals are never touched.
--
-- Nine open deals for a copier and printer dealer's sales team: Rahul and Amit (sales executives)
-- and Suresh (sales manager), on the same companies the Service Desk knows - Sharma Traders' upgrade
-- follows its paper jams there. Plus three closed deals, so won and lost numbers aren't empty.

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.demo_deal(party integer, owner_key text, tag text, amount numeric, period text, board_pos integer, status text DEFAULT 'open', closed_days_ago integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  created uuid;
BEGIN
  INSERT INTO __APP_SCHEMA__.deals (id, company_id, owner_id, tag, status, value_amount, value_currency, value_period, board_position, closed_at, created_at)
  VALUES (core.demo_uuid(), core.demo_id(3, party), coalesce(core.demo_person(owner_key), (SELECT id FROM core.people WHERE workspace_role = 'owner' LIMIT 1)),
    tag, status, amount, 'INR', period, board_pos,
    CASE WHEN closed_days_ago IS NOT NULL THEN now() - make_interval(days => closed_days_ago) END,
    now() - make_interval(days => coalesce(closed_days_ago, 0) + 25))
  RETURNING id INTO created;
  RETURN created;
END $$;

-- An event `days` from today (negative = in the past); done ones are completed at noon that day.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.demo_event(deal uuid, title text, kind text, days integer, done boolean, sort integer,
  variant text DEFAULT 'default', contact integer DEFAULT NULL, notes text DEFAULT NULL, ai_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  day date := __APP_SCHEMA__.today() + days;
  tz text := coalesce((SELECT timezone FROM core.organisation), 'Asia/Kolkata');
  created uuid;
BEGIN
  INSERT INTO __APP_SCHEMA__.deal_events (id, deal_id, title, event_type, color_variant, event_date, sort_key, owner_kind, owner_contact_id,
    notes, completed_at, origin, ai_review_status, ai_reason, created_by)
  VALUES (core.demo_uuid(), deal, title, kind, variant, day, sort,
    CASE WHEN contact IS NULL THEN 'user' ELSE 'contact' END, CASE WHEN contact IS NOT NULL THEN core.demo_id(4, contact) END,
    notes, CASE WHEN done THEN (day + time '12:00') AT TIME ZONE tz END,
    CASE WHEN ai_reason IS NOT NULL THEN 'ai' ELSE 'manual' END, CASE WHEN ai_reason IS NOT NULL THEN 'pending' END, ai_reason,
    (SELECT owner_id FROM __APP_SCHEMA__.deals WHERE id = deal))
  RETURNING id INTO created;
  RETURN created;
END $$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.demo_reminder(event uuid, days integer, at_time time, channel text, message text, contact integer DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  tz text := coalesce((SELECT timezone FROM core.organisation), 'Asia/Kolkata');
  fire_at timestamptz := ((__APP_SCHEMA__.today() + days) + at_time) AT TIME ZONE tz;
  owner_name text := (SELECT p.name FROM __APP_SCHEMA__.deal_events e JOIN __APP_SCHEMA__.deals d ON (d.id = e.deal_id) JOIN core.people p ON (p.id = d.owner_id) WHERE e.id = event);
BEGIN
  INSERT INTO __APP_SCHEMA__.reminders (id, event_id, remind_at, channel, recipient_kind, recipient_contact_id, recipient_label, message, status, sent_at)
  VALUES (core.demo_uuid(), event, fire_at, channel, CASE WHEN contact IS NULL THEN 'user' ELSE 'contact' END,
    CASE WHEN contact IS NOT NULL THEN core.demo_id(4, contact) END,
    coalesce((SELECT c.name FROM core.contacts c WHERE c.id = core.demo_id(4, contact)), owner_name, 'Me'), message,
    CASE WHEN (SELECT ai_review_status FROM __APP_SCHEMA__.deal_events WHERE id = event) = 'pending' THEN 'draft' WHEN fire_at <= now() THEN 'sent' ELSE 'scheduled' END,
    CASE WHEN fire_at <= now() THEN fire_at END);
END $$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.load_demo() RETURNS void
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  d uuid;
  e uuid;
BEGIN
  -- Loading twice changes nothing
  IF EXISTS (SELECT 1 FROM __APP_SCHEMA__.deals WHERE core.is_demo(id)) THEN RETURN; END IF;
  PERFORM set_config('app.via', 'demo', true);

  PERFORM core.add_demo_member('__APP_SCHEMA__', core.demo_person('suresh'), ARRAY['sales_manager']);
  PERFORM core.add_demo_member('__APP_SCHEMA__', core.demo_person('rahul'), '{}');
  PERFORM core.add_demo_member('__APP_SCHEMA__', core.demo_person('amit'), '{}');

  INSERT INTO __APP_SCHEMA__.company_profiles (party_id, logo_key, logo_color)
  SELECT core.demo_id(3, n), (ARRAY['building', 'hexagon', 'landmark', 'clipboard', 'layers', 'briefcase'])[1 + n % 6], (ARRAY['blue', 'red', 'green', 'orange', 'purple'])[1 + n % 5]
  FROM generate_series(1, 21) n WHERE EXISTS (SELECT 1 FROM core.parties WHERE id = core.demo_id(3, n))
  ON CONFLICT DO NOTHING;
  INSERT INTO __APP_SCHEMA__.contact_profiles (contact_id, is_decision_maker)
  SELECT core.demo_id(4, n), n NOT IN (4, 6, 10, 15, 20)
  FROM generate_series(1, 21) n WHERE EXISTS (SELECT 1 FROM core.contacts WHERE id = core.demo_id(4, n))
  ON CONFLICT DO NOTHING;

  -- Sharma Traders: upgrade the jam-prone iR 2525 (3 service visits in 3 months on the Service Desk)
  d := __APP_SCHEMA__.demo_deal(1, 'rahul', 'warm', 165000, 'one_time', 0);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Service history review', 'review', -6, true, 0, 'default', NULL, '3 service visits in 3 months on the Canon iR 2525, 2 of them paper jams.');
  PERFORM __APP_SCHEMA__.demo_event(d, 'Call with Rajesh', 'call', -3, true, 1, 'default', 1, 'Open to upgrading to the iR 2530 if we take the old machine in exchange.');
  e := __APP_SCHEMA__.demo_event(d, 'Send exchange offer for iR 2530', 'document', 2, false, 2, 'blue', NULL, NULL,
    'Rajesh agreed to upgrade if the iR 2525 is taken in exchange. Sending the written offer within two days keeps it moving.');
  PERFORM __APP_SCHEMA__.demo_reminder(e, 1, '17:00', 'in_app', 'Prepare the exchange value for the iR 2525.');
  PERFORM __APP_SCHEMA__.demo_event(d, 'Demo at the shop', 'demo', 5, false, 3, 'green', 1);

  -- Kohli Diagnostics: two machines for a new lab
  d := __APP_SCHEMA__.demo_deal(16, 'rahul', 'hot', 330000, 'one_time', 1);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Intro call', 'call', -12, true, 0, 'default', 16);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Site visit at the lab', 'site_visit', -8, true, 1, 'default', NULL, 'Needs 2 machines for the new pathology lab. Colour not needed; high volume.');
  PERFORM __APP_SCHEMA__.demo_event(d, 'Quotation for 2 x iR 2530', 'document', -5, true, 2, 'red');
  e := __APP_SCHEMA__.demo_event(d, 'Follow-up call on the quotation', 'call', 1, false, 3, 'default', 16);
  PERFORM __APP_SCHEMA__.demo_reminder(e, 1, '10:00', 'whatsapp', 'Dr. Kohli, can we speak at 11 about the quotation?', 16);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Demo at the lab', 'demo', 4, false, 4, 'blue');

  -- Bharat Coaching Centre: three machines before exam season
  d := __APP_SCHEMA__.demo_deal(17, 'amit', 'warm', 240000, 'one_time', 2);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Walk-in enquiry', 'outreach', -10, true, 0, 'default', 17);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Demo of Ricoh MP 2014', 'demo', -3, true, 1, 'blue', NULL, 'Liked the speed. Price is the sticking point.');
  PERFORM __APP_SCHEMA__.demo_event(d, 'Price negotiation', 'negotiation', 2, false, 2, 'purple', 17);
  e := __APP_SCHEMA__.demo_event(d, 'Offer labour-only AMC with the 3 machines', 'pricing', 5, false, 3, 'default', NULL, NULL,
    'Coaching centres print heavily before exams. Bundling a labour-only AMC usually closes the price gap.');
  PERFORM __APP_SCHEMA__.demo_reminder(e, 4, '18:00', 'in_app', 'Work out the AMC bundle price.');

  -- Shree Balaji Exports: colour copier, pricing call overdue
  d := __APP_SCHEMA__.demo_deal(18, 'rahul', 'enterprise', 285000, 'one_time', 3);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Call with Mukesh', 'call', -15, true, 0, 'default', 18);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Proposal for Kyocera TASKalfa 2554ci', 'document', -7, true, 1, 'red');
  PERFORM __APP_SCHEMA__.demo_event(d, 'Pricing discussion', 'pricing', -2, false, 2, 'default', 18);

  -- Unique Interiors: cold, waiting on them
  d := __APP_SCHEMA__.demo_deal(19, 'amit', 'cold', 195000, 'one_time', 4);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Outreach', 'outreach', -20, true, 0);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Follow-up email', 'email', 7, false, 1);

  -- Pitampura Polyclinic: site visit today
  d := __APP_SCHEMA__.demo_deal(20, 'rahul', 'warm', 116000, 'one_time', 5);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Enquiry call', 'call', -4, true, 0, 'default', 20);
  e := __APP_SCHEMA__.demo_event(d, 'Site visit', 'site_visit', 0, false, 1, 'green');
  PERFORM __APP_SCHEMA__.demo_reminder(e, 0, '09:00', 'whatsapp', 'Visit Pitampura Polyclinic at 12. Carry the Sharp AR-6020 brochure.');

  -- Faridabad Auto Components: fleet of five with a comprehensive AMC
  d := __APP_SCHEMA__.demo_deal(21, 'suresh', 'enterprise', 900000, 'yearly', 6);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Meeting with the plant head', 'meeting', -14, true, 0, 'default', 21);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Requirement document', 'document', -9, true, 1, 'blue', NULL, '5 machines across 3 shop floors, comprehensive AMC, 4-hour response.');
  PERFORM __APP_SCHEMA__.demo_event(d, 'Trial installation', 'onboarding', -1, false, 2, 'purple');
  PERFORM __APP_SCHEMA__.demo_event(d, 'Contract signing', 'contract', 10, false, 3, 'red');

  -- Apex Logistics (a customer): a second colour machine
  d := __APP_SCHEMA__.demo_deal(4, 'amit', 'hot', 285000, 'one_time', 7);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Call with Pooja', 'call', -6, true, 0, 'default', 4);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Quotation', 'document', 1, false, 1, 'red');

  -- Green Valley Hospital (a customer): AMC renewal for two machines
  d := __APP_SCHEMA__.demo_deal(10, 'suresh', 'warm', 36000, 'yearly', 8);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Renewal call', 'call', 3, false, 0, 'default', 10);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Renewal contract', 'contract', 12, false, 1, 'red');

  -- Closed: two won, one lost
  d := __APP_SCHEMA__.demo_deal(11, 'amit', 'warm', 62000, 'one_time', 9, 'won', 20);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Order received', 'closing', -20, true, 0, 'green');
  d := __APP_SCHEMA__.demo_deal(9, 'amit', 'hot', 285000, 'one_time', 10, 'won', 35);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Order received', 'closing', -35, true, 0, 'green');
  d := __APP_SCHEMA__.demo_deal(7, 'rahul', 'cold', 58000, 'one_time', 11, 'lost', 12);
  PERFORM __APP_SCHEMA__.demo_event(d, 'Went with a cheaper refurbished machine', 'feedback', -12, true, 0);
END $$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.unload_demo() RETURNS void
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  PERFORM set_config('app.via', 'demo', true);
  -- Events, reminders and history go with their deals
  DELETE FROM __APP_SCHEMA__.deals WHERE core.is_demo(id);
  DELETE FROM __APP_SCHEMA__.company_profiles WHERE core.is_demo(party_id);
  DELETE FROM __APP_SCHEMA__.contact_profiles WHERE core.is_demo(contact_id);
END $$;

REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.demo_deal(integer, text, text, numeric, text, integer, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.demo_event(uuid, text, text, integer, boolean, integer, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.demo_reminder(uuid, integer, time, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.load_demo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.unload_demo() FROM PUBLIC, anon, authenticated;
