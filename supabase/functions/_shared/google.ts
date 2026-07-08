// Google-OAuth-Helfer für Gmail (oauth-gmail, mail-sync, send-mail).
// Refresh-Tokens leben AUSSCHLIESSLICH im Vault (CLAUDE.md Regel 1);
// hierüber werden nur kurzlebige Access-Tokens erzeugt.
import type { SupabaseClient } from "./supabase.ts";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
].join(" ");

export function googleEnv(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET sind nicht gesetzt");
  }
  return { clientId, clientSecret };
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Authorization-Code gegen Tokens tauschen (Callback-Schritt). */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const { clientId, clientSecret } = googleEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google-Token-Tausch fehlgeschlagen (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

/** Kurzlebiges Access-Token aus dem Vault-Refresh-Token erzeugen. */
export async function accessTokenForAccount(
  db: SupabaseClient,
  account: { id: string; vault_secret_id: string | null },
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!account.vault_secret_id) {
    throw new Error("Kein Refresh-Token hinterlegt — Konto neu verbinden.");
  }
  const { data: refreshToken, error } = await db.rpc("vault_get_secret", {
    p_id: account.vault_secret_id,
  });
  if (error || !refreshToken) {
    throw new Error(`Refresh-Token nicht lesbar: ${error?.message ?? "leer"}`);
  }

  const { clientId, clientSecret } = googleEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: String(refreshToken),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // invalid_grant = Nutzer hat den Zugriff widerrufen
    const body = await res.text();
    if (body.includes("invalid_grant")) {
      await db
        .from("mail_accounts")
        .update({ sync_state: "revoked", last_error: "Google-Zugriff widerrufen" })
        .eq("id", account.id);
    }
    throw new Error(`Token-Refresh fehlgeschlagen (${res.status}): ${body}`);
  }
  const tokens = (await res.json()) as GoogleTokens;
  return { accessToken: tokens.access_token, expiresIn: tokens.expires_in };
}

// ---------- Signierter OAuth-State (Callback kommt ohne JWT an) ----------

async function hmac(payload: string): Promise<string> {
  const secret = Deno.env.get("OAUTH_STATE_SECRET") ?? Deno.env.get("RUNNER_TOKEN_PEPPER");
  if (!secret) throw new Error("OAUTH_STATE_SECRET ist nicht gesetzt");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export interface OauthState {
  org_id: string;
  user_id: string;
  /** Ablauf als Unix-Sekunden (Missbrauch alter States verhindern) */
  exp: number;
}

export async function signState(state: OauthState): Promise<string> {
  const payload = btoa(JSON.stringify(state))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyState(raw: string): Promise<OauthState | null> {
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  if ((await hmac(payload)) !== sig) return null;
  try {
    const state = JSON.parse(
      atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
    ) as OauthState;
    if (!state.org_id || !state.user_id || state.exp < Date.now() / 1000) return null;
    return state;
  } catch {
    return null;
  }
}
