import { createClient } from "@supabase/supabase-js";

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseSchema = import.meta.env.VITE_SUPABASE_SCHEMA;

// This app's Supabase project is shared with every other app belonging to the same tenant
// (one Supabase project per tenant, schema-per-app) - db.schema scopes every query this client
// makes to this app's own schema, so it never sees or touches another app's tables. Every
// migration must be schema-qualified to match (see AGENTS.md).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: supabaseSchema },
});
