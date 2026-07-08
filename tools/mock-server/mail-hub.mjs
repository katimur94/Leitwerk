// ============================================================
// Mail-Hub-Emulation für den Leitwerk-Mock (Etappe 1) — NUR Tests/Demos.
// Emuliert: oauth-gmail (Demo-Postfach), eine Mini-Gmail-API für den
// Runner-Connector, mail-sync (/token /ingest), send-mail, die Trigger
// aus Migration 018 (on_mail_received, apply_job_result) und die RPCs
// create_case / assign_thread_to_case / record_automation_outcome.
// ============================================================
import { randomUUID } from "node:crypto";

const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const now = () => new Date().toISOString();

const DEMO_EMAIL = "demo@leitwerk.test";
const DEMO_MAILS = [
  {
    from: { name: "Anna Meier", email: "anna.meier@acme-bau.example" },
    subject: "Anfrage: Sanierung Bürogebäude",
    body: "Guten Tag,\n\nwir planen die Sanierung unseres Bürogebäudes in Dortmund und bitten um ein Angebot für die Elektroarbeiten.\n\nViele Grüße\nAnna Meier",
  },
  {
    from: { name: "OfficeSupply Buchhaltung", email: "buchhaltung@officesupply.example" },
    subject: "Rechnung RE-88123",
    body: "Sehr geehrte Damen und Herren,\n\nanbei unsere Rechnung RE-88123 über 486,90 EUR, zahlbar bis zum 21.07.2026.\n\nMit freundlichen Grüßen\nIhre Buchhaltung",
  },
  {
    from: { name: "Thomas Schulz", email: "t.schulz@stadtwerke.example" },
    subject: "Auftragsbestätigung Wartungsvertrag",
    body: "Hallo,\n\nhiermit bestätigen wir den Auftrag für den jährlichen Wartungsvertrag. Bitte senden Sie uns die Vertragsunterlagen zu.\n\nBeste Grüße\nThomas Schulz",
  },
  {
    from: { name: "Branchenblatt", email: "news@branchenblatt.example" },
    subject: "Newsletter KW 28: Neues aus der Branche",
    body: "Ihr wöchentlicher Newsletter mit allen Neuigkeiten aus der Branche. Zum Abbestellen hier klicken.",
  },
  {
    from: { name: "Julia Krause", email: "j.krause@notariat.example" },
    subject: "Terminvorschlag nächste Woche",
    body: "Guten Tag,\n\npasst Ihnen Mittwoch, 15.07. um 14:00 Uhr für die Beurkundung? Alternativ Donnerstag 10:00 Uhr.\n\nFreundliche Grüße\nJulia Krause",
  },
];

export function createMailHub({ db, persist }) {
  // ---------- Mini-Gmail-Store (pro Demo-Konto) ----------
  db.mock_gmail = db.mock_gmail ?? {}; // email → {historyId, messages:[…]}

  function seedDemoMailbox(email) {
    if (db.mock_gmail[email]) return;
    const base = Date.now() - 3 * 60 * 60_000;
    db.mock_gmail[email] = {
      historyId: DEMO_MAILS.length + 1,
      messages: DEMO_MAILS.map((mail, index) => ({
        id: `mock-msg-${index + 1}`,
        threadId: `mock-thr-${index + 1}`,
        labelIds: ["INBOX", "UNREAD"],
        internalDate: String(base + index * 25 * 60_000),
        historySeq: index + 1,
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: `${mail.from.name} <${mail.from.email}>` },
            { name: "To", value: email },
            { name: "Subject", value: mail.subject },
            { name: "Message-ID", value: `<mock-${index + 1}@leitwerk.test>` },
          ],
          body: { data: b64url(mail.body) },
        },
      })),
    };
    persist();
  }

  // ---------- Mini-Gmail-API (für den Runner-Connector) ----------
  function handleGmailApi(req, url) {
    const auth = req.headers.authorization ?? "";
    const email = auth.replace(/^Bearer mock-gmail-token:/, "");
    const store = db.mock_gmail[email];
    if (!store) return [401, { error: "Ungültiges Mock-Gmail-Token" }];
    const path = url.pathname.replace(/^\/gmail\/v1\/users\/me/, "");

    if (path === "/profile") {
      return [200, { emailAddress: email, historyId: String(store.historyId) }];
    }
    if (path === "/messages") {
      return [200, { messages: store.messages.map((m) => ({ id: m.id })) }];
    }
    if (path === "/history") {
      const since = Number(url.searchParams.get("startHistoryId") ?? "0");
      const added = store.messages.filter((m) => m.historySeq > since);
      return [200, {
        historyId: String(store.historyId),
        history: added.length
          ? [{ messagesAdded: added.map((m) => ({ message: { id: m.id } })) }]
          : [],
      }];
    }
    const messageMatch = path.match(/^\/messages\/([^/]+)$/);
    if (messageMatch) {
      const message = store.messages.find((m) => m.id === messageMatch[1]);
      return message ? [200, message] : [404, { error: "not found" }];
    }
    return [404, { error: `Mock-Gmail: ${path} nicht implementiert` }];
  }

  // ---------- oauth-gmail (Demo-Postfach statt echtem Google-Flow) ----------
  function handleOauthGmail(req, url, _body, user) {
    const action = url.pathname.split("/").filter(Boolean).pop();
    if (action === "start") {
      if (!user) return [401, { error: "Nicht angemeldet" }];
      const org = db.org_members.find((m) => m.user_id === user.id);
      if (!org) return [403, { error: "Keine Organisation" }];
      // Statt Google: direkt der Mock-Callback (Browser folgt der URL)
      return [200, {
        url: `http://127.0.0.1:54321/functions/v1/oauth-gmail/callback?mock_org=${org.org_id}&mock_user=${user.id}`,
      }];
    }
    if (action === "callback") {
      const orgId = url.searchParams.get("mock_org");
      const userId = url.searchParams.get("mock_user");
      if (!orgId || !userId) return [400, { error: "Mock-Callback ohne Kontext" }];
      seedDemoMailbox(DEMO_EMAIL);
      if (!db.mail_accounts.some((a) => a.org_id === orgId && a.email_address === DEMO_EMAIL)) {
        db.mail_accounts.push({
          id: randomUUID(),
          org_id: orgId,
          user_id: userId,
          provider: "gmail",
          email_address: DEMO_EMAIL,
          display_name: "Demo-Postfach",
          is_shared: false,
          vault_secret_id: randomUUID(),
          sync_state: "pending",
          sync_cursor: null,
          last_sync_at: null,
          last_error: null,
          signature_html: "<p>Mit freundlichen Grüßen<br>DiTom GmbH</p>",
          created_at: now(),
          updated_at: now(),
        });
        persist();
      }
      enqueueSyncJobs();
      return [302, null, { Location: `http://localhost:5173/einstellungen/postfaecher?connected=${DEMO_EMAIL}` }];
    }
    return [404, { error: `oauth-gmail: ${action} unbekannt` }];
  }

  // ---------- mail-sync (/token /ingest) ----------
  function handleMailSync(req, url, body, runner) {
    const action = url.pathname.split("/").filter(Boolean).pop();
    const account = db.mail_accounts.find(
      (a) => a.id === (body.accountId ?? url.searchParams.get("accountId")) && a.org_id === runner.org_id,
    );
    if (!account) return [404, { error: "Konto nicht gefunden" }];

    if (action === "token") {
      return [200, {
        accessToken: `mock-gmail-token:${account.email_address}`,
        expiresIn: 3600,
        emailAddress: account.email_address,
      }];
    }

    if (action === "ingest") {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      let inserted = 0;
      for (const m of messages) {
        let thread = db.mail_threads.find(
          (t) => t.account_id === account.id && t.provider_thread_id === m.provider_thread_id,
        );
        if (!thread) {
          thread = {
            id: randomUUID(),
            org_id: account.org_id,
            account_id: account.id,
            provider_thread_id: m.provider_thread_id,
            subject: m.thread_subject || m.subject || null,
            snippet: null,
            participants: [m.from_addr, ...(m.to_addrs ?? [])].slice(0, 20),
            message_count: 0,
            last_message_at: null,
            is_unread: true,
            labels: m.labels ?? [],
            category: null,
            urgency: null,
            ai_summary: null,
            case_id: null,
            snoozed_until: null,
            archived_at: null,
            deleted_at: null,
            created_at: now(),
            updated_at: now(),
          };
          db.mail_threads.push(thread);
        }
        if (db.mail_messages.some(
          (x) => x.account_id === account.id && x.provider_msg_id === m.provider_msg_id,
        )) continue;
        const message = {
          id: randomUUID(),
          org_id: account.org_id,
          thread_id: thread.id,
          account_id: account.id,
          provider_msg_id: m.provider_msg_id,
          rfc822_message_id: m.rfc822_message_id ?? null,
          direction: m.direction,
          from_addr: m.from_addr,
          to_addrs: m.to_addrs ?? [],
          cc_addrs: m.cc_addrs ?? [],
          sent_at: m.sent_at ?? now(),
          subject: m.subject ?? null,
          body_text: m.body_text ?? null,
          body_html: m.body_html ?? null,
          has_attachments: (m.attachments ?? []).length > 0,
          is_read: m.is_read ?? false,
          created_at: now(),
        };
        db.mail_messages.push(message);
        inserted += 1;
        onMailMessageInserted(message, thread);
      }
      Object.assign(account, {
        sync_cursor: body.cursor ?? account.sync_cursor,
        sync_state: body.syncState ?? "ok",
        last_sync_at: now(),
        last_error: body.lastError ?? null,
        updated_at: now(),
      });
      persist();
      return [200, { ok: true, messages: inserted, attachments: 0 }];
    }

    if (action === "attachment") {
      return [200, { storagePath: `org/${account.org_id}/mock/${randomUUID()}` }];
    }
    return [404, { error: `mail-sync: ${action} unbekannt` }];
  }

  // ---------- Trigger: on_mail_received / on_mail_sent (Migration 018) ----------
  function onMailMessageInserted(message, thread) {
    thread.message_count += 1;
    thread.last_message_at = message.sent_at;
    thread.updated_at = now();
    if (message.direction === "inbound") {
      thread.is_unread = true;
      thread.snippet = (message.body_text ?? "").replace(/\s+/g, " ").slice(0, 140);

      // Kontakt-Upsert
      const email = (message.from_addr?.email ?? "").toLowerCase();
      if (email && !db.contacts.some((c) => c.org_id === message.org_id && (c.email ?? "").toLowerCase() === email)) {
        const name = message.from_addr?.name ?? "";
        db.contacts.push({
          id: randomUUID(),
          org_id: message.org_id,
          company_id: null,
          first_name: name.split(" ")[0] || null,
          last_name: name.split(" ").slice(1).join(" ") || null,
          email,
          phone: null,
          role_title: null,
          source: "mail_auto",
          confidence: 0.6,
          created_at: now(),
          updated_at: now(),
        });
      }

      // KI-Jobs (idempotent) — nur bei aktivierten Automationen
      const hasAuto = (key) =>
        db.automations.some((a) => a.org_id === message.org_id && a.key === key && a.is_enabled !== false);
      if (hasAuto("auto_label_mail") && !db.agent_jobs.some(
        (j) => j.job_type === "classify_email" && j.payload?.message_id === message.id,
      )) {
        pushJob(message.org_id, "classify_email", { message_id: message.id, thread_id: thread.id });
      }
      if (hasAuto("auto_case_match") && !thread.case_id && !db.agent_jobs.some(
        (j) => j.job_type === "case_match" && j.payload?.thread_id === thread.id &&
          ["queued", "claimed", "running"].includes(j.status),
      )) {
        pushJob(message.org_id, "case_match", { thread_id: thread.id, message_id: message.id });
      }
    }
    if (thread.case_id) {
      pushCaseEvent(message.org_id, thread.case_id,
        message.direction === "inbound" ? "mail_in" : "mail_out",
        message.subject || "E-Mail", "mail_message", message.id,
        message.direction === "inbound" ? "system" : "user");
    }
    evaluateRules(message.org_id, message.direction === "inbound" ? "mail_received" : "mail_sent", {
      entity_type: "mail_message",
      entity_id: message.id,
      thread_id: thread.id,
      subject: message.subject ?? "",
      from: (message.from_addr?.email ?? "").toLowerCase(),
      has_attachments: message.has_attachments,
    });
    persist();
  }

  function pushJob(orgId, jobType, payload, priority = 5) {
    db.agent_jobs.push({
      id: randomUUID(), org_id: orgId, created_by: null, job_type: jobType,
      priority, payload, context_hint: {}, status: "queued", claimed_by: null,
      claimed_at: null, heartbeat_at: null, max_runtime_sec: 300, attempts: 0,
      max_attempts: 3, run_after: now(), result: null, result_hash: null,
      error: null, created_at: now(), updated_at: now(),
    });
  }

  function pushCaseEvent(orgId, caseId, eventType, title, entityType, entityId, actorType) {
    db.case_events.push({
      id: db.case_events.length + 1, org_id: orgId, case_id: caseId,
      event_type: eventType, title, entity_type: entityType, entity_id: entityId,
      actor_type: actorType, actor_id: null, occurred_at: now(), detail: {},
    });
    const c = db.cases.find((x) => x.id === caseId);
    if (c) c.last_activity_at = now();
  }

  // ---------- Regel-Engine light (Spiegel von evaluate_org_rules) ----------
  function conditionMatches(entity, cond) {
    const value = cond.field?.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), entity);
    switch (cond.op ?? "eq") {
      case "exists": return value !== undefined && value !== null;
      case "not_exists": return value === undefined || value === null;
      case "eq": return JSON.stringify(value ?? null) === JSON.stringify(cond.value ?? null);
      case "neq": return JSON.stringify(value ?? null) !== JSON.stringify(cond.value ?? null);
      case "contains":
        return value != null && cond.value != null &&
          String(value).toLowerCase().includes(String(cond.value).toLowerCase());
      case "in": return Array.isArray(cond.value) &&
        cond.value.some((v) => JSON.stringify(v) === JSON.stringify(value));
      case "gt": return value != null && cond.value != null && value > cond.value;
      case "gte": return value != null && cond.value != null && value >= cond.value;
      case "lt": return value != null && cond.value != null && value < cond.value;
      case "lte": return value != null && cond.value != null && value <= cond.value;
      default: return false;
    }
  }

  function evaluateRules(orgId, event, entity) {
    for (const rule of db.org_rules.filter(
      (r) => r.org_id === orgId && r.trigger_event === event && r.is_enabled,
    )) {
      const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
      if (!conditions.every((cond) => conditionMatches(entity, cond))) continue;
      const action = rule.action ?? {};
      if (action.type === "create_job" && action.job_type) {
        pushJob(orgId, action.job_type, { ...(action.payload ?? {}), entity, rule_id: rule.id }, action.priority ?? 5);
      } else if (action.type === "notify") {
        for (const member of db.org_members.filter((m) => m.org_id === orgId && m.is_active)) {
          if (action.user_id && member.user_id !== action.user_id) continue;
          db.notifications.push({
            id: randomUUID(), org_id: orgId, user_id: member.user_id, kind: "rule",
            title: action.title ?? rule.name, body: action.body ?? null,
            entity_type: entity.entity_type, entity_id: entity.entity_id,
            read_at: null, created_at: now(),
          });
        }
      } else if (action.type === "create_task") {
        db.tasks.push({
          id: randomUUID(), org_id: orgId, case_id: null,
          title: action.title ?? rule.name, description: action.description ?? null,
          status: "open", due_at: action.due_in_days
            ? new Date(Date.now() + action.due_in_days * 86_400_000).toISOString() : null,
          assignee_id: action.assignee_id ?? null, created_by: null, source: "automation",
          source_entity_type: entity.entity_type, source_entity_id: entity.entity_id,
          created_at: now(), updated_at: now(),
        });
      }
    }
  }

  // ---------- create_case / apply_job_result (Migration 018) ----------
  function createCase(orgId, title, source, createdBy) {
    const range = db.number_ranges.find((r) => r.org_id === orgId && r.kind === "case");
    const value = range ? range.next_value++ : 1;
    const caseNumber = `${range?.prefix ?? "V-"}${String(value).padStart(range?.padding ?? 4, "0")}`;
    const row = {
      id: randomUUID(), org_id: orgId, case_number: caseNumber, title,
      status: "open", company_id: null, contact_id: null, owner_id: null,
      tags: [], reference: null, ai_summary: null, ai_summary_at: null,
      expected_value: null, last_activity_at: now(), waiting_until: null,
      created_by: createdBy ?? null, source, created_at: now(), updated_at: now(),
      deleted_at: null,
    };
    db.cases.push(row);
    pushCaseEvent(orgId, row.id, "created", `Vorgang angelegt (${caseNumber})`, null, null,
      source === "ai_auto" ? "runner" : "user");
    persist();
    return row;
  }

  function assignThreadToCase(threadId, caseId, linkedBy, confidence) {
    const thread = db.mail_threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.case_id = caseId;
    thread.updated_at = now();
    pushCaseEvent(thread.org_id, caseId, "mail_linked",
      thread.subject || "E-Mail-Thread verknüpft", "mail_thread", threadId,
      linkedBy === "ai" ? "runner" : "user");
    persist();
  }

  function pushAutomationRun(orgId, key, job, entityId, action, status, confidence, detail) {
    const automation = db.automations.find((a) => a.org_id === orgId && a.key === key);
    if (!automation) return;
    db.automation_runs.push({
      id: randomUUID(), org_id: orgId, automation_id: automation.id, job_id: job.id,
      entity_type: "mail_thread", entity_id: entityId, action,
      autonomy_level: automation.autonomy_level ?? 1, confidence, status,
      hold_until: null, decided_by: null, outcome: null, outcome_by: null,
      outcome_at: null, detail, executed_at: status === "executed" ? now() : null,
      created_at: now(),
    });
  }

  function applyJobResult(job) {
    const result = job.result ?? {};
    if (job.job_type === "classify_email") {
      const thread = db.mail_threads.find((t) => t.id === job.payload?.thread_id);
      if (!thread) return;
      thread.category = result.category ?? thread.category;
      thread.urgency = result.urgency ?? thread.urgency;
      thread.updated_at = now();
      pushAutomationRun(job.org_id, "auto_label_mail", job, thread.id,
        `Kategorie: ${result.category ?? "—"}`, "executed", result.confidence ?? 0, result);
    } else if (job.job_type === "case_match") {
      const thread = db.mail_threads.find((t) => t.id === job.payload?.thread_id);
      if (!thread || thread.case_id) return;
      const automation = db.automations.find((a) => a.org_id === job.org_id && a.key === "auto_case_match");
      const minConfidence = automation?.min_confidence ?? 0.9;
      const confidence = result.confidence ?? 0;
      if (result.decision === "existing" && result.case_id && confidence >= minConfidence) {
        assignThreadToCase(thread.id, result.case_id, "ai", confidence);
        pushAutomationRun(job.org_id, "auto_case_match", job, thread.id, "Vorgang zugeordnet", "executed", confidence, result);
      } else if (result.decision === "new" && confidence >= minConfidence) {
        const created = createCase(job.org_id, result.title || thread.subject || "Neuer Vorgang", "ai_auto", null);
        assignThreadToCase(thread.id, created.id, "ai", confidence);
        pushAutomationRun(job.org_id, "auto_case_match", job, thread.id, "Vorgang zugeordnet", "executed", confidence, result);
      } else {
        pushAutomationRun(job.org_id, "auto_case_match", job, thread.id, "Vorgangs-Vorschlag", "proposed", confidence, result);
      }
    } else if (job.job_type === "draft_reply") {
      const thread = db.mail_threads.find((t) => t.id === job.payload?.thread_id);
      if (!thread) return;
      db.mail_drafts.push({
        id: randomUUID(), org_id: job.org_id, account_id: thread.account_id,
        thread_id: thread.id, created_by: null, source: "ai", job_id: job.id,
        to_addrs: result.to_addrs ?? [], cc_addrs: [], subject: result.subject ?? null,
        body_html: result.body_html ?? null, attachments: [], status: "draft",
        send_after: null, sent_message_id: null, created_at: now(), updated_at: now(),
      });
    } else if (job.job_type === "thread_summary") {
      const thread = db.mail_threads.find((t) => t.id === job.payload?.thread_id);
      if (thread) {
        thread.ai_summary = result.summary ?? null;
        thread.updated_at = now();
      }
    }
    persist();
  }

  // ---------- build-job-context für die Mail-Skills ----------
  function buildContext(job) {
    const thread = db.mail_threads.find((t) => t.id === job.payload?.thread_id);
    const message = db.mail_messages.find((m) => m.id === job.payload?.message_id);
    switch (job.job_type) {
      case "sync_mail": {
        const account = db.mail_accounts.find((a) => a.id === job.payload?.account_id);
        if (!account) return null;
        return {
          jobId: job.id, jobType: "sync_mail",
          account: {
            id: account.id, email_address: account.email_address,
            provider: account.provider, sync_cursor: account.sync_cursor, initial_days: 90,
          },
        };
      }
      case "classify_email":
        if (!message) return null;
        return {
          jobId: job.id, jobType: "classify_email", locale: "de-DE",
          categories: ["anfrage", "auftrag", "rechnung", "termin", "mahnung", "newsletter", "spam_verdacht", "sonstiges"],
          message: {
            subject: message.subject ?? "", from: message.from_addr,
            body_excerpt: (message.body_text ?? "").slice(0, 4000),
            has_attachments: message.has_attachments, sent_at: message.sent_at,
          },
          thread: { subject: thread?.subject ?? "", message_count: thread?.message_count ?? 1 },
        };
      case "case_match":
        if (!thread) return null;
        return {
          jobId: job.id, jobType: "case_match", locale: "de-DE",
          thread: {
            subject: thread.subject ?? "", participants: thread.participants ?? [],
            snippet: thread.snippet ?? "", category: thread.category,
          },
          message: {
            from: message?.from_addr ?? { email: "" },
            body_excerpt: (message?.body_text ?? "").slice(0, 2000),
          },
          candidates: db.cases
            .filter((c) => c.org_id === job.org_id && ["open", "waiting"].includes(c.status) && !c.deleted_at)
            .slice(0, 20)
            .map((c) => ({
              case_id: c.id, case_number: c.case_number, title: c.title, status: c.status,
              company: null, reference: c.reference, last_activity_at: c.last_activity_at,
            })),
        };
      case "draft_reply": {
        if (!thread) return null;
        const account = db.mail_accounts.find((a) => a.id === thread.account_id);
        const messages = db.mail_messages
          .filter((m) => m.thread_id === thread.id)
          .sort((a, b) => (a.sent_at > b.sent_at ? 1 : -1))
          .slice(-10)
          .map((m) => ({
            direction: m.direction, from: m.from_addr, sent_at: m.sent_at,
            body_excerpt: (m.body_text ?? "").slice(0, 1500),
          }));
        const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
        return {
          jobId: job.id, jobType: "draft_reply", locale: "de-DE",
          reply_to: lastInbound?.from ?? { email: "" },
          subject: thread.subject ?? "", messages, style_profile: {},
          signature_html: account?.signature_html ?? null,
          instructions: String(job.payload?.instructions ?? ""),
          sender_name: account?.display_name ?? "",
        };
      }
      case "thread_summary":
        if (!thread) return null;
        return {
          jobId: job.id, jobType: "thread_summary", locale: "de-DE",
          subject: thread.subject ?? "",
          messages: db.mail_messages
            .filter((m) => m.thread_id === thread.id)
            .sort((a, b) => (a.sent_at > b.sent_at ? 1 : -1))
            .slice(-15)
            .map((m) => ({
              direction: m.direction, from: m.from_addr, sent_at: m.sent_at,
              body_excerpt: (m.body_text ?? "").slice(0, 1200),
            })),
        };
      default:
        return null;
    }
  }

  // ---------- send-mail (Versand fälliger Entwürfe) ----------
  function handleSendMail(_req, _url, body, user) {
    if (!user && body.mode !== "due") return [401, { error: "Nicht angemeldet" }];
    const draft = db.mail_drafts.find((d) => d.id === body.draftId);
    if (!draft) return [404, { error: "Entwurf nicht gefunden" }];
    if (!["scheduled", "holding"].includes(draft.status)) {
      return [409, { error: `Entwurf ist nicht sendebereit (Status: ${draft.status})` }];
    }
    if (draft.send_after && draft.send_after > now()) {
      return [425, { error: "Sende-Verzögerung läuft noch.", code: "not_due" }];
    }
    const account = db.mail_accounts.find((a) => a.id === draft.account_id);
    let thread = draft.thread_id ? db.mail_threads.find((t) => t.id === draft.thread_id) : null;
    if (!thread) {
      thread = {
        id: randomUUID(), org_id: draft.org_id, account_id: draft.account_id,
        provider_thread_id: `mock-out-${randomUUID().slice(0, 8)}`,
        subject: draft.subject, snippet: null, participants: draft.to_addrs,
        message_count: 0, last_message_at: null, is_unread: false, labels: [],
        category: null, urgency: null, ai_summary: null, case_id: null,
        snoozed_until: null, archived_at: null, deleted_at: null,
        created_at: now(), updated_at: now(),
      };
      db.mail_threads.push(thread);
    }
    const message = {
      id: randomUUID(), org_id: draft.org_id, thread_id: thread.id,
      account_id: draft.account_id, provider_msg_id: `mock-sent-${randomUUID().slice(0, 8)}`,
      rfc822_message_id: null, direction: "outbound",
      from_addr: { email: account?.email_address ?? "demo@leitwerk.test" },
      to_addrs: draft.to_addrs, cc_addrs: draft.cc_addrs, sent_at: now(),
      subject: draft.subject, body_text: (draft.body_html ?? "").replace(/<[^>]+>/g, " ").trim(),
      body_html: draft.body_html, has_attachments: (draft.attachments ?? []).length > 0,
      is_read: true, created_at: now(),
    };
    db.mail_messages.push(message);
    Object.assign(draft, { status: "sent", sent_message_id: message.id, thread_id: thread.id, updated_at: now() });
    onMailMessageInserted(message, thread);
    persist();
    return [200, { ok: true, providerMsgId: message.provider_msg_id }];
  }

  // ---------- RPCs (Migration 018) ----------
  function rpc(fn, body, user) {
    if (fn === "create_case") {
      if (!user) return [401, { message: "Nicht angemeldet" }];
      return [200, createCase(body.p_org, body.p_title, body.p_source ?? "manual", body.p_created_by ?? user.id)];
    }
    if (fn === "assign_thread_to_case") {
      assignThreadToCase(body.p_thread, body.p_case, body.p_linked_by ?? "user", body.p_confidence ?? null);
      return [204, null];
    }
    if (fn === "record_automation_outcome") {
      const run = db.automation_runs.find((r) => r.id === body.p_run_id);
      if (!run) return [400, { message: "automation_run nicht gefunden" }];
      Object.assign(run, { outcome: body.p_outcome, outcome_by: user?.id ?? null, outcome_at: now() });
      persist();
      return [204, null];
    }
    return null;
  }

  // ---------- Cron-Ersatz: Sync-Jobs alle 30 s ----------
  function enqueueSyncJobs() {
    for (const account of db.mail_accounts.filter(
      (a) => a.provider === "gmail" && ["pending", "ok", "error"].includes(a.sync_state),
    )) {
      const hasRunner = db.runners.some(
        (r) => r.org_id === account.org_id && !["disabled", "pending_approval"].includes(r.status),
      );
      const pending = db.agent_jobs.some(
        (j) => j.job_type === "sync_mail" && j.payload?.account_id === account.id &&
          ["queued", "claimed", "running"].includes(j.status),
      );
      if (hasRunner && !pending) {
        pushJob(account.org_id, "sync_mail", { account_id: account.id }, 6);
      }
    }
    persist();
  }

  return {
    handleGmailApi,
    handleOauthGmail,
    handleMailSync,
    handleSendMail,
    buildContext,
    applyJobResult,
    rpc,
    enqueueSyncJobs,
  };
}
