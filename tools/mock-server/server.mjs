// ============================================================
// Leitwerk Mock-Backend — NUR für lokale Tests/Demos.
// Emuliert das Supabase-Subset, das PWA und Runner in Phase 0
// nutzen (Auth, PostgREST, runner-broker, build-job-context),
// komplett ohne Docker/Supabase. Produktion läuft weiterhin
// ausschließlich auf Supabase (CLAUDE.md).
//
// Start:  node tools/mock-server/server.mjs   (Port 54321)
// Daten:  tools/mock-server/data/db.json (wird automatisch angelegt)
// ============================================================
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMailHub } from "./mail-hub.mjs";

const PORT = 54321;
const PEPPER = "mock-pepper";
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");
const DB_PATH = join(DATA_DIR, "db.json");

// ---------- Mini-Datenbank (JSON-Datei) ----------

const emptyDb = () => ({
  users: [],
  profiles: [],
  orgs: [],
  org_members: [],
  org_profile: [],
  number_ranges: [],
  automations: [],
  runners: [],
  runner_pairing_codes: [],
  agent_jobs: [],
  agent_job_events: [],
  audit_log: [],
  notifications: [],
  org_rules: [],
  tasks: [],
  // Etappe 1: Mail-Hub + Vorgangsakte
  mail_accounts: [],
  mail_threads: [],
  mail_messages: [],
  mail_attachments: [],
  mail_drafts: [],
  cases: [],
  case_links: [],
  case_events: [],
  contacts: [],
  companies: [],
  automation_runs: [],
  trust_stats: [],
});

// Rate-Limit auf /pair (Migration 017) — Fenster pro Minute, im Speicher.
const pairingAttempts = new Map(); // key: `${ip}|${minute}` → count
const MAX_PAIRING_ATTEMPTS_PER_MINUTE = 10;
const MAX_PAIRING_CODE_FAILURES = 5;

let db = emptyDb();
if (existsSync(DB_PATH)) {
  try {
    db = { ...emptyDb(), ...JSON.parse(readFileSync(DB_PATH, "utf8")) };
    console.log(`[mock] Datenbank geladen: ${DB_PATH}`);
  } catch {
    console.warn("[mock] db.json defekt — starte leer");
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }, 200);
}

const now = () => new Date().toISOString();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ---------- Trigger (wie in den Migrationen 001/010/016) ----------

function onUserCreated(user) {
  db.profiles.push({
    id: user.id,
    display_name: user.user_metadata?.display_name ?? user.email.split("@")[0],
    avatar_url: null,
    locale: "de-DE",
    timezone: "Europe/Berlin",
    active_org_id: null,
    prefs: {},
    created_at: now(),
    updated_at: now(),
  });
}

function onOrgCreated(org) {
  const year = new Date().getFullYear();
  db.org_profile.push({
    org_id: org.id,
    legal_name: org.name,
    legal_form: null,
    owner_name: null,
    register_court: null,
    register_number: null,
    vat_id: null,
    tax_number: null,
    is_small_business: false,
    street: null,
    zip: null,
    city: null,
    country: "DE",
    phone: null,
    email: null,
    website: null,
    bank_name: null,
    iban: null,
    bic: null,
    logo_storage_path: null,
    brand_color: "#1E2A4A",
    default_payment_terms_days: 14,
    default_vat_rate: 19,
    invoice_footer: null,
    quote_intro: null,
    dunning_fees: { 1: 0, 2: 5, 3: 10 },
    onboarding: {
      company_done: false,
      mail_connected: false,
      runner_paired: false,
      number_ranges_done: false,
      first_case_created: false,
    },
    created_at: now(),
    updated_at: now(),
  });
  for (const [kind, prefix] of [
    ["case", `V-${year}-`],
    ["quote", `AN-${year}-`],
    ["invoice", `RE-${year}-`],
    ["dunning", `MA-${year}-`],
  ]) {
    db.number_ranges.push({
      id: randomUUID(),
      org_id: org.id,
      kind,
      prefix,
      next_value: 1,
      padding: 4,
    });
  }
  const autos = [
    ["auto_label_mail", "Mails kategorisieren"],
    ["auto_case_match", "Vorgangs-Zuordnung"],
    ["auto_extract_tasks", "Aufgaben aus Mails"],
    ["auto_capture_invoice", "Rechnungserfassung"],
    ["auto_followup", "Nachfassen"],
    ["auto_dunning", "Mahnwesen"],
    ["auto_send_reply", "Antworten senden"],
  ];
  for (const [key, name] of autos) {
    db.automations.push({
      id: randomUUID(),
      org_id: org.id,
      key,
      name,
      autonomy_level: 1,
      is_enabled: true,
      min_confidence: 0.9,
      promote_threshold: 0.95,
      promote_min_runs: 30,
    });
  }
  // 016: Ersteller wird Owner
  db.org_members.push({
    org_id: org.id,
    user_id: org.created_by,
    role: "owner",
    is_active: true,
    joined_at: now(),
  });
}

// ---------- Tabellen-Defaults (statt DB-Defaults) ----------

const tableDefaults = {
  orgs: () => ({
    id: randomUUID(),
    locale: "de-DE",
    timezone: "Europe/Berlin",
    settings: {},
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  }),
  runner_pairing_codes: () => ({
    id: randomUUID(),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    claimed_at: null,
    runner_id: null,
    failed_attempts: 0,
    created_at: now(),
  }),
  org_rules: () => ({
    id: randomUUID(),
    is_enabled: true,
    conditions: [],
    action: {},
    created_by: null,
    created_at: now(),
    updated_at: now(),
  }),
  agent_jobs: () => ({
    id: randomUUID(),
    created_by: null,
    priority: 5,
    payload: {},
    context_hint: {},
    status: "queued",
    claimed_by: null,
    claimed_at: null,
    heartbeat_at: null,
    max_runtime_sec: 300,
    attempts: 0,
    max_attempts: 3,
    run_after: now(),
    result: null,
    result_hash: null,
    error: null,
    created_at: now(),
    updated_at: now(),
  }),
};

const insertTriggers = { orgs: onOrgCreated };

// ---------- Auth (GoTrue-Subset) ----------

function makeJwt(user) {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
      sub: user.id,
      email: user.email,
      role: "authenticated",
      aud: "authenticated",
      exp,
    })}.mock`,
    exp,
  };
}

function sessionFor(user) {
  const { token, exp } = makeJwt(user);
  const refresh = randomBytes(24).toString("base64url");
  user.refresh_tokens = user.refresh_tokens ?? [];
  user.refresh_tokens.push(refresh);
  persist();
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: refresh,
    user: publicUser(user),
  };
}

function publicUser(user) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: user.created_at,
    confirmed_at: user.created_at,
    last_sign_in_at: now(),
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: user.user_metadata ?? {},
    identities: [],
    created_at: user.created_at,
    updated_at: now(),
  };
}

function userFromAuthHeader(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payloadPart = token.split(".")[1];
  if (!payloadPart) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
    return db.users.find((u) => u.id === payload.sub) ?? null;
  } catch {
    return null;
  }
}

function handleAuth(req, url, body) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");

  if (req.method === "POST" && path === "/signup") {
    const email = String(body.email ?? "").toLowerCase();
    if (!email || !body.password) {
      return [400, { error: "email und password sind Pflicht" }];
    }
    if (db.users.some((u) => u.email === email)) {
      return [422, { error_code: "user_already_exists", msg: "User already registered" }];
    }
    const user = {
      id: randomUUID(),
      email,
      password: sha256(body.password),
      user_metadata: body.data ?? {},
      created_at: now(),
      refresh_tokens: [],
    };
    db.users.push(user);
    onUserCreated(user);
    persist();
    return [200, sessionFor(user)];
  }

  if (req.method === "POST" && path === "/token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const user = db.users.find(
        (u) =>
          u.email === String(body.email ?? "").toLowerCase() &&
          u.password === sha256(body.password ?? ""),
      );
      if (!user) {
        return [400, { error_code: "invalid_credentials", msg: "Invalid login credentials", error_description: "Invalid login credentials" }];
      }
      return [200, sessionFor(user)];
    }
    if (grant === "refresh_token") {
      const user = db.users.find((u) =>
        (u.refresh_tokens ?? []).includes(body.refresh_token),
      );
      if (!user) return [400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }];
      return [200, sessionFor(user)];
    }
    return [400, { msg: `grant_type ${grant} nicht unterstützt` }];
  }

  if (req.method === "GET" && path === "/user") {
    const user = userFromAuthHeader(req);
    if (!user) return [401, { msg: "invalid token" }];
    return [200, publicUser(user)];
  }

  if (req.method === "POST" && path === "/logout") {
    return [204, null];
  }

  return [404, { msg: `Auth-Route ${path} nicht implementiert` }];
}

// ---------- PostgREST-Subset ----------

function parseFilters(url) {
  const filters = [];
  for (const [key, raw] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    // not.is / not.eq etc.
    if (raw.startsWith("not.")) {
      const rest = raw.slice(4);
      const dot = rest.indexOf(".");
      filters.push({ column: key, op: `not.${rest.slice(0, dot)}`, value: rest.slice(dot + 1) });
      continue;
    }
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    filters.push({ column: key, op, value });
  }
  return filters;
}

/** Eingebettete Filter (z. B. automations.key=eq.…) auf Fremdtabellen auflösen. */
function resolveEmbedded(table, row, column) {
  if (table === "automation_runs" && column.startsWith("automations.")) {
    const automation = db.automations.find((a) => a.id === row.automation_id);
    return automation?.[column.slice("automations.".length)];
  }
  return row[column];
}

function applyFilters(rows, filters, table = "") {
  return rows.filter((row) =>
    filters.every(({ column, op, value }) => {
      const v = resolveEmbedded(table, row, column);
      // Volltextsuche (textSearch → wfts/plfts/fts): naive contains-Suche
      if (op.startsWith("wfts") || op.startsWith("plfts") || op.startsWith("fts")) {
        const haystack = `${row.subject ?? ""} ${row.body_text ?? ""}`.toLowerCase();
        return value
          .toLowerCase()
          .split(/\s+/)
          .every((term) => haystack.includes(term.replace(/['"]/g, "")));
      }
      switch (op) {
        case "eq":
          return String(v) === value;
        case "neq":
          return String(v) !== value;
        case "is":
          return value === "null" ? v === null || v === undefined : String(v) === value;
        case "not.is":
          return value === "null" ? v !== null && v !== undefined : String(v) !== value;
        case "gt":
          return v !== null && String(v) > value;
        case "gte":
          return v !== null && String(v) >= value;
        case "lt":
          return v !== null && String(v) < value;
        case "lte":
          return v !== null && String(v) <= value;
        case "in": {
          const list = value.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
          return list.includes(String(v));
        }
        default:
          return true;
      }
    }),
  );
}

function applyOrder(rows, url) {
  const order = url.searchParams.get("order");
  if (!order) return rows;
  const parts = order.split(",");
  const sorted = [...rows];
  for (const part of parts.reverse()) {
    const [col, ...mods] = part.split(".");
    const desc = mods.includes("desc");
    sorted.sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av > bv ? 1 : -1;
      return desc ? -cmp : cmp;
    });
  }
  return sorted;
}

/** Embedded-Beziehungen, die die PWA nutzt. */
function applySelect(table, rows, url) {
  const select = url.searchParams.get("select") ?? "*";
  if (table === "org_members" && select.includes("orgs(")) {
    return rows.map((row) => ({
      ...row,
      orgs: db.orgs.find((o) => o.id === row.org_id) ?? null,
    }));
  }
  if (table === "cases" && select.includes("companies(")) {
    return rows.map((row) => {
      const company = db.companies.find((c) => c.id === row.company_id);
      return { ...row, companies: company ? { name: company.name } : null };
    });
  }
  if (table === "automation_runs" && select.includes("automations")) {
    return rows.map((row) => {
      const automation = db.automations.find((a) => a.id === row.automation_id);
      return { ...row, automations: automation ? { key: automation.key } : null };
    });
  }
  return rows;
}

function wantsSingleObject(req) {
  return (req.headers.accept ?? "").includes("vnd.pgrst.object+json");
}

function handleRest(req, url, body) {
  const table = url.pathname.replace(/^\/rest\/v1\//, "").split("/")[0];
  if (!(table in db)) return [404, { message: `Tabelle ${table} unbekannt` }];

  const filters = parseFilters(url);

  if (req.method === "GET" || req.method === "HEAD") {
    let rows = applyFilters(db[table], filters, table);
    rows = applyOrder(rows, url);
    const limit = url.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    rows = applySelect(table, rows, url);
    if (wantsSingleObject(req)) {
      if (rows.length !== 1) {
        return [406, { code: "PGRST116", message: `${rows.length} rows`, details: null, hint: null }];
      }
      return [200, rows[0]];
    }
    return [200, rows];
  }

  if (req.method === "POST") {
    const items = Array.isArray(body) ? body : [body];
    const created = items.map((item) => {
      const row = { ...(tableDefaults[table]?.() ?? { id: randomUUID(), created_at: now() }), ...item };
      db[table].push(row);
      insertTriggers[table]?.(row);
      return row;
    });
    persist();
    const returning = (req.headers.prefer ?? "").includes("return=representation");
    if (!returning) return [201, null];
    if (wantsSingleObject(req)) return [201, created[0]];
    return [201, created];
  }

  if (req.method === "PATCH") {
    const rows = applyFilters(db[table], filters);
    for (const row of rows) Object.assign(row, body, { updated_at: now() });
    persist();
    const returning = (req.headers.prefer ?? "").includes("return=representation");
    if (!returning) return [204, null];
    return [200, wantsSingleObject(req) ? rows[0] : rows];
  }

  if (req.method === "DELETE") {
    const rows = applyFilters(db[table], filters);
    db[table] = db[table].filter((row) => !rows.includes(row));
    persist();
    return [204, null];
  }

  return [405, { message: "Methode nicht unterstützt" }];
}

// ---------- RPCs für die PWA (Migration 017) ----------

function handleRpc(req, url, body) {
  const fn = url.pathname.replace(/^\/rest\/v1\/rpc\//, "");
  const user = userFromAuthHeader(req);
  if (!user) return [401, { message: "invalid token" }];

  // Etappe-1-RPCs (create_case, assign_thread_to_case, record_automation_outcome)
  const mailRpc = mailHub.rpc(fn, body, user);
  if (mailRpc) return mailRpc;

  if (fn === "approve_runner" || fn === "reject_runner") {
    const runner = db.runners.find((r) => r.id === body.p_runner_id);
    if (!runner) return [400, { message: "Runner nicht gefunden" }];
    const member = db.org_members.find(
      (m) => m.org_id === runner.org_id && m.user_id === user.id && m.is_active,
    );
    if (!member || !["owner", "admin"].includes(member.role)) {
      return [403, { message: "Keine Berechtigung (Owner/Admin erforderlich)" }];
    }
    if (fn === "approve_runner") {
      if (runner.status !== "pending_approval") {
        return [400, { message: "Runner nicht freigabebedürftig" }];
      }
      Object.assign(runner, {
        status: "online",
        approved_by: user.id,
        approved_at: now(),
        updated_at: now(),
      });
    } else {
      Object.assign(runner, { status: "disabled", updated_at: now() });
    }
    db.audit_log.push({
      id: db.audit_log.length + 1,
      org_id: runner.org_id,
      actor_type: "user",
      actor_id: user.id,
      action: fn === "approve_runner" ? "runner.approved" : "runner.rejected",
      entity_type: "runner",
      entity_id: runner.id,
      detail: {},
      created_at: now(),
    });
    persist();
    return [204, null];
  }

  return [404, { message: `RPC ${fn} nicht implementiert` }];
}

// ---------- Job-Queue-RPCs (Portierung aus 009_rls_functions.sql) ----------

/** Nachtfenster prüfen (Spiegel von claim_next_job, Migration 017). */
function isInQuietHours(quietHours) {
  if (!quietHours?.start || !quietHours?.end) return null;
  const local = new Date().toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: quietHours.timezone ?? "Europe/Berlin",
  });
  const { start, end } = quietHours;
  return start <= end ? local >= start && local < end : local >= start || local < end;
}

function claimNextJob(runnerId) {
  const runner = db.runners.find((r) => r.id === runnerId);
  if (!runner || ["disabled", "pending_approval"].includes(runner.status)) {
    throw new Error("Runner unbekannt, deaktiviert oder wartet auf Freigabe");
  }
  // Heartbeat in der RPC (ein Roundtrip, Migration 017)
  Object.assign(runner, { last_heartbeat: now(), status: "online" });

  // Abo-Schutz: rollierende Fenster über die claimed-Ereignisse
  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const claims = db.agent_job_events.filter(
    (e) => e.event === "claimed" && e.runner_id === runnerId,
  );
  if (claims.filter((e) => e.created_at > hourAgo).length >= runner.max_jobs_per_hour) {
    persist();
    return null;
  }
  if (claims.filter((e) => e.created_at > dayAgo).length >= runner.daily_job_limit) {
    persist();
    return null;
  }

  const inWindow = isInQuietHours(runner.quiet_hours);
  const priorityAllowed = (p) => {
    if (p <= 2) return true; // interaktiv: immer
    if (inWindow === null) return true; // kein Fenster konfiguriert
    if (p >= 8) return inWindow; // Nacht-Batch nur im Fenster
    return !inWindow; // Normal/Sync nur außerhalb
  };

  const candidates = db.agent_jobs
    .filter(
      (j) =>
        j.org_id === runner.org_id &&
        j.status === "queued" &&
        j.run_after <= now() &&
        j.attempts < j.max_attempts &&
        priorityAllowed(j.priority),
    )
    .sort((a, b) => a.priority - b.priority || (a.created_at > b.created_at ? 1 : -1));
  const job = candidates[0];
  if (!job) {
    persist();
    return null;
  }
  Object.assign(job, {
    status: "claimed",
    claimed_by: runnerId,
    claimed_at: now(),
    heartbeat_at: now(),
    attempts: job.attempts + 1,
    updated_at: now(),
  });
  db.agent_job_events.push({ id: db.agent_job_events.length + 1, job_id: job.id, event: "claimed", runner_id: runnerId, detail: { runner: runnerId }, created_at: now() });
  persist();
  return job;
}

function jobHeartbeat(runnerId, jobId) {
  const job = db.agent_jobs.find(
    (j) => j.id === jobId && j.claimed_by === runnerId && ["claimed", "running"].includes(j.status),
  );
  if (job) Object.assign(job, { heartbeat_at: now(), status: "running", updated_at: now() });
  const runner = db.runners.find((r) => r.id === runnerId);
  if (runner && ["online", "offline"].includes(runner.status)) {
    Object.assign(runner, { last_heartbeat: now(), status: "online" });
  }
  persist();
}

function completeJob(runnerId, jobId, result, resultHash) {
  const job = db.agent_jobs.find((j) => j.id === jobId && j.claimed_by === runnerId);
  if (!job) return;
  Object.assign(job, { status: "done", result, result_hash: resultHash, error: null, updated_at: now() });
  db.agent_job_events.push({ id: db.agent_job_events.length + 1, job_id: jobId, event: "done", detail: {}, created_at: now() });
  // Migration 018: apply_job_result-Trigger
  mailHub.applyJobResult(job);
  persist();
}

function failJob(runnerId, jobId, errorMessage) {
  const job = db.agent_jobs.find((j) => j.id === jobId && j.claimed_by === runnerId);
  if (!job) return;
  if (job.attempts >= job.max_attempts) {
    Object.assign(job, { status: "failed", error: errorMessage, updated_at: now() });
    db.agent_job_events.push({ id: db.agent_job_events.length + 1, job_id: jobId, event: "failed", detail: { error: errorMessage }, created_at: now() });
  } else {
    Object.assign(job, {
      status: "queued",
      claimed_by: null,
      claimed_at: null,
      run_after: new Date(Date.now() + 2 ** job.attempts * 60_000).toISOString(),
      error: errorMessage,
      updated_at: now(),
    });
    db.agent_job_events.push({ id: db.agent_job_events.length + 1, job_id: jobId, event: "retry", detail: { error: errorMessage }, created_at: now() });
  }
  persist();
}

// ---------- Edge Functions: runner-broker + build-job-context ----------

/** Reine Token-Prüfung — Status-Gates macht handleBroker (wie runner-auth.ts). */
function verifyRunner(req) {
  const runnerId = req.headers["x-runner-id"];
  const token = req.headers["x-runner-token"];
  if (!runnerId || !token) return null;
  const runner = db.runners.find((r) => r.id === runnerId);
  if (!runner) return null;
  if (sha256(`${PEPPER}:${token}`) !== runner.token_hash) return null;
  return runner;
}

/** Für build-job-context: nur aktive Runner (pending/disabled abgelehnt). */
function verifyActiveRunner(req) {
  const runner = verifyRunner(req);
  if (!runner || ["disabled", "pending_approval"].includes(runner.status)) return null;
  return runner;
}

function handleBroker(req, url, body) {
  const action = url.pathname.split("/").filter(Boolean).pop();
  if (action === "health") return [200, { ok: true }];
  if (req.method !== "POST") return [405, { error: "Nur POST" }];

  if (action === "pair") {
    // Rate-Limit: 10 Versuche pro IP pro Minute (Migration 017)
    const ip = req.socket?.remoteAddress ?? "unknown";
    const windowKey = `${ip}|${new Date().toISOString().slice(0, 16)}`;
    const attempts = (pairingAttempts.get(windowKey) ?? 0) + 1;
    pairingAttempts.set(windowKey, attempts);
    if (attempts > MAX_PAIRING_ATTEMPTS_PER_MINUTE) {
      return [429, { error: "Zu viele Pairing-Versuche. Warte eine Minute.", code: "rate_limited" }];
    }

    const code = String(body.code ?? "").trim().toUpperCase();
    const pairing = db.runner_pairing_codes.find((p) => p.code === code);
    // Unbekannter Code = normaler Poll-Zustand des Runners
    if (!pairing) return [200, { status: "pending" }];
    if (pairing.failed_attempts >= MAX_PAIRING_CODE_FAILURES) {
      return [410, { error: "Pairing-Code gesperrt (zu viele Fehlversuche).", code: "code_blocked" }];
    }
    if (pairing.claimed_at || pairing.expires_at <= now()) {
      pairing.failed_attempts = (pairing.failed_attempts ?? 0) + 1;
      persist();
      return [410, { error: "Pairing-Code abgelaufen oder bereits verwendet.", code: "code_invalid" }];
    }
    const token = `lwr_${randomBytes(32).toString("base64url")}`;
    // Zwei-Stufen-Pairing: Runner startet als pending_approval
    const runner = {
      id: randomUUID(),
      org_id: pairing.org_id,
      user_id: pairing.user_id,
      name: body.name || "Mein Runner",
      token_hash: sha256(`${PEPPER}:${token}`),
      provider: body.provider ?? "claude_cli",
      capabilities: {},
      max_jobs_per_hour: 60,
      daily_job_limit: 500,
      quiet_hours: null,
      status: "pending_approval",
      approved_by: null,
      approved_at: null,
      last_heartbeat: null,
      version: body.version ?? null,
      created_at: now(),
      updated_at: now(),
    };
    db.runners.push(runner);
    Object.assign(pairing, { claimed_at: now(), runner_id: runner.id });
    db.audit_log.push({
      id: db.audit_log.length + 1,
      org_id: pairing.org_id,
      actor_type: "runner",
      actor_id: runner.id,
      action: "runner.paired",
      entity_type: "runner",
      entity_id: runner.id,
      detail: { status: "pending_approval" },
      created_at: now(),
    });
    persist();
    return [200, { status: "paired", runnerId: runner.id, runnerToken: token, orgId: runner.org_id, pendingApproval: true }];
  }

  const runner = verifyRunner(req);
  if (!runner) return [401, { error: "Runner-Authentifizierung fehlgeschlagen" }];

  // Selbstauskunft: auch für pending_approval erlaubt
  if (action === "status") return [200, { status: runner.status }];

  if (runner.status === "pending_approval") {
    return [403, { error: "Runner wartet auf Freigabe in der PWA (Einstellungen → Runner).", code: "pending_approval" }];
  }
  if (runner.status === "disabled") {
    return [403, { error: "Runner wurde deaktiviert.", code: "runner_disabled" }];
  }

  switch (action) {
    case "claim": {
      const job = claimNextJob(runner.id);
      return [200, { job }];
    }
    case "heartbeat": {
      if (body.jobId) jobHeartbeat(runner.id, body.jobId);
      else {
        Object.assign(runner, { last_heartbeat: now(), status: "online" });
        persist();
      }
      return [200, { ok: true }];
    }
    case "complete": {
      if (!body.jobId || body.result === undefined || !body.resultHash) {
        return [400, { error: "jobId, result und resultHash sind Pflicht" }];
      }
      completeJob(runner.id, body.jobId, body.result, body.resultHash);
      db.audit_log.push({
        id: db.audit_log.length + 1,
        org_id: runner.org_id,
        actor_type: "runner",
        actor_id: runner.id,
        action: "job.completed",
        entity_type: "agent_job",
        entity_id: body.jobId,
        job_id: body.jobId,
        detail: {},
        created_at: now(),
      });
      persist();
      return [200, { ok: true }];
    }
    case "fail": {
      if (!body.jobId) return [400, { error: "jobId ist Pflicht" }];
      failJob(runner.id, body.jobId, String(body.error ?? "Unbekannter Fehler"));
      return [200, { ok: true }];
    }
    default:
      return [404, { error: `Unbekannte Aktion: ${action}` }];
  }
}

function handleBuildJobContext(req, _url, body) {
  const runner = verifyActiveRunner(req);
  if (!runner) return [401, { error: "Runner-Authentifizierung fehlgeschlagen" }];
  const job = db.agent_jobs.find((j) => j.id === body.jobId);
  if (!job) return [404, { error: "Job nicht gefunden" }];
  if (job.claimed_by !== runner.id || !["claimed", "running"].includes(job.status)) {
    return [403, { error: "Job gehört nicht zu diesem Runner" }];
  }
  if (job.job_type === "echo") {
    return [200, {
      context: {
        jobId: job.id,
        jobType: "echo",
        locale: "de-DE",
        input: { text: String(job.payload?.text ?? "") },
      },
    }];
  }
  // Etappe 1: Mail-Skills + sync_mail
  const context = mailHub.buildContext(job);
  if (context) return [200, { context }];
  return [422, { error: `Unbekannter Job-Typ: ${job.job_type}` }];
}

// ---------- HTTP-Server ----------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, accept, accept-profile, content-profile, x-runner-id, x-runner-token, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS, HEAD",
  "Access-Control-Expose-Headers": "content-range",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  let body = {};
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
  }

  let status = 404;
  let payload = { message: `Route nicht implementiert: ${req.method} ${url.pathname}` };
  let extraHeaders = {};

  try {
    if (url.pathname.startsWith("/auth/v1/")) {
      [status, payload] = handleAuth(req, url, body);
    } else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      [status, payload] = handleRpc(req, url, body);
    } else if (url.pathname.startsWith("/rest/v1/")) {
      [status, payload] = handleRest(req, url, body);
    } else if (url.pathname.startsWith("/functions/v1/runner-broker")) {
      [status, payload] = handleBroker(req, url, body);
    } else if (url.pathname.startsWith("/functions/v1/build-job-context")) {
      [status, payload] = handleBuildJobContext(req, url, body);
    } else if (url.pathname.startsWith("/functions/v1/oauth-gmail")) {
      [status, payload, extraHeaders = {}] = mailHub.handleOauthGmail(
        req, url, body, userFromAuthHeader(req),
      );
    } else if (url.pathname.startsWith("/functions/v1/mail-sync")) {
      const runner = verifyRunner(req);
      if (!runner || ["disabled", "pending_approval"].includes(runner.status)) {
        [status, payload] = [401, { error: "Runner-Authentifizierung fehlgeschlagen" }];
      } else {
        [status, payload] = mailHub.handleMailSync(req, url, body, runner);
      }
    } else if (url.pathname.startsWith("/functions/v1/send-mail")) {
      [status, payload] = mailHub.handleSendMail(req, url, body, userFromAuthHeader(req));
    } else if (url.pathname.startsWith("/gmail/v1/users/me")) {
      [status, payload] = mailHub.handleGmailApi(req, url);
    } else if (url.pathname.startsWith("/storage/v1/object/")) {
      // Upload-Stub: Blob wird verworfen, Pfad bestätigt (nur Demo)
      [status, payload] = [200, { Key: url.pathname.replace("/storage/v1/object/", "") }];
    } else if (url.pathname.startsWith("/realtime/")) {
      // Kein Websocket im Mock — PWA fällt auf Polling zurück.
      [status, payload] = [404, { message: "Realtime im Mock nicht verfügbar (Polling aktiv)" }];
    }
  } catch (error) {
    status = 500;
    payload = { error: String(error?.message ?? error) };
  }

  if (url.pathname !== "/favicon.ico") {
    console.log(`[mock] ${req.method} ${url.pathname}${url.search} → ${status}`);
  }

  res.writeHead(status, { ...CORS, ...extraHeaders, "Content-Type": "application/json" });
  res.end(payload === null ? "" : JSON.stringify(payload));
});

// Mail-Hub-Emulation (Etappe 1) + Cron-Ersatz für den Gmail-Sync
const mailHub = createMailHub({ db, persist });
setInterval(() => mailHub.enqueueSyncJobs(), 30_000);

server.listen(PORT, () => {
  console.log(`[mock] Leitwerk-Mock-Backend läuft auf http://127.0.0.1:${PORT}`);
  console.log(`[mock] Functions-URL für den Runner: http://127.0.0.1:${PORT}/functions/v1`);
  console.log(`[mock] Gmail-API-Mock für den Runner: LEITWERK_GMAIL_API_URL=http://127.0.0.1:${PORT}/gmail/v1/users/me`);
});
