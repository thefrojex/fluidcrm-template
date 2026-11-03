-- Live board: the app subscribes (Supabase Realtime, postgres_changes) to inserts on its own
-- activity_log - every change from the app, another tab or the WhatsApp assistant writes one - and
-- reloads and animates what changed. Realtime applies the table's RLS, so a login only ever hears
-- about its own rows. The publication is the project's standard one; adding this app's table to it
-- touches nothing else.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = '__APP_SCHEMA__' AND tablename = 'activity_log') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE __APP_SCHEMA__.activity_log;
  END IF;
END $$;
