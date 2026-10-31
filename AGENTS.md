# Agent Instructions

This project uses Vite, React, TypeScript, Tailwind CSS, shadcn/ui, Supabase, React Router, and TanStack Query. Do not change it to a different framework, styling system, component library, backend client, routing library, or data-fetching library.

Use the existing shadcn components in `src/components/ui` where possible before adding new UI from scratch.

Use the Supabase client from `src/lib/supabase.ts` for all data access. Use TanStack Query hooks such as `useQuery` and `useMutation` for all data fetching and mutations; do not use raw `useEffect` plus `fetch` for app data access.

For every entity/table the app manages, always build full CRUD UI by default: a list/read view, a create form, an edit form (or inline editing), and a delete action with confirmation, even if the user's request only explicitly mentioned some of these. Assume "manage X" or "track X" means full CRUD unless the user's request clearly implies read-only.

Every list view must include loading, empty, and error states, not just the happy path.

If the app has any concept of users/accounts/login, use Supabase Auth (`supabase.auth`) by default: scaffold sign-up/sign-in and protect relevant routes/data via RLS policies tied to `auth.uid()`. Do not build a custom auth system.

When in doubt about whether an app needs auth, prefer adding basic Supabase Auth (email/password) over skipping it, if the spec implies any per-user data ownership.

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

This app's Supabase project is shared with other apps belonging to the same tenant: each app gets its own dedicated schema in that project, not its own project. The `APP_SCHEMA` environment variable holds this app's schema name. Every migration statement must be qualified to `APP_SCHEMA`, never to `public` or any other schema name: `CREATE TABLE <APP_SCHEMA>.<table>`, `ALTER TABLE <APP_SCHEMA>.<table>`, `CREATE POLICY ... ON <APP_SCHEMA>.<table>`, and so on. Never create a schema other than `APP_SCHEMA`, and never reference another app's schema, even to read from it — each app must only ever declare and touch its own schema. The frontend Supabase client (`src/lib/supabase.ts`) is already scoped to this schema via `VITE_SUPABASE_SCHEMA`, so table names in `.from(...)` calls stay unqualified (no schema prefix) exactly as before; the schema qualification only applies to migration SQL.

If the project already has Supabase tables (this is an edit to an existing app, not the first build), run `node scripts/inspect-supabase-schema.mjs` before writing a new migration. It prints the live schema: every table's columns, types, primary keys, foreign keys, RLS status, and policies, plus enums. Use that output, not assumptions from memory or from re-reading old migration files, to decide what the new migration should add, alter, or leave alone.

Create migration files with `supabase migration new <name>` (purely local file scaffolding, this part of the CLI is fine to use), write the SQL into the generated file, then apply it by running exactly `node scripts/apply-supabase-migrations.mjs`. Never run `supabase db push` - this app's Supabase project is shared with every other app belonging to the same tenant, and `db push` tracks applied migrations in a single ledger shared by the whole project, so it will fail (or worse, mis-signal state) the moment more than one app has pushed to the project. `apply-supabase-migrations.mjs` tracks applied migrations in a table scoped to this app's own schema instead, connects through Supabase's IPv4 session-mode pooler (the direct connection is IPv6-only and unreachable from this sandbox), and applies each pending migration file from `supabase/migrations` atomically. If it fails, fix the migration or schema issue and rerun it until it succeeds - do not fall back to `supabase db push` to work around a failure.

After any migration/schema change: run `node scripts/apply-supabase-migrations.mjs`, then run `node scripts/verify-supabase-schema.mjs`. If it fails, fix the migration files (do not leave empty migration files) and rerun both commands. Do not report the task as complete until this verifier passes.

After adding or changing managed entities/tables, run `node scripts/verify-crud-surface.mjs`. If it fails, add the missing read/list or create UI/data path and rerun it. Treat missing update/delete/form warnings as work to fix unless the user's request clearly implies read-only behavior.

You may use `curl` only for public HTTP/HTTPS endpoint checks, such as verifying a public Supabase REST endpoint. Never use `curl` against localhost, private IPs, Docker network hosts, metadata IPs, or internal service names. Never print secrets, full authorization headers, or environment variable values in curl commands or output.

For every new table in your `APP_SCHEMA` schema, enable row level security and add explicit least-privilege policies. Browser code uses the anon key, so do not rely on disabled RLS. For public/read-only demo or health-check data, add an explicit anon `SELECT` policy. For user-owned data, include `user_id uuid references auth.users(id)` and authenticated owner policies for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.

Allowed shell commands are intentionally limited. Use `npm install`/`npm uninstall` for dependency changes, `git add`/`git commit` for meaningful checkpoints, public-only `curl` checks, and Supabase commands such as `supabase migration new`, `node scripts/apply-supabase-migrations.mjs`, or `supabase functions deploy` for backend changes. Do not use raw network tools such as `wget`, destructive commands such as `rm -rf`, privilege/permission commands such as `sudo` or `chmod`, or commands outside `/workspace`.

Commit changes with a clear message per meaningful change.

Keep reusable components in `src/components/`. As the app grows, keep pages and routes organized clearly using concise names and folder structure that matches the feature boundaries.

For visual UI changes, inspect `src/App.tsx` first because it usually controls the rendered screen. Inspect `src/index.css` only when the request is about global styles, theme tokens, or when the rendered component still uses a theme utility such as `bg-background`.

Prefer changing the rendered component's `className` or `style` over changing CSS variables when an existing class directly controls the visible UI. Before editing a CSS variable such as `--background`, verify that the visible component still uses the matching token.

Determine whether this is a first build or an edit before deciding how much to change. If `src/App.tsx` still contains the starter placeholder text ("Hello, this app is ready to be built"), this is the first build of a new app. If that placeholder is gone, this is an edit to an app that already exists.

For a first build, do not minimize scope. Build a real navigation shell using React Router (`BrowserRouter` is already wired in `src/main.tsx`) with distinct routes for every separate area implied by the request, not a single screen or a `useState` tab toggle standing in for multiple pages. Always build the sidebar and navigation shell unless the request is clearly a single-page tool with no distinct sections (e.g., a landing page or a single form thing requiring single pages).

For an edit to an existing app, make the smallest code change that visibly satisfies the user's request. Keep the existing navigation structure, routes, and stack conventions intact; do not restructure or rebuild pages that were not part of the request, and do not introduce new frameworks or libraries without strong reason.

## This app: FluidCRM

This app was started from the FluidCRM template. The design docs are in `docs/` (`DATA-MODEL.md`, `UI-DECISIONS.md`, `AI-AGENTS.md`); read the relevant one before changing data or behaviour.

- Stack exception: the CRM screens are plain React in `src/crm/*.jsx` styled by `src/crm/fluidcrm.css` and `src/crm/app.css` (not shadcn). Keep that design when changing them; Tailwind utilities are available for new UI, but Tailwind's preflight reset is deliberately not loaded.
- Access: sign-in only, no sign-up. The `members` table decides who may use the app; the first person to sign in becomes `admin`; the admin adds and manages people on the Team page through the edge function in `supabase/functions/<APP_SCHEMA>-users`. Never add a sign-up form or let the browser write `members`.
- Data: every business row has `user_id` and each login sees only its own rows (RLS `user_id = auth.uid() AND is_active_member()`; composite foreign keys keep children on the same login as their parent). Keep both on any new table.
- The board (`src/crm/data.js`) loads deals with their events and reminders and saves by diffing the in-memory board; rows are soft-deleted with `deleted_at`, never hard-deleted from the UI. Event status (done, overdue, next, upcoming, suggested) is defined once in the `event_status` view.
- WhatsApp assistant: the platform's assistant calls Postgres functions named `agent_*` (SECURITY INVOKER, a JSON `COMMENT ON FUNCTION` with `description`, `audience: "team"`, `confirm`, `params`) and `agent_whoami()`. When you add a feature people might use from WhatsApp, add or extend an `agent_*` function in a new migration, with the same comment format, `PERFORM set_config('app.via', 'whatsapp', true)` before writes, and a `{ "message": "..." }` reply. Don't rename or remove existing `agent_*` functions without replacing them.
- Writes made from WhatsApp are logged with `via = 'whatsapp'` in `activity_log` (written by triggers only), which the company History shows.
- Live board: `useBoard` (`src/crm/data.js`) listens to inserts on `activity_log` over Supabase Realtime (migration `..._fluidcrm_realtime.sql` adds it to the `supabase_realtime` publication), plus a 15-second poll as a fallback; it reads the new log entries, reloads, and the board animates them (`live-*` classes in `src/crm/app.css`, drawn on a `::after` overlay so card entrance animations never restart). Any new table whose changes should appear live just needs the activity trigger.
