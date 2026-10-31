// FluidCRM's member management, for its admin only. Needs the service role (creating logins,
// writing the members table), which never reaches the browser; every call re-checks that the
// caller is an active admin of this CRM.
//
// The workspace's login list is shared with every other app in it, so:
// - adding an email that already has a login just makes it a member (its password is untouched);
// - only logins this CRM created can have their password reset here.
//
// POST { action: "add", email, name? }          -> { member, temporary_password | null }
// POST { action: "set_status", user_id, status } (active | disabled)
// POST { action: "set_role", user_id, role }      (admin | user)
// POST { action: "reset_password", user_id }     -> { temporary_password }
// POST { action: "remove", user_id }

import { createClient } from "npm:@supabase/supabase-js@2";

const schema = "__APP_SCHEMA__";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function temporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authorization = req.headers.get("Authorization") ?? "";
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (!user) throw new HttpError(401, "Please sign in again.");

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: me } = await admin.from("members").select("role, status").eq("user_id", user.id).maybeSingle();
    if (!me || me.role !== "admin" || me.status !== "active") throw new HttpError(403, "Only the CRM's admin can manage users.");

    const body = await req.json().catch(() => ({}));
    const memberById = async (id: unknown) => {
      if (typeof id !== "string") throw new HttpError(400, "Which user?");
      const { data } = await admin.from("members").select("*").eq("user_id", id).maybeSingle();
      if (!data) throw new HttpError(404, "That user isn't a member.");
      return data;
    };

    switch (body.action) {
      case "add": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const name = String(body.name ?? "").trim() || email.split("@")[0];
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email.");

        let userId: string;
        let password: string | null = temporaryPassword();
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
        if (created.data.user) {
          userId = created.data.user.id;
        } else if (created.error && /already|exists|registered/i.test(created.error.message)) {
          // Someone who already has a workspace login (an employee, say): find them without
          // changing anything. generate_link only returns a link here; it's never sent or used.
          const found = await admin.auth.admin.generateLink({ type: "magiclink", email });
          if (!found.data.user) throw new HttpError(502, "Couldn't look up that login.");
          userId = found.data.user.id;
          password = null;
        } else {
          throw new HttpError(400, created.error?.message ?? "Couldn't create the login.");
        }

        const { data: existing } = await admin.from("members").select("user_id, created_login").eq("user_id", userId).maybeSingle();
        const { data: member, error } = await admin.from("members").upsert({
          user_id: userId,
          email,
          name,
          status: "active",
          created_login: existing?.created_login ?? password !== null,
          created_by: user.id,
        }, { onConflict: "user_id" }).select().single();
        if (error) throw new HttpError(500, error.message);
        return json(200, { member, temporary_password: password });
      }

      case "set_status": {
        const member = await memberById(body.user_id);
        if (member.user_id === user.id) throw new HttpError(400, "You can't disable yourself.");
        if (!["active", "disabled"].includes(body.status)) throw new HttpError(400, "Status must be active or disabled.");
        const { data, error } = await admin.from("members").update({ status: body.status }).eq("user_id", member.user_id).select().single();
        if (error) throw new HttpError(500, error.message);
        return json(200, { member: data });
      }

      case "set_role": {
        const member = await memberById(body.user_id);
        if (member.user_id === user.id) throw new HttpError(400, "You can't change your own role.");
        if (!["admin", "user"].includes(body.role)) throw new HttpError(400, "Role must be admin or user.");
        const { data, error } = await admin.from("members").update({ role: body.role }).eq("user_id", member.user_id).select().single();
        if (error) throw new HttpError(500, error.message);
        return json(200, { member: data });
      }

      case "reset_password": {
        const member = await memberById(body.user_id);
        if (!member.created_login) throw new HttpError(400, "This login belongs to the workspace, not this CRM - its owner manages its password.");
        const password = temporaryPassword();
        const { error } = await admin.auth.admin.updateUserById(member.user_id, { password });
        if (error) throw new HttpError(500, error.message);
        return json(200, { temporary_password: password });
      }

      case "remove": {
        const member = await memberById(body.user_id);
        if (member.user_id === user.id) throw new HttpError(400, "You can't remove yourself.");
        // Their board stays (it's theirs); adding them again brings it back.
        const { error } = await admin.from("members").delete().eq("user_id", member.user_id);
        if (error) throw new HttpError(500, error.message);
        return json(200, { removed: true });
      }

      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error(error);
    return json(500, { error: "Something went wrong." });
  }
});
