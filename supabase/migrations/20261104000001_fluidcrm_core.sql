-- FluidCRM v5: a sales CRM on the workspace's shared data (core).
--
-- Companies and their contacts are the workspace's own (core.parties, core.contacts): the same
-- Gupta Enterprises the Service Desk knows. The CRM adds deals, their timeline of events, reminders
-- and a history log, plus CRM-only details about a company (logo) or contact (decision maker).
--
-- Access: membership and roles are the workspace's (core.app_members, console Workspace page or
-- the Team page here). A deal belongs to its owner: members see their own deals and their team's
-- (core.app_can_see), the app's admin and its sales_manager role see every deal, and the
-- workspace owner sees everything.

SELECT core.link_app('__APP_SCHEMA__');
SELECT core.declare_role('__APP_SCHEMA__', 'sales_manager', 'Sees and changes every deal, and can give a deal to someone else');

COMMENT ON SCHEMA __APP_SCHEMA__ IS '{
  "description": "FluidCRM: sales deals with each company, the timeline of calls, demos and meetings on every deal, and reminders.",
  "guide": "Companies and contacts are core.parties and core.contacts (deals.company_id, deal_events.owner_contact_id). A deal is open, won or lost (status); only open deals are on the board. Deal value is value_amount in value_currency per value_period (one_time, monthly, yearly). An event''s status (done, overdue, next, upcoming, suggested) comes from the event_status view: done = completed_at set, overdue = past event_date and not done, suggested = an AI suggestion not yet accepted. Rows with deleted_at set were removed from the board; ignore them."
}';

-- ---------------------------------------------------------------------------------------------
-- CRM-only details about core records
-- ---------------------------------------------------------------------------------------------

CREATE TABLE __APP_SCHEMA__.company_profiles (
  party_id uuid PRIMARY KEY REFERENCES core.parties (id),
  logo_key text NOT NULL DEFAULT 'briefcase' CHECK (logo_key IN ('building', 'hexagon', 'landmark', 'clipboard', 'layers', 'briefcase')),
  logo_color text NOT NULL DEFAULT 'blue' CHECK (logo_color IN ('blue', 'red', 'green', 'orange', 'purple')),
  website text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE __APP_SCHEMA__.company_profiles IS '{"description": "How the CRM shows a company: its logo and website (the company itself is core.parties)", "visibility": "everyone_in_app"}';

CREATE TABLE __APP_SCHEMA__.contact_profiles (
  contact_id uuid PRIMARY KEY REFERENCES core.contacts (id),
  is_decision_maker boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE __APP_SCHEMA__.contact_profiles IS '{"description": "Sales details about a contact (the contact itself is core.contacts): whether they decide on the purchase", "visibility": "everyone_in_app"}';
COMMENT ON COLUMN __APP_SCHEMA__.contact_profiles.is_decision_maker IS '{"description": "true if this person decides on the purchase (owner, director, CFO)"}';

-- ---------------------------------------------------------------------------------------------
-- Deals, their timeline, reminders
-- ---------------------------------------------------------------------------------------------

CREATE TABLE __APP_SCHEMA__.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES core.parties (id),
  owner_id uuid NOT NULL DEFAULT core.me() REFERENCES core.people (id),
  tag text NOT NULL DEFAULT 'warm' CHECK (tag IN ('hot', 'warm', 'cold', 'enterprise')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  value_amount numeric(14, 2) CHECK (value_amount >= 0),
  value_currency char(3),
  value_period text CHECK (value_period IN ('one_time', 'monthly', 'yearly')),
  board_position numeric NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  -- value fields are all-or-nothing (DATA-MODEL.md 6.6)
  CHECK ((value_amount IS NULL) = (value_currency IS NULL) AND (value_amount IS NULL) = (value_period IS NULL))
);
CREATE INDEX deals_company ON __APP_SCHEMA__.deals (company_id) WHERE deleted_at IS NULL;
CREATE INDEX deals_owner ON __APP_SCHEMA__.deals (owner_id) WHERE deleted_at IS NULL;
COMMENT ON TABLE __APP_SCHEMA__.deals IS '{"description": "One sales opportunity with a company, owned by a salesperson", "visibility": "team", "person_column": "owner_id"}';
COMMENT ON COLUMN __APP_SCHEMA__.deals.company_id IS '{"description": "The company (core.parties)"}';
COMMENT ON COLUMN __APP_SCHEMA__.deals.owner_id IS '{"description": "The salesperson responsible for the deal (core.people)"}';
COMMENT ON COLUMN __APP_SCHEMA__.deals.tag IS '{"description": "How promising the deal is", "values": ["hot", "warm", "cold", "enterprise"]}';
COMMENT ON COLUMN __APP_SCHEMA__.deals.status IS '{"description": "open deals are on the board; won and lost are closed (closed_at)", "values": ["open", "won", "lost"]}';
COMMENT ON COLUMN __APP_SCHEMA__.deals.value_amount IS '{"description": "Deal value in value_currency (rupees for INR), per value_period"}';
COMMENT ON COLUMN __APP_SCHEMA__.deals.value_period IS '{"description": "one_time, or recurring monthly or yearly", "values": ["one_time", "monthly", "yearly"]}';
COMMENT ON COLUMN __APP_SCHEMA__.deals.deleted_at IS '{"description": "Set when the deal was removed from the board; ignore those"}';

CREATE TABLE __APP_SCHEMA__.deal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES __APP_SCHEMA__.deals (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> ''),
  event_type text NOT NULL DEFAULT 'call' CHECK (event_type IN (
    'call', 'team_call', 'demo', 'email', 'document', 'contract', 'legal_review', 'meeting', 'qa', 'feedback',
    'pricing', 'negotiation', 'review', 'lunch', 'site_visit', 'website_visit', 'outreach', 'onboarding', 'closing')),
  color_variant text NOT NULL DEFAULT 'default' CHECK (color_variant IN ('default', 'blue', 'purple', 'red', 'green')),
  event_date date NOT NULL,
  sort_key numeric NOT NULL DEFAULT 0,
  -- user = the deal's owner
  owner_kind text NOT NULL DEFAULT 'user' CHECK (owner_kind IN ('user', 'contact', 'team', 'automation')),
  owner_contact_id uuid REFERENCES core.contacts (id),
  owner_automation text CHECK (owner_automation IN ('ai', 'email', 'calendar')),
  notes text,
  completed_at timestamptz,
  -- 'whatsapp' = logged by the person through the WhatsApp assistant
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai', 'automation', 'import', 'whatsapp')),
  ai_review_status text CHECK (ai_review_status IN ('pending', 'accepted', 'dismissed', 'expired', 'superseded')),
  ai_reason text,
  created_by uuid DEFAULT core.me() REFERENCES core.people (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((origin = 'ai') = (ai_review_status IS NOT NULL)),
  CHECK (NOT (ai_review_status = 'pending' AND completed_at IS NOT NULL)),
  CHECK ((owner_kind = 'automation') = (owner_automation IS NOT NULL))
);
CREATE INDEX deal_events_timeline ON __APP_SCHEMA__.deal_events (deal_id, event_date, sort_key) WHERE deleted_at IS NULL;
COMMENT ON TABLE __APP_SCHEMA__.deal_events IS '{"description": "One step on a deal''s timeline: a call, demo, meeting, document, ... done or planned. Status is in the event_status view.", "visibility": "custom", "visibility_note": "Follows the deal: whoever can see the deal sees its events"}';
COMMENT ON COLUMN __APP_SCHEMA__.deal_events.event_type IS '{"description": "Kind of step", "values": ["call", "team_call", "demo", "email", "document", "contract", "legal_review", "meeting", "qa", "feedback", "pricing", "negotiation", "review", "lunch", "site_visit", "website_visit", "outreach", "onboarding", "closing"]}';
COMMENT ON COLUMN __APP_SCHEMA__.deal_events.owner_kind IS '{"description": "Who does it: user = the deal owner, contact = the client (owner_contact_id), team, or automation", "values": ["user", "contact", "team", "automation"]}';
COMMENT ON COLUMN __APP_SCHEMA__.deal_events.completed_at IS '{"description": "When it was done; null = not done yet"}';
COMMENT ON COLUMN __APP_SCHEMA__.deal_events.origin IS '{"description": "How it was created: manual in the app, ai suggestion, whatsapp through the assistant, ...", "values": ["manual", "ai", "automation", "import", "whatsapp"]}';

CREATE TABLE __APP_SCHEMA__.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES __APP_SCHEMA__.deal_events (id) ON DELETE CASCADE,
  remind_at timestamptz NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'whatsapp', 'sms')),
  recipient_kind text NOT NULL DEFAULT 'user' CHECK (recipient_kind IN ('user', 'contact', 'custom')),
  recipient_contact_id uuid REFERENCES core.contacts (id),
  recipient_label text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  -- draft = belongs to a pending AI suggestion and never fires
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  failure_reason text,
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai', 'automation', 'import', 'whatsapp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX reminders_queue ON __APP_SCHEMA__.reminders (status, remind_at) WHERE status = 'scheduled' AND deleted_at IS NULL;
COMMENT ON TABLE __APP_SCHEMA__.reminders IS '{"description": "A reminder about an event, to the deal owner or a client contact, by in_app, email, whatsapp or sms", "visibility": "custom", "visibility_note": "Follows the event''s deal"}';
COMMENT ON COLUMN __APP_SCHEMA__.reminders.status IS '{"description": "draft reminders belong to an AI suggestion and never fire", "values": ["draft", "scheduled", "sending", "sent", "failed", "cancelled"]}';

-- Append-only: written by triggers, never by the browser.
CREATE TABLE __APP_SCHEMA__.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES __APP_SCHEMA__.deals (id) ON DELETE CASCADE,
  person_id uuid REFERENCES core.people (id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  changes jsonb,
  -- 'app' or 'whatsapp' (set by the agent_* functions)
  via text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_deal ON __APP_SCHEMA__.activity_log (deal_id, created_at DESC);
COMMENT ON TABLE __APP_SCHEMA__.activity_log IS '{"description": "History of every change to deals, events and reminders: who (person_id), what, and whether it came from the app or WhatsApp (via)", "visibility": "custom", "visibility_note": "Follows the deal"}';

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

ALTER TABLE __APP_SCHEMA__.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.contact_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.deal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY members ON __APP_SCHEMA__.company_profiles FOR ALL TO authenticated
  USING (core.is_app_member('__APP_SCHEMA__')) WITH CHECK (core.is_app_member('__APP_SCHEMA__'));
CREATE POLICY members ON __APP_SCHEMA__.contact_profiles FOR ALL TO authenticated
  USING (core.is_app_member('__APP_SCHEMA__')) WITH CHECK (core.is_app_member('__APP_SCHEMA__'));

-- Your deals and your team's; the app's admin and sales managers see all
CREATE POLICY read_deals ON __APP_SCHEMA__.deals FOR SELECT TO authenticated
  USING (core.app_can_see('__APP_SCHEMA__', owner_id) OR core.has_app_role('__APP_SCHEMA__', 'sales_manager'));
-- New deals are your own unless a manager is giving one to someone
CREATE POLICY add_deals ON __APP_SCHEMA__.deals FOR INSERT TO authenticated
  WITH CHECK (core.is_app_member('__APP_SCHEMA__') AND (owner_id = core.me()
    OR core.has_app_role('__APP_SCHEMA__', 'admin') OR core.has_app_role('__APP_SCHEMA__', 'sales_manager')));
CREATE POLICY change_deals ON __APP_SCHEMA__.deals FOR UPDATE TO authenticated
  USING (core.app_can_see('__APP_SCHEMA__', owner_id) OR core.has_app_role('__APP_SCHEMA__', 'sales_manager'))
  WITH CHECK (core.app_can_see('__APP_SCHEMA__', owner_id) OR core.has_app_role('__APP_SCHEMA__', 'sales_manager'));

-- Events, reminders and history follow their deal (the subquery runs under the deals rule)
CREATE POLICY follow_deal ON __APP_SCHEMA__.deal_events FOR ALL TO authenticated
  USING (core.is_app_member('__APP_SCHEMA__') AND EXISTS (SELECT 1 FROM __APP_SCHEMA__.deals d WHERE d.id = deal_id))
  WITH CHECK (core.is_app_member('__APP_SCHEMA__') AND EXISTS (SELECT 1 FROM __APP_SCHEMA__.deals d WHERE d.id = deal_id));
CREATE POLICY follow_deal ON __APP_SCHEMA__.reminders FOR ALL TO authenticated
  USING (core.is_app_member('__APP_SCHEMA__') AND EXISTS (SELECT 1 FROM __APP_SCHEMA__.deal_events e WHERE e.id = event_id))
  WITH CHECK (core.is_app_member('__APP_SCHEMA__') AND EXISTS (SELECT 1 FROM __APP_SCHEMA__.deal_events e WHERE e.id = event_id));
CREATE POLICY follow_deal ON __APP_SCHEMA__.activity_log FOR SELECT TO authenticated
  USING (core.is_app_member('__APP_SCHEMA__') AND (deal_id IS NULL OR EXISTS (SELECT 1 FROM __APP_SCHEMA__.deals d WHERE d.id = deal_id)));

-- ---------------------------------------------------------------------------------------------
-- Triggers: updated_at, activity log, deal last_activity_at
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.company_profiles FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.contact_profiles FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.deals FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.deal_events FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.reminders FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();

-- Closing a deal stamps closed_at (and reopening clears it)
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.stamp_closed() RETURNS trigger
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.closed_at := CASE WHEN NEW.status = 'open' THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closed BEFORE UPDATE ON __APP_SCHEMA__.deals FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.stamp_closed();

-- One activity_log row per real change, with { field: [before, after] }. Definer so the browser
-- needs no INSERT policy on the log; it only ever writes for the row being changed, which the
-- caller's own rules already allowed. Also bumps the deal's last_activity_at for event and
-- reminder changes (stale-deal detection, DATA-MODEL.md 6.3).
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
  -- Loading or removing the demo isn't history worth showing
  IF current_setting('app.via', true) IN ('seed', 'demo') THEN
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

CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.deals FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();
CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.deal_events FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();
CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.reminders FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();

-- ---------------------------------------------------------------------------------------------
-- "Today", event status, and the signed-in person's session
-- ---------------------------------------------------------------------------------------------

-- "Today" for status rules, in the business's timezone (DATA-MODEL.md conventions).
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.today() RETURNS date
LANGUAGE sql STABLE SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT (now() AT TIME ZONE coalesce((SELECT o.timezone FROM core.organisation o), 'Asia/Kolkata'))::date
$$;

-- The one definition of an event's status both the board and the WhatsApp assistant use:
-- suggested > done > overdue > next (first remaining, per deal) > upcoming.
CREATE VIEW __APP_SCHEMA__.event_status WITH (security_invoker = true) AS
SELECT
  e.id,
  e.deal_id,
  CASE
    WHEN e.ai_review_status = 'pending' THEN 'suggested'
    WHEN e.completed_at IS NOT NULL THEN 'done'
    WHEN e.event_date < __APP_SCHEMA__.today() THEN 'overdue'
    WHEN row_number() OVER (
      PARTITION BY e.deal_id, (e.ai_review_status IS DISTINCT FROM 'pending' AND e.completed_at IS NULL AND e.event_date >= __APP_SCHEMA__.today())
      ORDER BY e.event_date, e.sort_key
    ) = 1 THEN 'next'
    ELSE 'upcoming'
  END AS status,
  e.event_date - __APP_SCHEMA__.today() AS days_from_today
FROM __APP_SCHEMA__.deal_events e
WHERE e.deleted_at IS NULL AND e.ai_review_status IS DISTINCT FROM 'dismissed';
COMMENT ON VIEW __APP_SCHEMA__.event_status IS '{"description": "Each event''s status: suggested, done, overdue, next (the first remaining event of its deal) or upcoming, and days from today"}';

-- Called by the app right after sign-in: who they are and what they are here (null = not a member).
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.crm_session() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT CASE WHEN roles IS NULL THEN NULL ELSE jsonb_build_object(
    'user_id', auth.uid(), 'person_id', p.id, 'email', p.email, 'name', p.name,
    'role', CASE WHEN 'admin' = ANY (roles) THEN 'admin' ELSE 'user' END, 'roles', to_jsonb(roles),
    'sees_all', 'admin' = ANY (roles) OR 'sales_manager' = ANY (roles),
    'status', 'active', 'timezone', o.timezone, 'currency', o.currency, 'today', __APP_SCHEMA__.today()
  ) END
  FROM (SELECT core.my_app_roles('__APP_SCHEMA__') AS roles) r
  CROSS JOIN core.organisation o
  LEFT JOIN core.people p ON (p.id = core.me())
$$;

-- The board's one call for a company card: creates the company in core (or finds the one the
-- workspace already has by that name) when p_party_id isn't a known company yet, otherwise
-- changes its name and industry there; puts "city" in core as the company's area; and keeps the
-- card's logo here. Returns the company's id, which a new card switches to.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.save_company(p_party_id uuid, p_name text, p_industry text DEFAULT NULL, p_city text DEFAULT NULL,
  p_logo_key text DEFAULT 'briefcase', p_logo_color text DEFAULT 'blue')
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  party core.parties;
  created_id uuid;
  area uuid;
  changes jsonb := '{}'::jsonb;
BEGIN
  IF NOT core.is_app_member('__APP_SCHEMA__') THEN
    RAISE EXCEPTION 'You don''t have access to FluidCRM.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_city, '')), '') IS NOT NULL THEN
    area := (core.create_area(btrim(p_city), (SELECT a.id FROM core.areas a WHERE a.kind = 'city' AND a.status = 'active' ORDER BY a.created_at LIMIT 1), 'area', '__APP_SCHEMA__') ->> 'area_id')::uuid;
  END IF;

  SELECT * INTO party FROM core.parties p WHERE p.id = p_party_id;
  IF party.id IS NULL THEN
    created_id := (core.create_party(btrim(p_name), ARRAY['prospect'], p_industry => nullif(btrim(coalesce(p_industry, '')), ''),
      p_area_id => area, p_app => '__APP_SCHEMA__') ->> 'party_id')::uuid;
    SELECT * INTO party FROM core.parties p WHERE p.id = created_id;
  END IF;
  -- Only what differs, so an unchanged card never rewrites the shared company
  IF btrim(p_name) <> party.name THEN changes := changes || jsonb_build_object('name', btrim(p_name)); END IF;
  IF nullif(btrim(coalesce(p_industry, '')), '') IS DISTINCT FROM party.industry THEN changes := changes || jsonb_build_object('industry', nullif(btrim(coalesce(p_industry, '')), '')); END IF;
  IF area IS DISTINCT FROM party.area_id AND (area IS NOT NULL OR p_city IS NOT NULL) THEN changes := changes || jsonb_build_object('area_id', area); END IF;
  IF changes <> '{}'::jsonb THEN PERFORM core.update_party(party.id, changes, '__APP_SCHEMA__'); END IF;

  INSERT INTO __APP_SCHEMA__.company_profiles (party_id, logo_key, logo_color) VALUES (party.id, coalesce(p_logo_key, 'briefcase'), coalesce(p_logo_color, 'blue'))
  ON CONFLICT (party_id) DO UPDATE SET logo_key = EXCLUDED.logo_key, logo_color = EXCLUDED.logo_color
  WHERE (company_profiles.logo_key, company_profiles.logo_color) IS DISTINCT FROM (EXCLUDED.logo_key, EXCLUDED.logo_color);
  RETURN party.id;
END $$;

-- Helpers stay off-limits to signed-out visitors (the schema's default grants include anon).
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.crm_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.log_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.stamp_closed() FROM PUBLIC, anon, authenticated;
