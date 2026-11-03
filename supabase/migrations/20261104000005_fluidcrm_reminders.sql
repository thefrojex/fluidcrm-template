-- Reminders go to a person: who to remind (an employee in core.people) is stored with each
-- reminder, and the platform delivers WhatsApp reminders to them when they're due. For now people
-- set reminders for themselves only; reminding someone else waits for the reporting-chain rules.

ALTER TABLE __APP_SCHEMA__.reminders ADD COLUMN IF NOT EXISTS recipient_person_id uuid REFERENCES core.people (id);
COMMENT ON COLUMN __APP_SCHEMA__.reminders.recipient_person_id IS '{"description": "The employee who gets the reminder when recipient_kind = user; WhatsApp reminders are sent to them"}';
COMMENT ON COLUMN __APP_SCHEMA__.reminders.failure_reason IS '{"description": "Why a reminder wasn''t delivered (not connected to WhatsApp, not in the CRM, ...)"}';
CREATE INDEX IF NOT EXISTS reminders_recipient ON __APP_SCHEMA__.reminders (recipient_person_id) WHERE recipient_person_id IS NOT NULL;

-- Reminders made before this knew only a name: the employee by that name, else the deal's owner
UPDATE __APP_SCHEMA__.reminders r SET recipient_person_id = coalesce(
    (SELECT p.id FROM core.people p WHERE p.name = r.recipient_label AND p.status = 'active' ORDER BY p.created_at LIMIT 1), d.owner_id)
FROM __APP_SCHEMA__.deal_events e JOIN __APP_SCHEMA__.deals d ON (d.id = e.deal_id)
WHERE e.id = r.event_id AND r.recipient_kind = 'user' AND r.recipient_person_id IS NULL;

-- Only yourself, for now: a reminder's person can be set or changed to the signed-in person only.
-- The platform (no signed-in person) is not limited.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.check_reminder_recipient() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  IF NEW.recipient_kind <> 'user' THEN
    NEW.recipient_person_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.recipient_person_id IS NULL THEN
    NEW.recipient_person_id := core.me();
  END IF;
  IF core.me() IS NOT NULL AND NEW.recipient_person_id IS DISTINCT FROM core.me()
     AND (TG_OP = 'INSERT' OR NEW.recipient_person_id IS DISTINCT FROM OLD.recipient_person_id) THEN
    RAISE EXCEPTION 'You can set reminders for yourself only.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_recipient ON __APP_SCHEMA__.reminders;
CREATE TRIGGER check_recipient BEFORE INSERT OR UPDATE ON __APP_SCHEMA__.reminders FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.check_reminder_recipient();
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.check_reminder_recipient() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.log_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  new_row jsonb := to_jsonb(NEW);
  diff jsonb := '{}'::jsonb;
  key text;
  act text;
  deal uuid;
BEGIN
  -- Loading or removing the demo isn't history worth showing, nor the platform marking a reminder sent
  IF current_setting('app.via', true) IN ('seed', 'demo', 'delivery') THEN
    RETURN NEW;
  END IF;
  FOR key IN SELECT jsonb_object_keys(new_row) LOOP
    CONTINUE WHEN key IN ('updated_at', 'last_activity_at', 'id', 'created_at', 'created_by');
    IF TG_OP = 'INSERT' OR (old_row -> key) IS DISTINCT FROM (new_row -> key) THEN
      diff := diff || jsonb_build_object(key, jsonb_build_array(old_row -> key, new_row -> key));
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND diff = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  -- What the row is called, so history can name it even after it's deleted
  diff := diff || jsonb_build_object('_label', coalesce(new_row ->> 'title', new_row ->> 'message',
    (SELECT p.name FROM core.parties p WHERE p.id = (new_row ->> 'company_id')::uuid)));

  act := CASE
    WHEN TG_OP = 'INSERT' THEN 'created'
    WHEN diff ? 'deleted_at' AND new_row ->> 'deleted_at' IS NOT NULL THEN 'deleted'
    WHEN diff ? 'deleted_at' THEN 'restored'
    WHEN diff ? 'completed_at' AND new_row ->> 'completed_at' IS NOT NULL THEN 'completed'
    WHEN diff ? 'completed_at' THEN 'reopened'
    WHEN diff ? 'ai_review_status' THEN coalesce(new_row ->> 'ai_review_status', 'updated')
    ELSE 'updated'
  END;

  deal := CASE TG_TABLE_NAME
    WHEN 'deals' THEN NEW.id
    WHEN 'deal_events' THEN (new_row ->> 'deal_id')::uuid
    WHEN 'reminders' THEN (SELECT e.deal_id FROM __APP_SCHEMA__.deal_events e WHERE e.id = (new_row ->> 'event_id')::uuid)
    ELSE NULL
  END;

  INSERT INTO __APP_SCHEMA__.activity_log (deal_id, person_id, entity_type, entity_id, action, changes, via)
  VALUES (
    deal, core.me(),
    CASE TG_TABLE_NAME WHEN 'deal_events' THEN 'deal_event' ELSE rtrim(TG_TABLE_NAME, 's') END,
    NEW.id, act, diff, coalesce(nullif(current_setting('app.via', true), ''), 'app')
  );

  IF deal IS NOT NULL AND TG_TABLE_NAME IN ('deal_events', 'reminders') THEN
    UPDATE __APP_SCHEMA__.deals SET last_activity_at = now() WHERE id = deal;
  END IF;
  RETURN NEW;
END $$;

-- For the platform's reminder sender only (it runs as the database owner): claims the WhatsApp
-- reminders that are due, and returns who to send each to and what it's about. A reminder more
-- than a day late is given up on, and one whose event is done or removed is cancelled.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.platform_due_reminders(p_limit integer DEFAULT 50)
RETURNS TABLE (reminder_id uuid, auth_user_id uuid, person_name text, message text, remind_at timestamptz,
  event_id uuid, event_title text, event_date date, deal_id uuid, company text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  PERFORM set_config('app.via', 'delivery', true);
  UPDATE reminders r SET status = 'cancelled'
  FROM deal_events e WHERE e.id = r.event_id AND r.status = 'scheduled' AND r.channel = 'whatsapp' AND r.remind_at <= now()
    AND (e.deleted_at IS NOT NULL OR e.completed_at IS NOT NULL);
  UPDATE reminders r SET status = 'failed', failure_reason = 'It was more than a day late, so it wasn''t sent.'
  WHERE r.status = 'scheduled' AND r.channel = 'whatsapp' AND r.deleted_at IS NULL AND r.remind_at < now() - interval '1 day';

  RETURN QUERY
  WITH due AS (
    SELECT r.id FROM reminders r
    WHERE r.deleted_at IS NULL AND r.channel = 'whatsapp' AND r.recipient_kind = 'user'
      AND ((r.status = 'scheduled' AND r.remind_at <= now())
        -- a send that never reported back (the sender stopped half way)
        OR (r.status = 'sending' AND r.updated_at < now() - interval '10 minutes'))
    ORDER BY r.remind_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE reminders r SET status = 'sending' FROM due WHERE r.id = due.id RETURNING r.*
  )
  SELECT c.id, p.auth_user_id, p.name, c.message, c.remind_at, e.id, e.title, e.event_date, d.id, co.name
  FROM claimed c
  JOIN deal_events e ON (e.id = c.event_id)
  JOIN deals d ON (d.id = e.deal_id)
  JOIN core.parties co ON (co.id = d.company_id)
  LEFT JOIN core.people p ON (p.id = coalesce(c.recipient_person_id, d.owner_id) AND p.status = 'active');
END $$;

-- The sender's answer for one claimed reminder: sent, or why not.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.platform_reminder_result(p_reminder_id uuid, p_sent boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  PERFORM set_config('app.via', 'delivery', true);
  UPDATE reminders SET
    status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
    sent_at = CASE WHEN p_sent THEN now() END,
    failure_reason = CASE WHEN p_sent THEN NULL ELSE left(p_reason, 300) END
  WHERE id = p_reminder_id AND status = 'sending';
END $$;

REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.platform_due_reminders(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.platform_reminder_result(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- From WhatsApp: a reminder for the person themself, on any event they can see
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.agent_add_reminder(event_id uuid, remind_at timestamptz, message text, channel text DEFAULT 'whatsapp')
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  e __APP_SCHEMA__.deal_events;
  company text;
  ch text := replace(lower(coalesce(channel, 'whatsapp')), '-', '_');
  tz text := coalesce((SELECT o.timezone FROM core.organisation o), 'Asia/Kolkata');
BEGIN
  PERFORM __APP_SCHEMA__.require_member();
  PERFORM set_config('app.via', 'whatsapp', true);
  SELECT * INTO e FROM __APP_SCHEMA__.deal_events WHERE id = agent_add_reminder.event_id AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'That event wasn''t found.'; END IF;
  IF ch NOT IN ('in_app', 'email', 'whatsapp', 'sms') THEN RAISE EXCEPTION 'Channel must be whatsapp, in_app, email or sms.'; END IF;
  IF remind_at <= now() THEN RAISE EXCEPTION 'That time has already passed.'; END IF;
  SELECT c.name INTO company FROM __APP_SCHEMA__.deals d JOIN core.parties c ON (c.id = d.company_id) WHERE d.id = e.deal_id;
  INSERT INTO __APP_SCHEMA__.reminders (event_id, remind_at, channel, recipient_kind, recipient_person_id, recipient_label, message, status, origin)
  VALUES (e.id, remind_at, ch, 'user', core.me(), coalesce((SELECT p.name FROM core.people p WHERE p.id = core.me()), 'Me'),
    btrim(coalesce(nullif(btrim(message), ''), 'Reminder: ' || e.title)),
    CASE WHEN e.ai_review_status = 'pending' THEN 'draft' ELSE 'scheduled' END, 'whatsapp');
  RETURN jsonb_build_object('message', 'I''ll remind you ' || to_char(remind_at AT TIME ZONE tz, 'Dy DD Mon "at" HH24:MI')
    || ' about "' || e.title || '" (' || company || ')' || CASE WHEN ch = 'whatsapp' THEN ' here on WhatsApp.' ELSE '.' END);
END $$;
COMMENT ON FUNCTION __APP_SCHEMA__.agent_add_reminder(uuid, timestamptz, text, text) IS
  '{"description": "Set a reminder for the person themself on any event they can see (\"remind me about the Sharma demo on Friday\"); it comes to them on WhatsApp at that time. Find the event first with agent_find_deals and agent_deal_context, or agent_my_agenda. Only for themself: reminding someone else isn''t possible yet.", "audience": "team", "confirm": false, "params": {"event_id": "From agent_deal_context or agent_my_agenda", "remind_at": "ISO date-time with timezone offset, e.g. 2026-11-03T09:00:00+05:30; when they give only a day, 09:00 that day; \"before the meeting\" without a time, an hour before if the event has a time, else 09:00 that day", "message": "What to remind them about, in their words, e.g. Carry the revised quote for Sharma Traders", "channel": "whatsapp (default), in_app, email or sms"}}';

-- What a deal's timeline shows the assistant now names who each reminder is for and whether it went out
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.deal_context(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT jsonb_build_object(
    'today', __APP_SCHEMA__.today(),
    'deal', jsonb_build_object(
      'id', d.id, 'company', c.name, 'industry', c.industry, 'area', (SELECT a.name FROM core.areas a WHERE a.id = c.area_id),
      'owner', (SELECT p.name FROM core.people p WHERE p.id = d.owner_id), 'tag', d.tag, 'status', d.status,
      'value', __APP_SCHEMA__.format_value(d.value_amount, d.value_currency, d.value_period),
      'last_activity_at', d.last_activity_at),
    'contacts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', ct.id, 'name', ct.name, 'job_title', ct.designation, 'phone', ct.phone_key,
        'is_decision_maker', coalesce(cp.is_decision_maker, false)) ORDER BY ct.name)
      FROM core.contacts ct LEFT JOIN __APP_SCHEMA__.contact_profiles cp ON (cp.contact_id = ct.id)
      WHERE ct.party_id = c.id AND ct.status = 'active'), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'type', e.event_type, 'date', e.event_date, 'days_from_today', s.days_from_today,
        'status', s.status, 'owner', __APP_SCHEMA__.event_owner_label(e), 'notes', e.notes, 'origin', e.origin,
        'ai_reason', CASE WHEN e.origin = 'ai' THEN e.ai_reason END,
        'reminders', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', r.id, 'remind_at', r.remind_at, 'channel', r.channel, 'to', coalesce((SELECT p.name FROM core.people p WHERE p.id = r.recipient_person_id), r.recipient_label), 'message', r.message, 'status', r.status, 'not_sent_because', r.failure_reason) ORDER BY r.remind_at)
          FROM __APP_SCHEMA__.reminders r WHERE r.event_id = e.id AND r.deleted_at IS NULL AND r.status <> 'cancelled'), '[]'::jsonb)
      ) ORDER BY e.event_date, e.sort_key)
      FROM __APP_SCHEMA__.deal_events e JOIN __APP_SCHEMA__.event_status s ON (s.id = e.id)
      WHERE e.deal_id = d.id), '[]'::jsonb)
  )
  FROM __APP_SCHEMA__.deals d JOIN core.parties c ON (c.id = d.company_id)
  WHERE d.id = target AND d.deleted_at IS NULL
$$;
