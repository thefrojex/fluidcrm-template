-- What the platform's assistant (WhatsApp) can do in FluidCRM. Platform convention: functions named
-- agent_*, SECURITY INVOKER (they run as the person, so RLS applies), each with a JSON comment
-- { description, audience, confirm, params }; agent_whoami() returns the caller's role or null.
-- Writes tag their activity_log rows with via = 'whatsapp'. Every write asks the person to
-- confirm first ("confirm": true), so nothing changes without a human yes (AI-AGENTS.md 1).

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_whoami() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT role FROM __APP_SCHEMA__.members WHERE user_id = auth.uid() AND status = 'active'
$$;

-- ---------------------------------------------------------------------------------------------
-- Internal helpers (not agent_*, so the assistant never sees them)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.require_member() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  IF NOT __APP_SCHEMA__.is_active_member() THEN
    RAISE EXCEPTION 'You don''t have access to FluidCRM. Ask its admin to add you.' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.format_value(amount numeric, currency text, period text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN amount IS NULL THEN NULL
    ELSE CASE WHEN currency = 'INR' THEN '₹' ELSE coalesce(currency, '') || ' ' END
      || CASE
           WHEN currency = 'INR' AND amount >= 10000000 THEN trim_scale(round(amount / 10000000, 2))::text || 'Cr'
           WHEN currency = 'INR' AND amount >= 100000 THEN trim_scale(round(amount / 100000, 1))::text || 'L'
           ELSE trim_scale(amount)::text
         END
      || CASE period WHEN 'yearly' THEN '/yr' WHEN 'monthly' THEN '/mo' ELSE '' END
  END
$$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.event_owner_label(e __APP_SCHEMA__.deal_events) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT CASE e.owner_kind
    WHEN 'user' THEN coalesce((SELECT name FROM __APP_SCHEMA__.members WHERE user_id = e.user_id), 'Me')
    WHEN 'contact' THEN coalesce((SELECT name FROM __APP_SCHEMA__.contacts WHERE id = e.owner_contact_id), 'Client')
    WHEN 'team' THEN 'Team'
    ELSE 'Auto • ' || initcap(e.owner_automation)
  END
$$;

-- A company name the way people say it: no case, spacing, punctuation, or "Pvt Ltd"-type words.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.name_key(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(t, '')), '\m(pvt|private|ltd|limited|llp|inc|co|company|corp|corporation|the|and)\M|&', ' ', 'g'),
    '[^a-z0-9]', '', 'g')
$$;

-- The deal for a company the person named, matched the forgiving way people say names: exact
-- first, then ignoring case / spacing / "Pvt Ltd", then a shortened or longer form ("Meridian Tech"
-- for Meridian Technologies, "Astra Healthcare" for Astra Health), then the same first word. At
-- each step one match wins and several ask which; null when nothing matches.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.resolve_deal(company text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  q text := __APP_SCHEMA__.name_key(company);
  first_word text := lower(substring(btrim(company) FROM '^[^\s]+'));
  tier integer;
  found uuid[];
  names text;
BEGIN
  IF q = '' THEN RETURN NULL; END IF;
  FOR tier IN 1..4 LOOP
    SELECT array_agg(d.id), string_agg(c.name, ', ' ORDER BY c.name) INTO found, names
    FROM __APP_SCHEMA__.deals d JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id)
    WHERE d.deleted_at IS NULL AND c.deleted_at IS NULL AND CASE tier
      WHEN 1 THEN lower(c.name) = lower(btrim(company))
      WHEN 2 THEN __APP_SCHEMA__.name_key(c.name) = q
      WHEN 3 THEN length(q) >= 4 AND (__APP_SCHEMA__.name_key(c.name) LIKE '%' || q || '%'
        OR (length(__APP_SCHEMA__.name_key(c.name)) >= 4 AND q LIKE __APP_SCHEMA__.name_key(c.name) || '%'))
      ELSE length(first_word) >= 4 AND lower(substring(c.name FROM '^[^\s]+')) = first_word
    END;
    IF coalesce(array_length(found, 1), 0) = 1 THEN RETURN found[1]; END IF;
    IF coalesce(array_length(found, 1), 0) > 1 THEN
      RAISE EXCEPTION 'Several companies match "%": %. Which one?', company, names;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- When nothing matched: the closest names on their board, for the assistant to offer or pick from.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.no_such_company(company text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  q text := __APP_SCHEMA__.name_key(company);
  closest text;
BEGIN
  SELECT string_agg(name, ', ') INTO closest FROM (
    SELECT c.name FROM __APP_SCHEMA__.deals d JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id)
    WHERE d.deleted_at IS NULL AND c.deleted_at IS NULL
    ORDER BY (left(__APP_SCHEMA__.name_key(c.name), 2) = left(q, 2)) DESC, (left(__APP_SCHEMA__.name_key(c.name), 1) = left(q, 1)) DESC, c.name
    LIMIT 8) x;
  RAISE EXCEPTION 'There''s no company called "%" on their board. Companies there include: %. If they meant one of these, use its exact name; if it really is a new client, call again with new_company = true.',
    company, coalesce(closest, 'none yet');
END $$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.check_event_type(t text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  IF lower(t) NOT IN ('call', 'team_call', 'demo', 'email', 'document', 'contract', 'legal_review', 'meeting', 'qa', 'feedback',
    'pricing', 'negotiation', 'review', 'lunch', 'site_visit', 'website_visit', 'outreach', 'onboarding', 'closing') THEN
    RAISE EXCEPTION 'Unknown event type "%". Use one of: call, team_call, demo, email, document, contract, legal_review, meeting, qa, feedback, pricing, negotiation, review, lunch, site_visit, website_visit, outreach, onboarding, closing.', t;
  END IF;
  RETURN lower(t);
END $$;

-- The deal context (AI-AGENTS.md 2, trimmed): timeline in order with computed status, contacts,
-- reminders. Shared by agent_deal_context and the write functions' replies.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.deal_context(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT jsonb_build_object(
    'today', __APP_SCHEMA__.today(),
    'deal', jsonb_build_object(
      'id', d.id, 'company', c.name, 'industry', c.industry, 'city', c.city, 'tag', d.tag, 'status', d.status,
      'value', __APP_SCHEMA__.format_value(d.value_amount, d.value_currency, d.value_period),
      'last_activity_at', d.last_activity_at),
    'contacts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', ct.id, 'name', ct.name, 'job_title', ct.job_title, 'is_decision_maker', ct.is_decision_maker) ORDER BY ct.name)
      FROM __APP_SCHEMA__.contacts ct WHERE ct.company_id = c.id AND ct.deleted_at IS NULL), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'type', e.event_type, 'date', e.event_date, 'days_from_today', s.days_from_today,
        'status', s.status, 'owner', __APP_SCHEMA__.event_owner_label(e), 'notes', e.notes, 'origin', e.origin,
        'ai_reason', CASE WHEN e.origin = 'ai' THEN e.ai_reason END,
        'reminders', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', r.id, 'remind_at', r.remind_at, 'channel', r.channel, 'to', r.recipient_label, 'message', r.message, 'status', r.status) ORDER BY r.remind_at)
          FROM __APP_SCHEMA__.reminders r WHERE r.event_id = e.id AND r.deleted_at IS NULL AND r.status <> 'cancelled'), '[]'::jsonb)
      ) ORDER BY e.event_date, e.sort_key)
      FROM __APP_SCHEMA__.deal_events e JOIN __APP_SCHEMA__.event_status s ON (s.id = e.id)
      WHERE e.deal_id = d.id), '[]'::jsonb)
  )
  FROM __APP_SCHEMA__.deals d JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id)
  WHERE d.id = target AND d.deleted_at IS NULL
$$;

-- A sort_key that puts a new event after everything already on that date.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.next_sort_key(target uuid, on_date date) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT coalesce(max(sort_key), -1) + 1 FROM __APP_SCHEMA__.deal_events WHERE deal_id = target AND event_date <= on_date
$$;

-- ---------------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_find_deals(query text DEFAULT NULL)
RETURNS TABLE (deal_id uuid, company text, industry text, city text, tag text, value text, done int, total int, overdue int, next_event text, next_event_date date, pending_suggestions int, contacts text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  RETURN QUERY
  SELECT d.id, c.name, c.industry, c.city, d.tag,
    __APP_SCHEMA__.format_value(d.value_amount, d.value_currency, d.value_period),
    count(*) FILTER (WHERE s.status = 'done')::int,
    count(*) FILTER (WHERE s.status IN ('done', 'overdue', 'next', 'upcoming'))::int,
    count(*) FILTER (WHERE s.status = 'overdue')::int,
    max(e.title) FILTER (WHERE s.status = 'next'),
    max(e.event_date) FILTER (WHERE s.status = 'next'),
    count(*) FILTER (WHERE s.status = 'suggested')::int,
    (SELECT string_agg(ct.name || coalesce(' (' || ct.job_title || ')', ''), ', ' ORDER BY ct.name) FROM __APP_SCHEMA__.contacts ct WHERE ct.company_id = c.id AND ct.deleted_at IS NULL)
  FROM __APP_SCHEMA__.deals d
  JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id)
  LEFT JOIN __APP_SCHEMA__.deal_events e ON (e.deal_id = d.id AND e.deleted_at IS NULL)
  LEFT JOIN __APP_SCHEMA__.event_status s ON (s.id = e.id)
  WHERE d.deleted_at IS NULL AND c.deleted_at IS NULL AND d.status = 'open'
    AND (query IS NULL OR btrim(query) = ''
      OR c.name ILIKE '%' || btrim(query) || '%' OR __APP_SCHEMA__.name_key(c.name) LIKE '%' || __APP_SCHEMA__.name_key(query) || '%'
      OR (length(__APP_SCHEMA__.name_key(query)) >= 4 AND __APP_SCHEMA__.name_key(query) LIKE __APP_SCHEMA__.name_key(c.name) || '%')
      OR lower(substring(c.name FROM '^[^\s]+')) = lower(substring(btrim(query) FROM '^[^\s]+')) AND length(substring(btrim(query) FROM '^[^\s]+')) >= 4
      OR c.industry ILIKE '%' || btrim(query) || '%' OR c.city ILIKE '%' || btrim(query) || '%'
      OR EXISTS (SELECT 1 FROM __APP_SCHEMA__.contacts ct WHERE ct.company_id = c.id AND ct.deleted_at IS NULL AND ct.name ILIKE '%' || btrim(query) || '%'))
  GROUP BY d.id, c.id
  ORDER BY d.board_position, c.name;
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_find_deals(text) IS
  '{"description": "List open deals with headline numbers (value, progress, overdue count, next event, contacts). Optionally filter by company, industry, city or contact name. Use it to find a deal_id.", "audience": "team", "confirm": false, "params": {"query": "Part of a company, industry, city or contact name; leave out for all deals"}}';

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_deal_context(deal_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  result := __APP_SCHEMA__.deal_context(agent_deal_context.deal_id);
  IF result IS NULL THEN RAISE EXCEPTION 'That deal wasn''t found.'; END IF;
  RETURN result;
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_deal_context(uuid) IS
  '{"description": "Everything about one deal: company, value, contacts, and the whole timeline in order with each event''s status (done, overdue, next, upcoming, suggested), owner, notes and reminders. Event ids from here are what complete/remind actions need.", "audience": "team", "confirm": false, "params": {"deal_id": "From agent_find_deals"}}';

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_my_agenda(days integer DEFAULT 7) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  horizon integer := least(greatest(coalesce(days, 7), 0), 60);
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  RETURN jsonb_build_object(
    'today', __APP_SCHEMA__.today(),
    'overdue', coalesce((
      SELECT jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'company', c.name, 'date', e.event_date, 'days_late', -s.days_from_today, 'owner', __APP_SCHEMA__.event_owner_label(e)) ORDER BY e.event_date)
      FROM __APP_SCHEMA__.deal_events e JOIN __APP_SCHEMA__.event_status s ON (s.id = e.id)
      JOIN __APP_SCHEMA__.deals d ON (d.id = e.deal_id) JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id)
      WHERE s.status = 'overdue' AND d.deleted_at IS NULL AND d.status = 'open'), '[]'::jsonb),
    'coming_up', coalesce((
      SELECT jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'company', c.name, 'date', e.event_date, 'in_days', s.days_from_today, 'is_next_for_deal', s.status = 'next', 'owner', __APP_SCHEMA__.event_owner_label(e)) ORDER BY e.event_date, e.sort_key)
      FROM __APP_SCHEMA__.deal_events e JOIN __APP_SCHEMA__.event_status s ON (s.id = e.id)
      JOIN __APP_SCHEMA__.deals d ON (d.id = e.deal_id) JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id)
      WHERE s.status IN ('next', 'upcoming') AND s.days_from_today BETWEEN 0 AND horizon AND d.deleted_at IS NULL AND d.status = 'open'), '[]'::jsonb),
    'suggestions_to_review', coalesce((
      SELECT jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'company', c.name, 'date', e.event_date, 'reason', e.ai_reason) ORDER BY e.event_date)
      FROM __APP_SCHEMA__.deal_events e JOIN __APP_SCHEMA__.event_status s ON (s.id = e.id)
      JOIN __APP_SCHEMA__.deals d ON (d.id = e.deal_id) JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id)
      WHERE s.status = 'suggested' AND d.deleted_at IS NULL), '[]'::jsonb)
  );
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_my_agenda(integer) IS
  '{"description": "What needs attention: overdue events, events coming up in the next few days, and AI suggestions waiting for review, across all open deals.", "audience": "team", "confirm": false, "params": {"days": "How many days ahead to include (default 7)"}}';

-- ---------------------------------------------------------------------------------------------
-- Writes (all confirmed by the person before they run)
-- ---------------------------------------------------------------------------------------------

-- The main WhatsApp flow: "I spoke to Rohan at Meridian, ... follow up Monday".
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_log_interaction(
  company text,
  summary text,
  contact_name text DEFAULT NULL,
  interaction_type text DEFAULT 'call',
  happened_on date DEFAULT NULL,
  next_step text DEFAULT NULL,
  next_step_date date DEFAULT NULL,
  next_step_type text DEFAULT NULL,
  title text DEFAULT NULL,
  new_company boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  target uuid;
  company_row uuid;
  created_company boolean := false;
  contact uuid;
  new_contact boolean := false;
  kind text := coalesce(__APP_SCHEMA__.check_event_type(interaction_type), 'call');
  day date := coalesce(happened_on, __APP_SCHEMA__.today());
  logged uuid;
  next_id uuid;
  label text;
  reply text;
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  IF btrim(coalesce(company, '')) = '' THEN RAISE EXCEPTION 'Which company was this with?'; END IF;
  IF btrim(coalesce(summary, '')) = '' THEN RAISE EXCEPTION 'What happened in the conversation?'; END IF;
  IF day > __APP_SCHEMA__.today() THEN RAISE EXCEPTION 'That date is in the future - log it once it has happened, or add it as an event.'; END IF;
  IF next_step IS NOT NULL AND next_step_date IS NULL THEN RAISE EXCEPTION 'When should "%" happen?', next_step; END IF;
  IF next_step_date IS NOT NULL AND next_step_date < __APP_SCHEMA__.today() THEN RAISE EXCEPTION 'The next step''s date has already passed.'; END IF;

  target := __APP_SCHEMA__.resolve_deal(company);
  IF target IS NULL THEN
    -- A name that matches nothing is far more often a different way of saying an existing client
    -- than a new one: only create it when they've said it's new
    IF NOT coalesce(agent_log_interaction.new_company, false) THEN PERFORM __APP_SCHEMA__.no_such_company(company); END IF;
    INSERT INTO __APP_SCHEMA__.companies (name) VALUES (btrim(company)) RETURNING id INTO company_row;
    INSERT INTO __APP_SCHEMA__.deals (company_id, board_position)
      VALUES (company_row, coalesce((SELECT min(board_position) FROM __APP_SCHEMA__.deals), 0) - 1) RETURNING id INTO target;
    created_company := true;
  ELSE
    SELECT d.company_id INTO company_row FROM __APP_SCHEMA__.deals d WHERE d.id = target;
  END IF;

  IF btrim(coalesce(contact_name, '')) <> '' THEN
    SELECT ct.id INTO contact FROM __APP_SCHEMA__.contacts ct
    WHERE ct.company_id = company_row AND ct.deleted_at IS NULL
      AND (lower(ct.name) = lower(btrim(contact_name)) OR ct.name ILIKE btrim(contact_name) || ' %' OR ct.name ILIKE '% ' || btrim(contact_name))
    ORDER BY lower(ct.name) = lower(btrim(contact_name)) DESC LIMIT 1;
    IF contact IS NULL THEN
      INSERT INTO __APP_SCHEMA__.contacts (company_id, name) VALUES (company_row, btrim(contact_name)) RETURNING id INTO contact;
      new_contact := true;
    END IF;
  END IF;

  label := coalesce(nullif(btrim(agent_log_interaction.title), ''),
    initcap(replace(kind, '_', ' ')) || coalesce(' with ' || (SELECT split_part(name, ' ', 1) FROM __APP_SCHEMA__.contacts WHERE id = contact), ''));
  INSERT INTO __APP_SCHEMA__.deal_events (deal_id, title, event_type, event_date, sort_key, owner_kind, notes, completed_at, origin)
  VALUES (target, label, kind, day, __APP_SCHEMA__.next_sort_key(target, day), 'user', btrim(summary), now(), 'whatsapp')
  RETURNING id INTO logged;

  IF next_step IS NOT NULL THEN
    INSERT INTO __APP_SCHEMA__.deal_events (deal_id, title, event_type, event_date, sort_key, owner_kind, origin)
    VALUES (target, btrim(next_step), coalesce(__APP_SCHEMA__.check_event_type(next_step_type), kind), next_step_date,
      __APP_SCHEMA__.next_sort_key(target, next_step_date), 'user', 'whatsapp')
    RETURNING id INTO next_id;
  END IF;

  reply := 'Logged "' || label || '" on ' || (SELECT name FROM __APP_SCHEMA__.companies WHERE id = company_row)
    || CASE WHEN created_company THEN ' (new company)' ELSE '' END
    || CASE WHEN new_contact THEN ', and added ' || btrim(contact_name) || ' as a contact' ELSE '' END
    || '.' || CASE WHEN next_id IS NOT NULL THEN ' Next step: ' || btrim(next_step) || ' on ' || to_char(next_step_date, 'Dy DD Mon') || '.' ELSE '' END;
  -- A company name ending in "." (Pvt. Ltd.) shouldn't end the sentence twice
  reply := regexp_replace(reply, '\.\.(\s|$)', '.\1', 'g');
  RETURN jsonb_build_object('message', reply, 'deal_id', target, 'logged_event_id', logged, 'next_event_id', next_id);
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_log_interaction(text, text, text, text, date, text, date, text, text, boolean) IS
  '{"description": "Record something that already happened with a client - a conversation, a meeting, a PO or payment received, a contract signed: adds a completed event (titled from title, or from the type and contact) with their summary as notes to that company''s timeline, adds the contact if new, and optionally schedules the agreed next step. Works on an existing company; only creates one with new_company = true.", "audience": "team", "confirm": true, "params": {"company": "Company name as they said it", "summary": "What was discussed and agreed, in their words, cleaned up", "contact_name": "Who they spoke to, if mentioned", "interaction_type": "call, meeting, demo, email, lunch, site_visit, negotiation, pricing or another event type (default call)", "happened_on": "YYYY-MM-DD, default today", "next_step": "Short title of the agreed next action, if any", "next_step_date": "YYYY-MM-DD for the next step (required with next_step)", "next_step_type": "Event type for the next step, default same as the interaction", "title": "Short title for what happened if it isn''t just a call or meeting with someone, e.g. PO received, Payment received, Contract signed", "new_company": "true only when they say this is a new client not on the board yet; otherwise leave it out - an unknown name gets back the closest existing companies"}}';

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_add_event(deal_id uuid, title text, event_date date, event_type text DEFAULT 'call', notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  created uuid;
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  IF btrim(coalesce(title, '')) = '' THEN RAISE EXCEPTION 'What should the event be called?'; END IF;
  IF NOT EXISTS (SELECT 1 FROM __APP_SCHEMA__.deals d WHERE d.id = agent_add_event.deal_id AND d.deleted_at IS NULL) THEN RAISE EXCEPTION 'That deal wasn''t found.'; END IF;
  INSERT INTO __APP_SCHEMA__.deal_events (deal_id, title, event_type, event_date, sort_key, owner_kind, notes, origin)
  VALUES (agent_add_event.deal_id, btrim(title), coalesce(__APP_SCHEMA__.check_event_type(event_type), 'call'), event_date,
    __APP_SCHEMA__.next_sort_key(agent_add_event.deal_id, event_date), 'user', nullif(btrim(coalesce(notes, '')), ''), 'whatsapp')
  RETURNING id INTO created;
  RETURN jsonb_build_object('message', 'Added "' || btrim(title) || '" on ' || to_char(event_date, 'Dy DD Mon') || '.', 'event_id', created);
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_add_event(uuid, text, date, text, text) IS
  '{"description": "Add a planned event (call, demo, meeting, ...) to a deal''s timeline.", "audience": "team", "confirm": true, "params": {"deal_id": "From agent_find_deals", "title": "Short title, e.g. Pricing call", "event_date": "YYYY-MM-DD", "event_type": "call, demo, meeting, email, document, contract, pricing, negotiation, site_visit, lunch, closing, ... (default call)", "notes": "Optional details"}}';

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_complete_event(event_id uuid, notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  e __APP_SCHEMA__.deal_events;
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  SELECT * INTO e FROM __APP_SCHEMA__.deal_events WHERE id = agent_complete_event.event_id AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'That event wasn''t found.'; END IF;
  IF e.ai_review_status = 'pending' THEN RAISE EXCEPTION '"%" is still an AI suggestion - accept it first.', e.title; END IF;
  IF e.completed_at IS NOT NULL THEN RETURN jsonb_build_object('message', '"' || e.title || '" was already done.'); END IF;
  UPDATE __APP_SCHEMA__.deal_events SET completed_at = now(),
    notes = CASE WHEN btrim(coalesce(agent_complete_event.notes, '')) = '' THEN deal_events.notes ELSE concat_ws(E'\n', deal_events.notes, btrim(agent_complete_event.notes)) END
  WHERE id = e.id;
  -- DATA-MODEL.md 6.4: nothing left to remind about
  UPDATE __APP_SCHEMA__.reminders SET status = 'cancelled' WHERE reminders.event_id = e.id AND reminders.status = 'scheduled';
  RETURN jsonb_build_object('message', 'Marked "' || e.title || '" as done.');
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_complete_event(uuid, text) IS
  '{"description": "Mark an event as done (its scheduled reminders are cancelled), optionally adding notes on how it went.", "audience": "team", "confirm": true, "params": {"event_id": "From agent_deal_context or agent_my_agenda", "notes": "Optional outcome notes"}}';

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_update_deal(deal_id uuid, tag text DEFAULT NULL, value_amount numeric DEFAULT NULL, value_period text DEFAULT NULL, status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  d __APP_SCHEMA__.deals;
  period text := coalesce(lower(value_period), 'yearly');
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  SELECT * INTO d FROM __APP_SCHEMA__.deals WHERE id = agent_update_deal.deal_id AND deleted_at IS NULL;
  IF d.id IS NULL THEN RAISE EXCEPTION 'That deal wasn''t found.'; END IF;
  IF tag IS NOT NULL AND lower(tag) NOT IN ('hot', 'warm', 'cold', 'enterprise') THEN RAISE EXCEPTION 'Tag must be hot, warm, cold or enterprise.'; END IF;
  IF status IS NOT NULL AND lower(status) NOT IN ('open', 'won', 'lost') THEN RAISE EXCEPTION 'Status must be open, won or lost.'; END IF;
  IF period NOT IN ('one_time', 'monthly', 'yearly') THEN RAISE EXCEPTION 'Value period must be one_time, monthly or yearly.'; END IF;
  UPDATE __APP_SCHEMA__.deals SET
    tag = coalesce(lower(agent_update_deal.tag), deals.tag),
    status = coalesce(lower(agent_update_deal.status), deals.status),
    value_amount = coalesce(agent_update_deal.value_amount, deals.value_amount),
    value_currency = CASE WHEN agent_update_deal.value_amount IS NOT NULL THEN coalesce(deals.value_currency, (SELECT currency FROM __APP_SCHEMA__.members WHERE user_id = auth.uid())) ELSE deals.value_currency END,
    value_period = CASE WHEN agent_update_deal.value_amount IS NOT NULL THEN period ELSE deals.value_period END
  WHERE id = d.id
  RETURNING * INTO d;
  RETURN jsonb_build_object('message', 'Updated ' || (SELECT name FROM __APP_SCHEMA__.companies WHERE id = d.company_id) || ': ' || upper(d.tag)
    || coalesce(', ' || __APP_SCHEMA__.format_value(d.value_amount, d.value_currency, d.value_period), '') || CASE WHEN d.status <> 'open' THEN ', ' || d.status ELSE '' END || '.');
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_update_deal(uuid, text, numeric, text, text) IS
  '{"description": "Change a deal''s tag (hot/warm/cold/enterprise), value, or status (open/won/lost - won and lost take it off the board). Only pass what changes.", "audience": "team", "confirm": true, "params": {"deal_id": "From agent_find_deals", "tag": "hot, warm, cold or enterprise", "value_amount": "Full amount in rupees, e.g. 4500000 for 45 lakh", "value_period": "yearly (default), monthly or one_time", "status": "open, won or lost"}}';

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_add_reminder(event_id uuid, remind_at timestamptz, message text, channel text DEFAULT 'whatsapp')
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  e __APP_SCHEMA__.deal_events;
  ch text := replace(lower(coalesce(channel, 'whatsapp')), '-', '_');
  tz text := coalesce((SELECT timezone FROM __APP_SCHEMA__.members WHERE user_id = auth.uid()), 'Asia/Kolkata');
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  SELECT * INTO e FROM __APP_SCHEMA__.deal_events WHERE id = agent_add_reminder.event_id AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'That event wasn''t found.'; END IF;
  IF ch NOT IN ('in_app', 'email', 'whatsapp', 'sms') THEN RAISE EXCEPTION 'Channel must be whatsapp, in_app, email or sms.'; END IF;
  IF remind_at <= now() THEN RAISE EXCEPTION 'That time has already passed.'; END IF;
  INSERT INTO __APP_SCHEMA__.reminders (event_id, remind_at, channel, recipient_kind, recipient_label, message, status, origin)
  VALUES (e.id, remind_at, ch, 'user', coalesce((SELECT name FROM __APP_SCHEMA__.members WHERE user_id = auth.uid()), 'Me'), btrim(coalesce(message, 'Reminder: ' || e.title)),
    CASE WHEN e.ai_review_status = 'pending' THEN 'draft' ELSE 'scheduled' END, 'whatsapp');
  RETURN jsonb_build_object('message', 'I''ll remind you ' || to_char(remind_at AT TIME ZONE tz, 'Dy DD Mon "at" HH24:MI') || ' about "' || e.title || '".');
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_add_reminder(uuid, timestamptz, text, text) IS
  '{"description": "Set a reminder for the person themself on one of their events.", "audience": "team", "confirm": true, "params": {"event_id": "From agent_deal_context or agent_my_agenda", "remind_at": "ISO date-time with timezone offset, e.g. 2026-11-03T09:00:00+05:30", "message": "What to remind them about", "channel": "whatsapp (default), in_app, email or sms"}}';

-- The person accepts or dismisses an AI suggestion themself (DATA-MODEL.md 6.2: human only - here
-- the human is the one confirming on WhatsApp).
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_review_suggestion(event_id uuid, accept boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  e __APP_SCHEMA__.deal_events;
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  SELECT * INTO e FROM __APP_SCHEMA__.deal_events WHERE id = agent_review_suggestion.event_id AND deleted_at IS NULL;
  IF e.id IS NULL OR e.ai_review_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'That isn''t a suggestion waiting for review.'; END IF;
  IF accept THEN
    UPDATE __APP_SCHEMA__.deal_events SET ai_review_status = 'accepted' WHERE id = e.id;
    UPDATE __APP_SCHEMA__.reminders SET status = CASE WHEN reminders.remind_at > now() THEN 'scheduled' ELSE 'cancelled' END WHERE reminders.event_id = e.id AND reminders.status = 'draft';
    RETURN jsonb_build_object('message', 'Added "' || e.title || '" to the timeline.');
  END IF;
  UPDATE __APP_SCHEMA__.deal_events SET ai_review_status = 'dismissed', deleted_at = now() WHERE id = e.id;
  UPDATE __APP_SCHEMA__.reminders SET status = 'cancelled' WHERE reminders.event_id = e.id AND reminders.status IN ('draft', 'scheduled');
  RETURN jsonb_build_object('message', 'Dismissed the suggestion "' || e.title || '".');
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_review_suggestion(uuid, boolean) IS
  '{"description": "Accept (adds it to the timeline and schedules its reminders) or dismiss an AI-suggested next step.", "audience": "team", "confirm": true, "params": {"event_id": "A suggestion from agent_my_agenda or agent_deal_context (status suggested)", "accept": "true to accept, false to dismiss"}}';

-- Change an existing event: move it, rename it, change its type, add a note, reopen it, or take it
-- off the board. Moving it moves its pending reminders by the same number of days.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_update_event(
  event_id uuid,
  title text DEFAULT NULL,
  event_date date DEFAULT NULL,
  event_type text DEFAULT NULL,
  add_note text DEFAULT NULL,
  reopen boolean DEFAULT false,
  cancel boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  e __APP_SCHEMA__.deal_events;
  company text;
  shift integer;
  moved integer := 0;
  changes text[] := '{}';
  new_type text := __APP_SCHEMA__.check_event_type(agent_update_event.event_type);
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  SELECT * INTO e FROM __APP_SCHEMA__.deal_events WHERE id = agent_update_event.event_id AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'That event wasn''t found.'; END IF;
  IF e.ai_review_status = 'pending' THEN RAISE EXCEPTION '"%" is still an AI suggestion - accept or dismiss it first.', e.title; END IF;
  SELECT c.name INTO company FROM __APP_SCHEMA__.deals d JOIN __APP_SCHEMA__.companies c ON (c.id = d.company_id) WHERE d.id = e.deal_id;

  IF coalesce(cancel, false) THEN
    IF agent_update_event.title IS NOT NULL OR agent_update_event.event_date IS NOT NULL OR new_type IS NOT NULL OR add_note IS NOT NULL OR coalesce(reopen, false) THEN
      RAISE EXCEPTION 'Removing an event can''t be combined with other changes.';
    END IF;
    UPDATE __APP_SCHEMA__.deal_events SET deleted_at = now() WHERE id = e.id;
    UPDATE __APP_SCHEMA__.reminders SET status = 'cancelled' WHERE reminders.event_id = e.id AND reminders.status IN ('draft', 'scheduled');
    RETURN jsonb_build_object('message', 'Removed "' || e.title || '" from ' || company || '''s timeline. It can be restored from the app.');
  END IF;

  IF agent_update_event.title IS NOT NULL AND btrim(agent_update_event.title) = '' THEN RAISE EXCEPTION 'The new title is empty.'; END IF;
  IF agent_update_event.title IS NOT NULL AND btrim(agent_update_event.title) <> e.title THEN
    changes := changes || ('renamed it "' || btrim(agent_update_event.title) || '"');
  END IF;
  IF agent_update_event.event_date IS NOT NULL AND agent_update_event.event_date <> e.event_date THEN
    shift := agent_update_event.event_date - e.event_date;
    changes := changes || ('moved it to ' || to_char(agent_update_event.event_date, 'Dy DD Mon'));
  END IF;
  IF new_type IS NOT NULL AND new_type <> e.event_type THEN
    changes := changes || ('made it a ' || replace(new_type, '_', ' '));
  END IF;
  IF btrim(coalesce(add_note, '')) <> '' THEN
    changes := changes || 'added your note'::text;
  END IF;
  IF coalesce(reopen, false) THEN
    IF e.completed_at IS NULL THEN RAISE EXCEPTION '"%" isn''t marked done.', e.title; END IF;
    changes := changes || 'reopened it'::text;
  END IF;
  IF cardinality(changes) = 0 THEN
    RAISE EXCEPTION 'Nothing to change - tell me the new date, title, type or note.';
  END IF;

  UPDATE __APP_SCHEMA__.deal_events SET
    title = coalesce(nullif(btrim(agent_update_event.title), ''), deal_events.title),
    event_date = coalesce(agent_update_event.event_date, deal_events.event_date),
    sort_key = CASE WHEN shift IS NULL THEN deal_events.sort_key ELSE __APP_SCHEMA__.next_sort_key(e.deal_id, agent_update_event.event_date) END,
    event_type = coalesce(new_type, deal_events.event_type),
    notes = CASE WHEN btrim(coalesce(add_note, '')) = '' THEN deal_events.notes ELSE concat_ws(E'\n', deal_events.notes, btrim(add_note)) END,
    completed_at = CASE WHEN coalesce(reopen, false) THEN NULL ELSE deal_events.completed_at END
  WHERE id = e.id;

  -- Reminders that haven't gone out move with the event; one that would now be in the past is dropped
  IF shift IS NOT NULL THEN
    UPDATE __APP_SCHEMA__.reminders SET
      remind_at = reminders.remind_at + make_interval(days => shift),
      status = CASE WHEN reminders.remind_at + make_interval(days => shift) <= now() AND reminders.status = 'scheduled' THEN 'cancelled' ELSE reminders.status END
    WHERE reminders.event_id = e.id AND reminders.deleted_at IS NULL AND reminders.status IN ('draft', 'scheduled');
    GET DIAGNOSTICS moved = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('message',
    'Updated "' || e.title || '" (' || company || '): ' || array_to_string(changes, ', ') || '.'
    || CASE WHEN moved = 1 THEN ' Its reminder moved too.' WHEN moved > 1 THEN ' Its ' || moved || ' reminders moved too.' ELSE '' END);
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_update_event(uuid, text, date, text, text, boolean, boolean) IS
  '{"description": "Change an existing event on a deal''s timeline: move it to another date (its pending reminders move with it), rename it, change its type, add a note without completing it, reopen one marked done, or remove it from the board (cancel). Only pass what changes.", "audience": "team", "confirm": true, "params": {"event_id": "From agent_deal_context or agent_my_agenda", "title": "New title", "event_date": "New date, YYYY-MM-DD", "event_type": "New type: call, demo, meeting, email, document, contract, pricing, negotiation, site_visit, lunch, closing, ...", "add_note": "Text to add to the event''s notes", "reopen": "true to mark a done event as not done", "cancel": "true to remove the event from the board (on its own, no other changes)"}}';

-- Add a contact (e.g. from a photo of a business card): to the named company - created if it's new -
-- or, if someone with that name is already there, fill in what's missing rather than duplicating them.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_add_contact(
  company text,
  name text,
  job_title text DEFAULT NULL,
  email text DEFAULT NULL,
  phone text DEFAULT NULL,
  is_decision_maker boolean DEFAULT NULL,
  new_company boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  target uuid;
  company_row uuid;
  company_name text;
  created_company boolean := false;
  existing __APP_SCHEMA__.contacts;
  filled text[] := '{}';
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  IF btrim(coalesce(company, '')) = '' THEN RAISE EXCEPTION 'Which company does % work at?', coalesce(nullif(btrim(name), ''), 'this person'); END IF;
  IF btrim(coalesce(name, '')) = '' THEN RAISE EXCEPTION 'What''s the person''s name?'; END IF;
  IF email IS NOT NULL AND btrim(email) <> '' AND btrim(email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION '"%" doesn''t look like an email address.', email; END IF;

  target := __APP_SCHEMA__.resolve_deal(company);
  IF target IS NULL THEN
    IF NOT coalesce(agent_add_contact.new_company, false) THEN PERFORM __APP_SCHEMA__.no_such_company(company); END IF;
    INSERT INTO __APP_SCHEMA__.companies (name) VALUES (btrim(company)) RETURNING id INTO company_row;
    INSERT INTO __APP_SCHEMA__.deals (company_id, board_position)
      VALUES (company_row, coalesce((SELECT min(board_position) FROM __APP_SCHEMA__.deals), 0) - 1);
    created_company := true;
  ELSE
    SELECT d.company_id INTO company_row FROM __APP_SCHEMA__.deals d WHERE d.id = target;
  END IF;
  SELECT c.name INTO company_name FROM __APP_SCHEMA__.companies c WHERE c.id = company_row;

  SELECT * INTO existing FROM __APP_SCHEMA__.contacts ct
  WHERE ct.company_id = company_row AND ct.deleted_at IS NULL AND lower(ct.name) = lower(btrim(agent_add_contact.name));

  IF existing.id IS NULL THEN
    INSERT INTO __APP_SCHEMA__.contacts (company_id, name, job_title, email, phone, is_decision_maker)
    VALUES (company_row, btrim(agent_add_contact.name), nullif(btrim(job_title), ''), nullif(btrim(email), ''), nullif(btrim(phone), ''), coalesce(is_decision_maker, false));
    RETURN jsonb_build_object('message', regexp_replace('Added ' || btrim(agent_add_contact.name)
      || coalesce(' (' || nullif(btrim(job_title), '') || ')', '') || ' to ' || company_name
      || CASE WHEN created_company THEN ' - a new company on your board' ELSE '' END || '.', '\.\.$', '.'));
  END IF;

  IF existing.job_title IS NULL AND nullif(btrim(job_title), '') IS NOT NULL THEN filled := filled || 'job title'::text; END IF;
  IF existing.email IS NULL AND nullif(btrim(email), '') IS NOT NULL THEN filled := filled || 'email'::text; END IF;
  IF existing.phone IS NULL AND nullif(btrim(phone), '') IS NOT NULL THEN filled := filled || 'phone'::text; END IF;
  IF cardinality(filled) = 0 AND is_decision_maker IS NULL THEN
    RETURN jsonb_build_object('message', existing.name || ' is already a contact at ' || company_name || ' - nothing new to add.');
  END IF;
  UPDATE __APP_SCHEMA__.contacts SET
    job_title = coalesce(contacts.job_title, nullif(btrim(agent_add_contact.job_title), '')),
    email = coalesce(contacts.email, nullif(btrim(agent_add_contact.email), '')),
    phone = coalesce(contacts.phone, nullif(btrim(agent_add_contact.phone), '')),
    is_decision_maker = coalesce(agent_add_contact.is_decision_maker, contacts.is_decision_maker)
  WHERE id = existing.id;
  RETURN jsonb_build_object('message', existing.name || ' was already a contact at ' || company_name
    || CASE WHEN cardinality(filled) > 0 THEN ' - added their ' || array_to_string(filled, ', ') ELSE ' - updated them' END || '.');
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_add_contact(text, text, text, text, text, boolean, boolean) IS
  '{"description": "Add a person as a contact at a company - for example from a photo of their business card. Works on an existing company; creates one only with new_company = true (a business card from someone new). If the person is already there, fills in missing details instead of adding them twice.", "audience": "team", "confirm": true, "params": {"company": "Company name", "name": "Full name", "job_title": "Title, if known", "email": "Email, if known", "phone": "Phone with country code, if known", "is_decision_maker": "true if they decide on the purchase (e.g. CFO, owner, director)", "new_company": "true only when the company is new to them (not on the board yet); an unknown name otherwise gets back the closest existing companies"}}';

-- Functions are executable by PUBLIC (which includes signed-out visitors) unless revoked. Only
-- signed-in people may call anything here; the internal seed and trigger functions not even them.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA __APP_SCHEMA__ FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA __APP_SCHEMA__ TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.seed_demo_for(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.log_activity() FROM authenticated;
