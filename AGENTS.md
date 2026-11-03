# Agent Instructions

This project uses Vite, React, TypeScript, Tailwind CSS, shadcn/ui, Supabase, React Router, and TanStack Query. Do not change it to a different framework, styling system, component library, backend client, routing library, or data-fetching library.

Use the existing shadcn components in `src/components/ui` where possible before adding new UI from scratch.

Use the Supabase client from `src/lib/supabase.ts` for all data access. Use TanStack Query hooks such as `useQuery` and `useMutation` for all data fetching and mutations; do not use raw `useEffect` plus `fetch` for app data access.

For every entity/table the app manages, always build full CRUD UI by default: a list/read view, a create form, an edit form (or inline editing), and a delete action with confirmation, even if the user's request only explicitly mentioned some of these. Assume "manage X" or "track X" means full CRUD unless the user's request clearly implies read-only.

Every list view must include loading, empty, and error states, not just the happy path.

Apps are built for a business and used by its employees, who already have one login for every app in the workspace. Use Supabase Auth (`supabase.auth`) with a sign-in screen (email and password) and no sign-up screen: employees are added by the workspace owner, not by signing up. Who is in the app and what they can do comes from the workspace, as described in "Workspace data and access" below. Do not build a custom auth system, and do not keep your own users or members table for employees. Only an app the request says is for the business's customers or the public (a booking page, a customer portal) has its own sign-up and its own table for those outside users.

This platform auto-confirms new signups project-wide (`mailer_autoconfirm`), so `supabase.auth.signUp()` returns an already-authenticated session immediately - there is no email-confirmation step for signup. Do not show a "check your email to confirm your account" message or otherwise block the UI waiting for email confirmation after signup; treat a successful `signUp()` call the same as a successful sign-in and move the user straight into the app. Password reset and magic-link sign-in are different: those still send a real email and still need the `emailRedirectTo`/`redirectTo` rule below.

This app is never served at its domain's root path - always build `${window.location.origin}${import.meta.env.BASE_URL}` (not bare `window.location.origin`) for any `redirectTo`/`emailRedirectTo` passed to `supabase.auth.resetPasswordForEmail`, `signUp`, `signInWithOtp`, or any other Supabase Auth call that sends a link in an email. `window.location.origin` alone drops the path this app is actually mounted under and sends the user to the platform's own root page instead of back into this app. This is enforced by a build check, not just this instruction: after adding or changing any such auth call, run `node scripts/verify-auth-redirect.mjs`. If it fails, fix the call to derive its redirect from `window.location` at runtime (directly, or via a local variable computed that way) and rerun it.

Images the user uploads arrive in two folders, and your instructions list each one with its role and description. `public/uploads/` holds assets - files that must appear in the app (a logo, product photos). Reference them in code only as `${import.meta.env.BASE_URL}uploads/<file>`, never as `/uploads/<file>` or a bare `uploads/<file>`: this app is never served at its domain's root, so those paths load nothing once it's previewed or published. Do not rename or move files in `public/uploads/`. `.agent-media/` holds reference images - screenshots, mockups, sketches - for you to look at only: never import them, link to them from code, or copy them into `src/` or `public/` under any name; build the UI from what they show instead. Both rules are enforced by build checks: after using uploaded images, run `node scripts/verify-asset-paths.mjs` and `node scripts/verify-reference-imports.mjs`, fix anything they report, and rerun them.

Run `npm install` after any change to `package.json`.

Treat incoming requests as product-level intent. The caller should describe what the app should do, how the UI and flow should behave, what data should be shown or saved, and what constraints to preserve. You are responsible for inspecting the existing codebase and deciding which files, components, routes, styles, Supabase migrations, queries, or dependencies must change to satisfy the requested app behavior.

Do not require the caller to name files or implementation details. Do not blindly follow file-level assumptions from the caller unless the user explicitly requested those details. For UI changes, inspect the rendered app entry points first and choose the correct files based on the current code.

When a request mentions a desired app flow, implement the full user-facing flow, including relevant screens or states, navigation, loading states, empty states, error states, success states, validation, and data persistence where appropriate.

Before stopping, verify that the implemented app behavior matches the original user request. Re-read the request and check the visible UI, app flow, data behavior, and important states. If the implementation does not satisfy the requested behavior, fix it before stopping.

After changing React, TypeScript, routing, data access, Supabase client usage, migrations, dependencies, or build configuration code, run `npm run build` before stopping. If the build reports syntax, TypeScript, import, dependency, or Vite errors, fix those errors and rerun `npm run build` until it passes.

Do not declare the task complete only because files were edited. The task is complete only when the requested user-facing behavior is implemented, the app builds successfully, and any required Supabase migrations have been created and applied with `node scripts/apply-supabase-migrations.mjs`.

Never ask for confirmation or pause for user input. This runs non-interactively from another agent, so make a reasonable default choice and proceed.

You may install or uninstall npm packages when the task genuinely requires it. Do not ask first, and keep dependency additions minimal.

Never run `npm run dev`, `vite`, or start/restart any server. The platform starts and manages the dev server separately, and edits hot-reload automatically.

Never print, log, or include environment variables or secrets in code, comments, commits, or output.

Use the Supabase CLI for schema and edge-function changes. When a task requires schema changes, create a new migration and apply it to the remote database before stopping. Never leave a task at "migration created" without running the required migration. Never hardcode Supabase credentials or service-role keys in source files.

This app's Supabase project is shared with other apps belonging to the same tenant: each app gets its own dedicated schema in that project, not its own project. The `APP_SCHEMA` environment variable holds this app's schema name. Every migration statement must be qualified to `APP_SCHEMA`, never to `public` or any other schema name: `CREATE TABLE <APP_SCHEMA>.<table>`, `ALTER TABLE <APP_SCHEMA>.<table>`, `CREATE POLICY ... ON <APP_SCHEMA>.<table>`, and so on. Never create a schema other than `APP_SCHEMA`, and never reference another app's schema, even to read from it — each app must only ever declare and touch its own schema. The one shared schema is `core` (see "Workspace data and access"): refer to it, never change it. The frontend Supabase client (`src/lib/supabase.ts`) is already scoped to this schema via `VITE_SUPABASE_SCHEMA`, so table names in `.from(...)` calls stay unqualified (no schema prefix) exactly as before; the schema qualification only applies to migration SQL.

If the project already has Supabase tables (this is an edit to an existing app, not the first build), run `node scripts/inspect-supabase-schema.mjs` before writing a new migration. It prints the live schema: every table's columns, types, primary keys, foreign keys, RLS status, and policies, plus enums. Use that output, not assumptions from memory or from re-reading old migration files, to decide what the new migration should add, alter, or leave alone.

Create migration files with `supabase migration new <name>` (purely local file scaffolding, this part of the CLI is fine to use), write the SQL into the generated file, then apply it by running exactly `node scripts/apply-supabase-migrations.mjs`. Never run `supabase db push` - this app's Supabase project is shared with every other app belonging to the same tenant, and `db push` tracks applied migrations in a single ledger shared by the whole project, so it will fail (or worse, mis-signal state) the moment more than one app has pushed to the project. `apply-supabase-migrations.mjs` tracks applied migrations in a table scoped to this app's own schema instead, connects through Supabase's IPv4 session-mode pooler (the direct connection is IPv6-only and unreachable from this sandbox), and applies each pending migration file from `supabase/migrations` atomically. If it fails, fix the migration or schema issue and rerun it until it succeeds - do not fall back to `supabase db push` to work around a failure.

After any migration/schema change: run `node scripts/apply-supabase-migrations.mjs`, then run `node scripts/verify-supabase-schema.mjs`. If it fails, fix the migration files (do not leave empty migration files) and rerun both commands. Do not report the task as complete until this verifier passes.

After adding or changing managed entities/tables, run `node scripts/verify-crud-surface.mjs`. If it fails, add the missing read/list or create UI/data path and rerun it. Treat missing update/delete/form warnings as work to fix unless the user's request clearly implies read-only behavior.

You may use `curl` only for public HTTP/HTTPS endpoint checks, such as verifying a public Supabase REST endpoint. Never use `curl` against localhost, private IPs, Docker network hosts, metadata IPs, or internal service names. Never print secrets, full authorization headers, or environment variable values in curl commands or output.

For every new table in your `APP_SCHEMA` schema, enable row level security and add explicit least-privilege policies for `SELECT`, `INSERT`, `UPDATE` and `DELETE`, built on the workspace checks in "Workspace data and access" below. Browser code uses the anon key, so do not rely on disabled RLS. Only data the request says is public gets an anon `SELECT` policy.

Allowed shell commands are intentionally limited. Use `npm install`/`npm uninstall` for dependency changes, `git add`/`git commit` for meaningful checkpoints, public-only `curl` checks, and Supabase commands such as `supabase migration new`, `node scripts/apply-supabase-migrations.mjs`, or `supabase functions deploy` for backend changes. Do not use raw network tools such as `wget`, destructive commands such as `rm -rf`, privilege/permission commands such as `sudo` or `chmod`, or commands outside `/workspace`.

Commit changes with a clear message per meaningful change.

Keep reusable components in `src/components/`. As the app grows, keep pages and routes organized clearly using concise names and folder structure that matches the feature boundaries.

For visual UI changes, inspect `src/App.tsx` first because it usually controls the rendered screen. Inspect `src/index.css` only when the request is about global styles, theme tokens, or when the rendered component still uses a theme utility such as `bg-background`.

Prefer changing the rendered component's `className` or `style` over changing CSS variables when an existing class directly controls the visible UI. Before editing a CSS variable such as `--background`, verify that the visible component still uses the matching token.

Determine whether this is a first build or an edit before deciding how much to change. If `src/App.tsx` still contains the starter placeholder text ("Hello, this app is ready to be built"), this is the first build of a new app. If that placeholder is gone, this is an edit to an app that already exists.

For a first build, do not minimize scope. Build a real navigation shell using React Router (`BrowserRouter` is already wired in `src/main.tsx`) with distinct routes for every separate area implied by the request, not a single screen or a `useState` tab toggle standing in for multiple pages. Always build the sidebar and navigation shell unless the request is clearly a single-page tool with no distinct sections (e.g., a landing page or a single form thing requiring single pages).

For an edit to an existing app, make the smallest code change that visibly satisfies the user's request. Keep the existing navigation structure, routes, and stack conventions intact; do not restructure or rebuild pages that were not part of the request, and do not introduce new frameworks or libraries without strong reason.

## Workspace data and access

Every app in a workspace shares one set of business data, the `core` schema: the business itself, its employees and who reports to whom, the companies and people it deals with (customers, vendors, dealers), their contacts and sites, areas, and the product and service catalogue. Never keep your own copy of any of these. Every app reading the same records is what lets the business see everything in one place and lets its WhatsApp assistant answer questions across apps.

**1. The first migration starts by linking the app and declaring its roles.**

```sql
SELECT core.link_app('<APP_SCHEMA>');
SELECT core.declare_role('<APP_SCHEMA>', 'dispatcher', 'Sees every visit and assigns them to field staff');
SELECT core.declare_role('<APP_SCHEMA>', 'field_staff', 'Logs visits and sees their own');
```

- `core.link_app` gives the app, in its own schema, read-only views of core and functions to change it, so the frontend keeps using `supabase.from(...)` and `supabase.rpc(...)` with no schema prefix:
  - views: `people` (employees), `members` (this app's members with their `roles`), `customers`, `vendors`, `parties` (all companies and individuals the business deals with), `party_roles`, `contacts`, `sites`, `areas`, `items`, `item_categories`, `units`, `tax_rates`, `departments`, `branches`, `organisation`;
  - functions: `create_customer`, `create_party`, `update_party`, `create_contact`, `update_contact`, `create_site`, `create_item`, `set_member` (add or remove a member and set their roles), and `agent_whoami` (the signed-in person's roles in this app, or null if they aren't a member).
- `link_app` also declares the `admin` role (full control of the app). Declare every other role the app needs, each with a one-line meaning; the workspace owner assigns them. A role several apps share, such as `hr` or `finance`, is declared with `p_workspace_wide => true`.
- Never write to, alter, or create anything in `core` yourself.

**2. Refer to core records by id.** Store `uuid` columns with real foreign keys: employees `REFERENCES core.people (id)`, customers and vendors `REFERENCES core.parties (id)`, `core.contacts`, `core.sites`, `core.items`, `core.areas`. Never create tables for employees, users, members, customers, clients, companies, vendors, contacts, products, departments, branches or areas. Details only this app needs about a core record go in this app's own table keyed by that id, e.g. `customer_profiles (customer_id uuid PRIMARY KEY REFERENCES core.parties (id), lead_source text)`.

**3. Create shared records through the functions, and handle duplicates.** `create_customer`, `create_party`, `create_contact`, `create_site` and `create_item` return JSON: `{party_id | contact_id | site_id | item_id, created, matched_on}`. When `created` is false the record already exists and its id is returned: use it. `matched_on: "name"` is only a guess (two different "Sharma Traders" can exist), so show the match ("Did you mean Sharma Traders, Lajpat Nagar?") and, if the user says it's a different one, call again with `p_allow_duplicate => true`. Use the `customers` view (or `parties`) for pickers and search, never a free-text customer name column.

**4. Access rules use core's checks.** Every table's policies must check membership of this app:

| The table holds | Read rule (`SELECT`) |
|---|---|
| Records that belong to a person (visits, deals, tasks, leads) | `USING (core.app_can_see('<APP_SCHEMA>', staff_id))`: their own and their team's records; the app's `admin` and the workspace owner see all. Add roles that see everyone: `OR core.has_app_role('<APP_SCHEMA>', 'dispatcher')` |
| Shared work or settings everyone in the app uses (open complaints, pipeline stages) | `USING (core.is_app_member('<APP_SCHEMA>'))` |
| Restricted data (salaries) | its own table, `USING (core.has_role('hr'))` or `core.has_app_role(...)` |

- A person column (`staff_id`, `owner_id`, `assignee_id`) is `uuid NOT NULL DEFAULT core.me() REFERENCES core.people (id)`.
- Write rules are just as strict: `INSERT` and `UPDATE` check `core.is_app_member(...)` plus the role allowed to make that change, and person-owned rows can only be created for oneself (`WITH CHECK (staff_id = core.me())`) unless a role may assign them to others.
- `core.me()` is the signed-in person's `core.people.id`; `core.reports_ids()` is them and everyone who reports to them (use it for "my team" screens and reports, not access rules).
- Avoid `SECURITY DEFINER` functions. If one is needed, it must check `core.is_app_member(...)` or `core.has_app_role(...)` inside, because it skips row level security.
- In the frontend, read the signed-in person's roles with `supabase.rpc('agent_whoami')` (a comma-separated list such as `admin, dispatcher`; null means not a member). A signed-in employee who isn't a member sees a screen saying the workspace owner needs to add them to this app, with a sign-out button. Show or hide screens and actions by role, but rely on the access rules for protection.
- Give the app a members screen for its admins: list `members`, add people picked from `people`, and set their roles with `supabase.rpc('set_member', { p_person_id, p_roles, p_active })`.

**5. Describe the app and every table**, so the assistant and the next builder know what the data means:

```sql
COMMENT ON SCHEMA <APP_SCHEMA> IS '{"description": "Field visits: staff log customer visits, confirmed by the customer''s OTP", "guide": "A visit counts once status = ''verified''."}';
COMMENT ON TABLE <APP_SCHEMA>.visits IS '{"description": "One customer visit by a field staff member", "visibility": "team", "person_column": "staff_id"}';
COMMENT ON COLUMN <APP_SCHEMA>.visits.status IS '{"description": "verified once the customer''s OTP is entered", "values": ["pending", "verified", "unverified"]}';
```

- `guide` holds the business definitions that column names don't tell you (what counts as revenue, a won deal, a completed visit).
- `visibility` is one of `team` (the person column's team rule), `everyone_in_app`, `owner_only`, `role:<name>`, `public` or `custom` (then add `visibility_note` explaining the rule in words).
- Mark personal data with `"sensitivity": "personal"` and restricted data (salary, bank details) with `"sensitivity": "restricted"`.
- A table that only looks like a core entity (say, outside users of a customer-facing app) says why in its comment: `"core_exception": "..."`.

These rules are enforced by a build check: `node scripts/verify-supabase-schema.mjs` fails if the app isn't linked to core, changes core, keeps its own copy of core data, misses descriptions, or has a table whose rules don't check membership. Fix what it reports with a new migration and rerun it.

## This app: FluidCRM

This app was started from the FluidCRM template (v5, on the workspace's shared data). The design docs are in `docs/` (`DATA-MODEL.md`, `UI-DECISIONS.md`, `AI-AGENTS.md`); read the relevant one before changing data or behaviour. Where they mention a `members` table, per-login boards or the app's own companies and contacts, this file wins: those moved to core.

- Stack exception: the CRM screens are plain React in `src/crm/*.jsx` styled by `src/crm/fluidcrm.css` and `src/crm/app.css` (not shadcn). Keep that design when changing them; Tailwind utilities are available for new UI, but Tailwind's preflight reset is deliberately not loaded.
- Access: sign-in only, no sign-up. Membership and roles are the workspace's (see "Workspace data and access"): `crm_session()` answers for the signed-in person (null = not a member), and the Team page (admins) lists `members`, adds people from `people`, and sets roles with `set_member`. Roles: `admin` and `sales_manager` (sees and changes every deal).
- Data: companies and contacts are core's (`parties`, `contacts` views; `deals.company_id`, `deal_events.owner_contact_id`, `reminders.recipient_contact_id`). The CRM's own details about them live in `company_profiles` (logo) and `contact_profiles` (decision maker). A deal belongs to `owner_id`: people see their own deals and their team's (`core.app_can_see`), `sales_manager` and `admin` see all. Events, reminders and `activity_log` follow their deal. Never add a companies or contacts table.
- The board (`src/crm/data.js`) loads open deals with their company (through the `parties` view), events and reminders, and saves by diffing the in-memory board. A company card saves through `save_company`, which creates or finds the shared company and returns its id (a new card switches to it). Removing a card soft-deletes the deal (`deleted_at`), never the company. Event status (done, overdue, next, upcoming, suggested) is defined once in the `event_status` view.
- WhatsApp assistant: the platform's assistant calls Postgres functions named `agent_*` (SECURITY INVOKER, a JSON `COMMENT ON FUNCTION` with `description`, `audience: "team"`, `confirm`, `params`); `agent_whoami()` comes from `core.link_app`. When you add a feature people might use from WhatsApp, add or extend an `agent_*` function in a new migration, with the same comment format, `PERFORM set_config('app.via', 'whatsapp', true)` before writes, and a `{ "message": "..." }` reply. A company named in WhatsApp resolves to an open deal, then to a company the workspace already knows (`resolve_known_company`), and is only created with `new_company = true`. Don't rename or remove existing `agent_*` functions without replacing them.
- Reminders: each reminder for an employee stores who it's for (`reminders.recipient_person_id`, a `core.people` id); for now people set them for themselves only (a trigger refuses anyone else). The platform sends due WhatsApp reminders once a minute through `platform_due_reminders()` and `platform_reminder_result()` (migration `..._fluidcrm_reminders.sql`, callable by the database owner only): sent, or `failed` with `failure_reason`, which the sidebar shows. Keep those two functions' names and columns if you change reminders.
- Writes made from WhatsApp are logged with `via = 'whatsapp'` in `activity_log` (written by triggers only), which the deal's History shows.
- Demo: the platform's "Load demo data" (console) calls `load_demo()` (migration `..._fluidcrm_demo.sql`) after loading the shared demo; it refers to the shared records with `core.demo_id(...)` and `core.demo_person(...)` and gives its own rows `core.demo_uuid()` ids, which `unload_demo()` removes. Keep both in step with any new table.
- Live board: `useBoard` (`src/crm/data.js`) listens to inserts on `activity_log` over Supabase Realtime (migration `..._fluidcrm_realtime.sql` adds it to the `supabase_realtime` publication; Realtime applies the table's access rules), plus a 15-second poll as a fallback; it reads the new log entries, reloads, and the board animates them (`live-*` classes in `src/crm/app.css`, drawn on a `::after` overlay so card entrance animations never restart). Any new table whose changes should appear live just needs the activity trigger.
