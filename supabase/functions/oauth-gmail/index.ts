// oauth-gmail — Gmail-OAuth-Flow (MASTERPLAN §4 B, §6.1).
// /start    (mit Nutzer-JWT):  Google-Auth-URL mit signiertem State
// /callback (Browser-Redirect, ohne JWT): Code → Tokens,
//           Refresh-Token → Vault, mail_accounts upsert, Redirect zur PWA.
// Der Browser sieht NIE ein Token — nur die Auth-URL und den Redirect.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import {
  exchangeCode,
  GMAIL_SCOPES,
  googleEnv,
  signState,
  verifyState,
} from "../_shared/google.ts";

function redirectUri(req: Request): string {
  // Öffentliche Functions-URL, z. B. https://<ref>.supabase.co/functions/v1/oauth-gmail/callback
  const base = Deno.env.get("PUBLIC_FUNCTIONS_URL") ??
    new URL(req.url).origin + "/functions/v1";
  return `${base.replace(/\/+$/, "")}/oauth-gmail/callback`;
}

function pwaUrl(): string {
  return (Deno.env.get("PWA_URL") ?? "http://localhost:5173").replace(/\/+$/, "");
}

async function requireUser(
  db: SupabaseClient,
  req: Request,
): Promise<{ userId: string } | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { userId: data.user.id };
}

async function handleStart(db: SupabaseClient, req: Request): Promise<Response> {
  const user = await requireUser(db, req);
  if (!user) return json({ error: "Nicht angemeldet" }, 401);

  const body = await req.json().catch(() => ({}));
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  if (!orgId) return json({ error: "orgId ist Pflicht" }, 400);

  // Mitgliedschaft prüfen — sonst könnte man Konten in fremde Orgs hängen
  const { data: member } = await db
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!member || member.role === "viewer") {
    return json({ error: "Keine Berechtigung für diese Organisation" }, 403);
  }

  const { clientId } = googleEnv();
  const state = await signState({
    org_id: orgId,
    user_id: user.userId,
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // Refresh-Token auch bei Re-Connect
  url.searchParams.set("state", state);

  return json({ url: url.toString() });
}

async function handleCallback(db: SupabaseClient, req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const errorParam = params.get("error");
  if (errorParam) {
    return Response.redirect(`${pwaUrl()}/einstellungen/postfaecher?error=${errorParam}`, 302);
  }
  const code = params.get("code") ?? "";
  const state = await verifyState(params.get("state") ?? "");
  if (!code || !state) {
    return json({ error: "Ungültiger OAuth-Callback (code/state)" }, 400);
  }

  const tokens = await exchangeCode(code, redirectUri(req));
  if (!tokens.refresh_token) {
    return Response.redirect(`${pwaUrl()}/einstellungen/postfaecher?error=no_refresh_token`, 302);
  }

  // Gmail-Adresse des verbundenen Kontos ermitteln
  const profileRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!profileRes.ok) {
    return json({ error: `Gmail-Profil nicht lesbar (${profileRes.status})` }, 502);
  }
  const profile = (await profileRes.json()) as { emailAddress: string };
  const email = profile.emailAddress.toLowerCase();

  // Refresh-Token in den Vault (Update bei Re-Connect)
  const { data: secretId, error: vaultError } = await db.rpc("vault_store_secret", {
    p_name: `gmail:${state.org_id}:${email}`,
    p_secret: tokens.refresh_token,
  });
  if (vaultError || !secretId) {
    return json({ error: `Vault-Fehler: ${vaultError?.message}` }, 500);
  }

  const { error: upsertError } = await db.from("mail_accounts").upsert(
    {
      org_id: state.org_id,
      user_id: state.user_id,
      provider: "gmail",
      email_address: email,
      display_name: email,
      vault_secret_id: secretId,
      sync_state: "pending",
      last_error: null,
    },
    { onConflict: "org_id,email_address" },
  );
  if (upsertError) return json({ error: upsertError.message }, 500);

  await db.from("audit_log").insert({
    org_id: state.org_id,
    actor_type: "user",
    actor_id: state.user_id,
    action: "mail_account.connected",
    entity_type: "mail_account",
    detail: { email },
  });

  return Response.redirect(
    `${pwaUrl()}/einstellungen/postfaecher?connected=${encodeURIComponent(email)}`,
    302,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const db = serviceClient();
  try {
    if (action === "start" && req.method === "POST") return await handleStart(db, req);
    if (action === "callback" && req.method === "GET") return await handleCallback(db, req);
    return json({ error: `Unbekannte Aktion: ${action}` }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
