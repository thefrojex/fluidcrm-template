-- FluidCRM: a demo CRM where every login has its own private board.
--
-- Access: the first person to sign in becomes the admin; the admin creates the other logins
-- (edge function __APP_SCHEMA__-users). Only active members can use the app. Every business row
-- carries user_id, and RLS shows a login only its own rows - composite foreign keys keep children
-- on the same login as their parent.
--
-- The rules here follow docs/DATA-MODEL.md, minus workspaces (the app's schema is the workspace)
-- and the agent/actor/idempotency tables (later).

-- ---------------------------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------------------------

CREATE TABLE __APP_SCHEMA__.members (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  currency char(3) NOT NULL DEFAULT 'INR',
  -- true when this CRM created the login; only then may its admin reset that login's password
  -- (the workspace's login list is shared with every other app in it)
  created_login boolean NOT NULL DEFAULT false,
  demo_seeded_at timestamptz,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.is_active_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM __APP_SCHEMA__.members WHERE user_id = auth.uid() AND status = 'active')
$$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM __APP_SCHEMA__.members WHERE user_id = auth.uid() AND status = 'active' AND role = 'admin')
$$;

ALTER TABLE __APP_SCHEMA__.members ENABLE ROW LEVEL SECURITY;
-- Read-only from the browser: the admin's changes go through the edge function (service role).
CREATE POLICY members_read ON __APP_SCHEMA__.members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR __APP_SCHEMA__.is_admin());

-- "Today" for status rules, in the signed-in person's timezone (DATA-MODEL.md conventions).
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.today() RETURNS date
LANGUAGE sql STABLE SET search_path = __APP_SCHEMA__, pg_temp AS $$
  SELECT (now() AT TIME ZONE coalesce((SELECT timezone FROM __APP_SCHEMA__.members WHERE user_id = auth.uid()), 'Asia/Kolkata'))::date
$$;

-- ---------------------------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------------------------

CREATE TABLE __APP_SCHEMA__.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  industry text,
  city text,
  website text,
  logo_key text NOT NULL DEFAULT 'briefcase' CHECK (logo_key IN ('building', 'hexagon', 'landmark', 'clipboard', 'layers', 'briefcase')),
  logo_color text NOT NULL DEFAULT 'blue' CHECK (logo_color IN ('blue', 'red', 'green', 'orange', 'purple')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, user_id)
);

CREATE TABLE __APP_SCHEMA__.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  job_title text,
  email text,
  phone text,
  is_decision_maker boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, user_id),
  FOREIGN KEY (company_id, user_id) REFERENCES __APP_SCHEMA__.companies (id, user_id) ON DELETE CASCADE
);

CREATE TABLE __APP_SCHEMA__.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  tag text NOT NULL DEFAULT 'warm' CHECK (tag IN ('hot', 'warm', 'cold', 'enterprise')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  value_amount numeric(14, 2) CHECK (value_amount >= 0),
  value_currency char(3),
  value_period text CHECK (value_period IN ('one_time', 'monthly', 'yearly')),
  board_position numeric NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, user_id),
  -- value fields are all-or-nothing (DATA-MODEL.md 6.6)
  CHECK ((value_amount IS NULL) = (value_currency IS NULL) AND (value_amount IS NULL) = (value_period IS NULL)),
  FOREIGN KEY (company_id, user_id) REFERENCES __APP_SCHEMA__.companies (id, user_id) ON DELETE CASCADE
);

CREATE TABLE __APP_SCHEMA__.deal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  event_type text NOT NULL DEFAULT 'call' CHECK (event_type IN (
    'call', 'team_call', 'demo', 'email', 'document', 'contract', 'legal_review', 'meeting', 'qa', 'feedback',
    'pricing', 'negotiation', 'review', 'lunch', 'site_visit', 'website_visit', 'outreach', 'onboarding', 'closing')),
  color_variant text NOT NULL DEFAULT 'default' CHECK (color_variant IN ('default', 'blue', 'purple', 'red', 'green')),
  event_date date NOT NULL,
  sort_key numeric NOT NULL DEFAULT 0,
  owner_kind text NOT NULL DEFAULT 'user' CHECK (owner_kind IN ('user', 'contact', 'team', 'automation')),
  owner_contact_id uuid,
  owner_automation text CHECK (owner_automation IN ('ai', 'email', 'calendar')),
  notes text,
  completed_at timestamptz,
  -- 'whatsapp' = logged by the person through the WhatsApp assistant
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai', 'automation', 'import', 'whatsapp')),
  ai_review_status text CHECK (ai_review_status IN ('pending', 'accepted', 'dismissed', 'expired', 'superseded')),
  ai_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, user_id),
  CHECK ((origin = 'ai') = (ai_review_status IS NOT NULL)),
  CHECK (NOT (ai_review_status = 'pending' AND completed_at IS NOT NULL)),
  CHECK ((owner_kind = 'automation') = (owner_automation IS NOT NULL)),
  FOREIGN KEY (deal_id, user_id) REFERENCES __APP_SCHEMA__.deals (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_contact_id, user_id) REFERENCES __APP_SCHEMA__.contacts (id, user_id) ON DELETE SET NULL (owner_contact_id)
);
CREATE INDEX deal_events_timeline ON __APP_SCHEMA__.deal_events (deal_id, event_date, sort_key) WHERE deleted_at IS NULL;

CREATE TABLE __APP_SCHEMA__.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  remind_at timestamptz NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'whatsapp', 'sms')),
  recipient_kind text NOT NULL DEFAULT 'user' CHECK (recipient_kind IN ('user', 'contact', 'custom')),
  recipient_contact_id uuid,
  recipient_label text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  -- draft = belongs to a pending AI suggestion and never fires
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  failure_reason text,
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai', 'automation', 'import', 'whatsapp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, user_id),
  FOREIGN KEY (event_id, user_id) REFERENCES __APP_SCHEMA__.deal_events (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_contact_id, user_id) REFERENCES __APP_SCHEMA__.contacts (id, user_id) ON DELETE SET NULL (recipient_contact_id)
);
CREATE INDEX reminders_queue ON __APP_SCHEMA__.reminders (status, remind_at) WHERE status = 'scheduled' AND deleted_at IS NULL;

-- Append-only: written by triggers, never by the browser.
CREATE TABLE __APP_SCHEMA__.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  deal_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  changes jsonb,
  -- 'app' or 'whatsapp' (set by the agent_* functions)
  via text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_deal ON __APP_SCHEMA__.activity_log (deal_id, created_at DESC);

-- Each login sees and changes only its own rows, and only while it's an active member.
ALTER TABLE __APP_SCHEMA__.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.deal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE __APP_SCHEMA__.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_rows ON __APP_SCHEMA__.companies FOR ALL TO authenticated
  USING (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member()) WITH CHECK (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member());
CREATE POLICY own_rows ON __APP_SCHEMA__.contacts FOR ALL TO authenticated
  USING (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member()) WITH CHECK (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member());
CREATE POLICY own_rows ON __APP_SCHEMA__.deals FOR ALL TO authenticated
  USING (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member()) WITH CHECK (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member());
CREATE POLICY own_rows ON __APP_SCHEMA__.deal_events FOR ALL TO authenticated
  USING (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member()) WITH CHECK (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member());
CREATE POLICY own_rows ON __APP_SCHEMA__.reminders FOR ALL TO authenticated
  USING (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member()) WITH CHECK (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member());
CREATE POLICY own_rows_read ON __APP_SCHEMA__.activity_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND __APP_SCHEMA__.is_active_member());

-- ---------------------------------------------------------------------------------------------
-- Triggers: updated_at, activity log, deal last_activity_at
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = __APP_SCHEMA__, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.members FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.companies FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.contacts FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.deals FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.deal_events FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON __APP_SCHEMA__.reminders FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.touch_updated_at();

-- One activity_log row per real change, with { field: [before, after] }. Definer so the browser
-- needs no INSERT policy on the log. Also bumps the deal's last_activity_at for event and
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
  -- Filling a demo board isn't history worth showing
  IF current_setting('app.via', true) = 'seed' THEN
    RETURN NEW;
  END IF;
  FOR key IN SELECT jsonb_object_keys(new_row) LOOP
    CONTINUE WHEN key IN ('updated_at', 'last_activity_at', 'user_id', 'id', 'created_at');
    IF TG_OP = 'INSERT' OR (old_row -> key) IS DISTINCT FROM (new_row -> key) THEN
      diff := diff || jsonb_build_object(key, jsonb_build_array(old_row -> key, new_row -> key));
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND diff = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  -- What the row is called, so history can name it even after it's deleted
  diff := diff || jsonb_build_object('_label', coalesce(new_row ->> 'title', new_row ->> 'name', new_row ->> 'message'));

  act := CASE
    WHEN TG_OP = 'INSERT' THEN 'created'
    WHEN diff ? 'deleted_at' AND NEW.deleted_at IS NOT NULL THEN 'deleted'
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

  INSERT INTO __APP_SCHEMA__.activity_log (user_id, deal_id, entity_type, entity_id, action, changes, via)
  VALUES (
    (new_row ->> 'user_id')::uuid, deal,
    CASE TG_TABLE_NAME WHEN 'deal_events' THEN 'deal_event' WHEN 'companies' THEN 'company' WHEN 'contacts' THEN 'contact' ELSE rtrim(TG_TABLE_NAME, 's') END,
    NEW.id, act, diff, coalesce(nullif(current_setting('app.via', true), ''), 'app')
  );

  IF deal IS NOT NULL AND TG_TABLE_NAME IN ('deal_events', 'reminders') THEN
    UPDATE __APP_SCHEMA__.deals SET last_activity_at = now() WHERE id = deal;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.companies FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();
CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.contacts FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();
CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.deals FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();
CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.deal_events FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();
CREATE TRIGGER activity AFTER INSERT OR UPDATE ON __APP_SCHEMA__.reminders FOR EACH ROW EXECUTE FUNCTION __APP_SCHEMA__.log_activity();

-- ---------------------------------------------------------------------------------------------
-- Derived event status (DATA-MODEL.md 6.3), the one definition both the board and the WhatsApp
-- assistant use: suggested > done > overdue > next (first remaining, per deal) > upcoming.
-- ---------------------------------------------------------------------------------------------

CREATE VIEW __APP_SCHEMA__.event_status WITH (security_invoker = true) AS
SELECT
  e.id,
  e.deal_id,
  e.user_id,
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

-- ---------------------------------------------------------------------------------------------
-- Session: called by the app right after sign-in. The first person to sign in to a new CRM
-- becomes its admin. Returns the caller's membership (null = no access).
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.crm_session() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = __APP_SCHEMA__, pg_temp AS $$
DECLARE
  me uuid := auth.uid();
  login jsonb;
  member __APP_SCHEMA__.members;
BEGIN
  IF me IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('__APP_SCHEMA__.crm_session'));
  IF NOT EXISTS (SELECT 1 FROM __APP_SCHEMA__.members) THEN
    SELECT to_jsonb(u) INTO login FROM auth.users u WHERE u.id = me;
    INSERT INTO __APP_SCHEMA__.members (user_id, email, name, role, created_by)
    VALUES (
      me,
      coalesce(login ->> 'email', ''),
      coalesce(nullif(btrim(login -> 'raw_user_meta_data' ->> 'name'), ''), split_part(coalesce(login ->> 'email', 'Admin'), '@', 1)),
      'admin',
      me
    );
  END IF;
  SELECT * INTO member FROM __APP_SCHEMA__.members WHERE user_id = me;
  IF member.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'user_id', member.user_id, 'email', member.email, 'name', member.name, 'role', member.role,
    'status', member.status, 'timezone', member.timezone, 'currency', member.currency,
    'demo_seeded', member.demo_seeded_at IS NOT NULL, 'today', __APP_SCHEMA__.today()
  );
END $$;

-- Helpers stay off-limits to signed-out visitors (the schema's default grants include anon).
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.is_active_member() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.crm_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION __APP_SCHEMA__.log_activity() FROM PUBLIC, anon, authenticated;
