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

// ZUGFeRD-artiges CII-XML für die Demo-Rechnung (Etappe 3: extract_invoice
// liest strukturierte E-Rechnungen deterministisch, ohne KI).
const DEMO_INVOICE_XML = `<?xml version="1.0"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocument>
    <ram:ID>RE-88123</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102" xmlns:udt="x">20260705</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>OfficeSupply GmbH</ram:Name></ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>RE-88123</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE02120300000000202051</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102" xmlns:udt="x">20260721</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>409.16</ram:LineTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">77.74</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>486.90</ram:GrandTotalAmount>
        <ram:DuePayableAmount>486.90</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
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
    // Mail 2 (Rechnung) ist bewusst 3 Tage alt → der Nacht-Wächter findet
    // eine unbeantwortete Mail (gap_scan-Demo); Rest wenige Stunden.
    const base = Date.now() - 3 * 60 * 60_000;
    const ageMs = (index) => (index === 1 ? 3.2 * 86_400_000 : (3 - index * 0.4) * 60 * 60_000);
    db.mock_gmail[email] = {
      historyId: DEMO_MAILS.length + 1,
      attachments: {
        "att-invoice-xml": Buffer.from(DEMO_INVOICE_XML, "utf8").toString("base64"),
      },
      messages: DEMO_MAILS.map((mail, index) => ({
        id: `mock-msg-${index + 1}`,
        threadId: `mock-thr-${index + 1}`,
        labelIds: ["INBOX", "UNREAD"],
        internalDate: String(Date.now() - ageMs(index)),
        historySeq: index + 1,
        payload: {
          mimeType: index === 1 ? "multipart/mixed" : "text/plain",
          headers: [
            { name: "From", value: `${mail.from.name} <${mail.from.email}>` },
            { name: "To", value: email },
            { name: "Subject", value: mail.subject },
            { name: "Message-ID", value: `<mock-${index + 1}@leitwerk.test>` },
          ],
          // Mail 2 (Rechnung): Body-Part + E-Rechnungs-XML-Anhang
          ...(index === 1
            ? {
                parts: [
                  { mimeType: "text/plain", body: { data: b64url(mail.body) } },
                  {
                    mimeType: "application/xml",
                    filename: "rechnung-RE-88123.xml",
                    body: { attachmentId: "att-invoice-xml", size: DEMO_INVOICE_XML.length },
                  },
                ],
              }
            : { body: { data: b64url(mail.body) } }),
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
    const attachmentMatch = path.match(/^\/messages\/[^/]+\/attachments\/([^/]+)$/);
    if (attachmentMatch) {
      const data = store.attachments?.[attachmentMatch[1]];
      if (!data) return [404, { error: "attachment not found" }];
      return [200, { data: Buffer.from(data, "base64").toString("base64url") }];
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
      // Etappe-3-Demo: eine überfällige Ausgangsrechnung fürs Mahnwesen
      if (!db.invoices_out.some((i) => i.org_id === orgId)) {
        const range = db.number_ranges.find((r) => r.org_id === orgId && r.kind === "invoice");
        const number = `${range?.prefix ?? "RE-"}${String(range ? range.next_value++ : 90).padStart(range?.padding ?? 4, "0")}`;
        let company = db.companies.find((c) => c.org_id === orgId && c.name === "ACME Bau GmbH");
        if (!company) {
          company = { id: randomUUID(), org_id: orgId, name: "ACME Bau GmbH", domain: null,
            address: null, vat_id: null, phone: null, notes: null, created_at: now(), updated_at: now() };
          db.companies.push(company);
        }
        const invoice = {
          id: randomUUID(), org_id: orgId, case_id: null, company_id: company.id,
          contact_id: null, quote_id: null, invoice_number: number, status: "sent",
          invoice_date: new Date(Date.now() - 24 * 86_400_000).toISOString().slice(0, 10),
          due_date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10),
          net_amount: 1000, vat_amount: 190, gross_amount: 1190, currency: "EUR",
          payment_terms: "14 Tage netto", buyer_reference: null,
          pdf_storage_path: null, xml_storage_path: null,
          sent_at: new Date(Date.now() - 24 * 86_400_000).toISOString(),
          paid_amount: 0, paid_at: null, created_by: userId,
          created_at: now(), updated_at: now(),
        };
        db.invoices_out.push(invoice);
        db.invoice_items.push({
          id: randomUUID(), invoice_id: invoice.id, position: 1,
          description: "Elektroinstallation lt. Angebot", quantity: 1,
          unit: "Pauschale", unit_price: 1000, vat_rate: 19, net_total: 1000,
        });
      }
      // Etappe-4-Demo: eine bewährte Stufe-3-Automation mit Aktion in der
      // Halte-Zone (auto_send_reply, Trefferquote hoch → Hochstufung war erlaubt).
      const sendReply = db.automations.find((a) => a.org_id === orgId && a.key === "auto_send_reply");
      if (sendReply && !db.automation_runs.some((r) => r.org_id === orgId && r.status === "holding")) {
        sendReply.autonomy_level = 3;
        if (!db.trust_stats.some((s) => s.automation_id === sendReply.id)) {
          db.trust_stats.push({
            automation_id: sendReply.id, org_id: orgId, total_runs: 60, correct_runs: 58,
            last_50_correct: 49, last_50_total: 50, accuracy: 58 / 60, updated_at: now(),
          });
        }
        const acct = db.mail_accounts.find((a) => a.org_id === orgId);
        const holdUntil = new Date(Date.now() + 15 * 60_000).toISOString();
        const draft = {
          id: randomUUID(), org_id: orgId, account_id: acct?.id ?? null, thread_id: null,
          created_by: null, source: "automation", job_id: null,
          to_addrs: [{ email: "kunde@example.com" }], cc_addrs: [],
          subject: "Re: Ihre Anfrage",
          body_html: "<p>Guten Tag,</p><p>gern senden wir Ihnen die gewünschten Unterlagen zu.</p>",
          attachments: [], status: "scheduled", send_after: holdUntil,
          sent_message_id: null, created_at: now(), updated_at: now(),
        };
        db.mail_drafts.push(draft);
        db.automation_runs.push({
          id: randomUUID(), org_id: orgId, automation_id: sendReply.id, job_id: null,
          entity_type: "mail_thread", entity_id: null, action: "Auto-Antwort: Re: Ihre Anfrage",
          autonomy_level: 3, confidence: 0.96, status: "holding", hold_until: holdUntil,
          outcome: null, outcome_by: null, outcome_at: null,
          detail: { draft_id: draft.id }, executed_at: null, created_at: now(),
        });
      }
      enqueueSyncJobs();
      return [302, null, { Location: `http://localhost:5173/einstellungen/postfaecher?connected=${DEMO_EMAIL}` }];
    }
    return [404, { error: `oauth-gmail: ${action} unbekannt` }];
  }

  // ---------- mail-sync (/token /ingest) ----------
  function handleMailSync(req, url, body, runner) {
    const action = url.pathname.split("/").filter(Boolean).pop();

    // /download braucht KEIN Konto — nur den Org-Check über den Runner
    // (wie die echte Edge Function mail-sync).
    if (action === "download") {
      const path = String(body.storagePath ?? "");
      if (!path.startsWith(`org/${runner.org_id}/`)) {
        return [403, { error: "Pfad gehört nicht zu dieser Organisation" }];
      }
      const data = (db.mock_storage ?? {})[path];
      if (data === undefined) return [404, { error: "Datei nicht gefunden" }];
      return [200, { data }];
    }

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
        for (const attachment of m.attachments ?? []) {
          db.mail_attachments.push({
            id: randomUUID(), org_id: account.org_id, message_id: message.id,
            filename: attachment.filename, mime_type: attachment.mime_type ?? null,
            size_bytes: attachment.size_bytes ?? null,
            storage_path: attachment.storage_path ?? null,
            document_id: null, ai_kind: null, created_at: now(),
          });
        }
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
      const path = `org/${account.org_id}/mock/${randomUUID()}/${url.searchParams.get("filename") ?? "anhang"}`;
      db.mock_storage = db.mock_storage ?? {};
      db.mock_storage[path] = (body && body.__rawBase64) || "";
      persist();
      return [200, { storagePath: path }];
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
      // Etappe 2: Aufgaben-Compiler
      if (hasAuto("auto_extract_tasks") && !db.agent_jobs.some(
        (j) => j.job_type === "extract_commitments" && j.payload?.message_id === message.id,
      )) {
        pushJob(message.org_id, "extract_commitments", { message_id: message.id, thread_id: thread.id }, 6);
      }
      // Etappe 2: Antwort eingetroffen → Follow-ups erledigen
      for (const followup of db.followups.filter(
        (f) => f.entity_type === "mail_thread" && f.entity_id === thread.id && f.status === "waiting",
      )) {
        Object.assign(followup, { status: "answered", answered_at: now() });
      }
    } else {
      // Etappe 2: Follow-up bei ausgehender Mail (auto_followup)
      if (db.automations.some(
        (a) => a.org_id === message.org_id && a.key === "auto_followup" && a.is_enabled !== false,
      )) {
        const existing = db.followups.find(
          (f) => f.entity_type === "mail_thread" && f.entity_id === thread.id,
        );
        const expected = new Date(Date.now() + 4 * 86_400_000).toISOString();
        if (existing) {
          Object.assign(existing, { expected_by: expected, status: "waiting", answered_at: null });
        } else {
          db.followups.push({
            id: randomUUID(), org_id: message.org_id, case_id: thread.case_id,
            entity_type: "mail_thread", entity_id: thread.id, expected_by: expected,
            reason: "Standard-Nachfassfrist nach ausgehender Mail", status: "waiting",
            reminder_draft_id: null, answered_at: null, created_by: "ai",
            created_at: now(), updated_at: now(),
          });
        }
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

  // Spiegel von notify_org (Migration 019): eine Notification je aktivem Mitglied.
  function notifyOrg(orgId, kind, title, entityType, entityId) {
    for (const member of db.org_members.filter((m) => m.org_id === orgId && m.is_active)) {
      db.notifications.push({
        id: randomUUID(), org_id: orgId, user_id: member.user_id, kind, title,
        body: null, entity_type: entityType, entity_id: entityId,
        read_at: null, pushed_at: null, created_at: now(),
      });
    }
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
      // Etappe 3: Rechnungs-Mail mit Anhang → Rechnungs-Erfassung
      const message = db.mail_messages.find((m) => m.id === job.payload?.message_id);
      if (
        result.category === "rechnung" && message?.has_attachments &&
        db.automations.some((a) => a.org_id === job.org_id && a.key === "auto_capture_invoice" && a.is_enabled !== false) &&
        !db.agent_jobs.some((j) => j.job_type === "extract_invoice" && j.payload?.message_id === message.id)
      ) {
        pushJob(job.org_id, "extract_invoice", { message_id: message.id, thread_id: message.thread_id }, 6);
      }
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
    } else if (job.job_type === "extract_commitments") {
      const thread = db.mail_threads.find((t) => t.id === job.payload?.thread_id);
      const automation = db.automations.find(
        (a) => a.org_id === job.org_id && a.key === "auto_extract_tasks",
      );
      for (const item of result.commitments ?? []) {
        if (db.tasks.some(
          (t) => t.org_id === job.org_id && t.source === "mail_extract" &&
            t.source_entity_id === job.payload?.message_id && t.title === item.title,
        )) continue;
        const task = {
          id: randomUUID(), org_id: job.org_id, case_id: thread?.case_id ?? null,
          title: item.title, description: item.reason ?? null, status: "open",
          due_at: item.due_at ?? null, assignee_id: null, created_by: null,
          source: "mail_extract", source_entity_type: "mail_message",
          source_entity_id: job.payload?.message_id ?? null, job_id: job.id,
          recurrence: null, completed_at: null, created_at: now(), updated_at: now(),
        };
        db.tasks.push(task);
        evaluateRules(job.org_id, "task_created", {
          entity_type: "task", entity_id: task.id, title: task.title, source: task.source,
        });
        if (automation) {
          db.automation_runs.push({
            id: randomUUID(), org_id: job.org_id, automation_id: automation.id, job_id: job.id,
            entity_type: "task", entity_id: task.id,
            action: `Aufgabe vorgeschlagen: ${task.title}`,
            autonomy_level: automation.autonomy_level ?? 1,
            confidence: item.confidence ?? 0.9, status: "executed", hold_until: null,
            decided_by: null, outcome: null, outcome_by: null, outcome_at: null,
            detail: item, executed_at: now(), created_at: now(),
          });
        }
      }
    } else if (job.job_type === "gap_scan") {
      for (const item of result.findings ?? []) {
        if (db.agent_findings.some(
          (f) => f.org_id === job.org_id && f.dedupe_key === item.dedupe_key,
        )) continue;
        const finding = {
          id: randomUUID(), org_id: job.org_id, case_id: item.case_id ?? null,
          kind: item.kind, severity: item.severity, title: item.title,
          description: item.description ?? null, suggested_action: item.suggested_action ?? null,
          entity_type: null, entity_id: null, job_id: job.id, status: "open",
          resolved_by: null, resolved_at: null, dedupe_key: item.dedupe_key,
          created_at: now(),
        };
        db.agent_findings.push(finding);
        evaluateRules(job.org_id, "finding_created", {
          entity_type: "agent_finding", entity_id: finding.id,
          kind: finding.kind, severity: finding.severity, title: finding.title,
        });
        if (finding.severity <= 2) {
          for (const member of db.org_members.filter((m) => m.org_id === job.org_id && m.is_active)) {
            db.notifications.push({
              id: randomUUID(), org_id: job.org_id, user_id: member.user_id, kind: "finding",
              title: finding.title, body: finding.description, entity_type: "agent_finding",
              entity_id: finding.id, read_at: null, pushed_at: null, created_at: now(),
            });
          }
        }
      }
    } else if (job.job_type === "morning_briefing") {
      const today = now().slice(0, 10);
      if (!db.briefings.some(
        (b) => b.org_id === job.org_id && b.kind === "morning" && b.for_date === today,
      )) {
        db.briefings.push({
          id: randomUUID(), org_id: job.org_id, user_id: null, kind: "morning",
          for_date: today, content_md: result.content_md ?? "",
          items: result.items ?? [], job_id: job.id, read_at: null, created_at: now(),
        });
        for (const member of db.org_members.filter((m) => m.org_id === job.org_id && m.is_active)) {
          db.notifications.push({
            id: randomUUID(), org_id: job.org_id, user_id: member.user_id, kind: "briefing",
            title: "Dein Morgen-Briefing ist da", body: null, entity_type: "briefing",
            entity_id: null, read_at: null, pushed_at: null, created_at: now(),
          });
        }
      }
    } else if (job.job_type === "extract_invoice") {
      if (result.found !== true) { persist(); return; }
      const message = db.mail_messages.find((m) => m.id === job.payload?.message_id);
      if (!message || db.invoices_in.some(
        (i) => i.org_id === job.org_id && i.extraction?.source_message_id === message.id,
      )) { persist(); return; }
      let companyId = null;
      if (result.issuer_name) {
        let company = db.companies.find(
          (c) => c.org_id === job.org_id && c.name.toLowerCase() === result.issuer_name.toLowerCase(),
        );
        if (!company) {
          company = { id: randomUUID(), org_id: job.org_id, name: result.issuer_name,
            domain: null, address: null, vat_id: null, phone: null, notes: null,
            created_at: now(), updated_at: now() };
          db.companies.push(company);
        }
        companyId = company.id;
      }
      const duplicate = db.invoices_in.find(
        (i) => i.org_id === job.org_id && i.invoice_number === result.invoice_number &&
          i.gross_amount === result.gross_amount,
      );
      const thread = db.mail_threads.find((t) => t.id === message.thread_id);
      db.invoices_in.push({
        id: randomUUID(), org_id: job.org_id, case_id: thread?.case_id ?? null,
        company_id: companyId, source: "mail",
        attachment_id: db.mail_attachments.find((a) => a.message_id === message.id)?.id ?? null,
        document_id: null, status: "captured",
        invoice_number: result.invoice_number ?? null,
        invoice_date: result.invoice_date ?? null, due_date: result.due_date ?? null,
        net_amount: result.net_amount ?? null, vat_amount: result.vat_amount ?? null,
        gross_amount: result.gross_amount ?? null,
        currency: result.currency ?? "EUR", iban: result.iban ?? null,
        payment_reference: result.payment_reference ?? null,
        extraction: { ...result, source_message_id: message.id },
        extraction_confidence: result.confidence ?? null,
        format_detected: result.format_detected ?? null,
        is_einvoice: result.is_einvoice ?? false,
        duplicate_of: duplicate?.id ?? null, reviewed_by: null, approved_by: null,
        paid_at: null, created_at: now(), updated_at: now(),
      });
      evaluateRules(job.org_id, "invoice_captured", {
        entity_type: "invoice_in", entity_id: db.invoices_in.at(-1).id,
        invoice_number: result.invoice_number, gross_amount: result.gross_amount,
        issuer: result.issuer_name, is_duplicate: !!duplicate,
      });
    } else if (job.job_type === "draft_dunning") {
      const dunning = db.dunning_runs.find(
        (d) => d.invoice_id === job.payload?.invoice_id && d.level === job.payload?.level,
      );
      const account = db.mail_accounts.find((a) => a.org_id === job.org_id);
      if (dunning && account) {
        db.mail_drafts.push({
          id: randomUUID(), org_id: job.org_id, account_id: account.id, thread_id: null,
          created_by: null, source: "automation", job_id: job.id,
          to_addrs: [], cc_addrs: [], subject: result.subject ?? null,
          body_html: result.body_html ?? null, attachments: [], status: "draft",
          send_after: null, sent_message_id: null, created_at: now(), updated_at: now(),
        });
        dunning.draft_id = db.mail_drafts.at(-1).id;
      }
    } else if (job.job_type === "followup_check") {
      for (const item of result.followups ?? []) {
        const followup = db.followups.find((f) => f.id === item.followup_id);
        if (!followup || followup.status !== "waiting" || item.action !== "escalate") continue;
        followup.status = "escalated";
        if (!db.agent_findings.some(
          (f) => f.org_id === job.org_id && f.dedupe_key === `followup:${followup.id}`,
        )) {
          db.agent_findings.push({
            id: randomUUID(), org_id: job.org_id, case_id: followup.case_id,
            kind: "stale", severity: 2, title: item.title ?? "Antwort überfällig",
            description: item.description ?? null, suggested_action: null,
            entity_type: "mail_thread", entity_id: followup.entity_id, job_id: job.id,
            status: "open", resolved_by: null, resolved_at: null,
            dedupe_key: `followup:${followup.id}`, created_at: now(),
          });
        }
        if (item.draft_instructions) {
          pushJob(job.org_id, "draft_reply", {
            thread_id: followup.entity_id,
            instructions: item.draft_instructions,
            source: "automation",
          }, 6);
        }
      }

    // ---------- Etappe 4 ----------
    } else if (job.job_type === "transcribe_note") {
      const note = db.notes.find((n) => n.id === job.payload?.note_id);
      if (note) {
        Object.assign(note, { body_md: result.transcript || note.body_md, source: "voice", updated_at: now() });
      }
    } else if (job.job_type === "transcribe_meeting") {
      const meeting = db.meetings.find((m) => m.id === job.payload?.meeting_id);
      if (meeting) {
        Object.assign(meeting, {
          transcript: result.transcript, transcript_done_at: now(), job_id: job.id, updated_at: now(),
        });
        db.meeting_segments = db.meeting_segments.filter((s) => s.meeting_id !== meeting.id);
        for (const seg of result.segments ?? []) {
          db.meeting_segments.push({
            id: randomUUID(), meeting_id: meeting.id, org_id: job.org_id,
            speaker: seg.speaker ?? null, starts_sec: seg.starts_sec ?? null,
            ends_sec: seg.ends_sec ?? null, content: seg.content ?? "",
          });
        }
        if (!db.agent_jobs.some(
          (j) => j.job_type === "summarize_meeting" && j.payload?.meeting_id === meeting.id,
        )) {
          pushJob(job.org_id, "summarize_meeting", { meeting_id: meeting.id }, 4);
        }
      }
    } else if (job.job_type === "summarize_meeting") {
      const meeting = db.meetings.find((m) => m.id === job.payload?.meeting_id);
      if (meeting) {
        Object.assign(meeting, {
          protocol_md: result.protocol_md ?? null,
          decisions: result.decisions ?? [],
          open_questions: result.open_questions ?? [],
          updated_at: now(),
        });
        for (const task of result.tasks ?? []) {
          if (db.tasks.some(
            (t) => t.org_id === job.org_id && t.source === "meeting" &&
              t.source_entity_id === meeting.id && t.title === task.title,
          )) continue;
          db.tasks.push({
            id: randomUUID(), org_id: job.org_id, case_id: meeting.case_id ?? null,
            title: task.title, description: task.assignee_hint ?? null, status: "open",
            due_at: task.due_at ?? null, assignee_id: null, created_by: null,
            source: "meeting", source_entity_type: "meeting", source_entity_id: meeting.id,
            job_id: job.id, recurrence: null, completed_at: null,
            created_at: now(), updated_at: now(),
          });
        }
        if (meeting.case_id) {
          pushCaseEvent(job.org_id, meeting.case_id, "meeting_summarized",
            `Protokoll: ${meeting.title}`, "meeting", meeting.id, "ai");
        }
        notifyOrg(job.org_id, "meeting_summarized", `Protokoll fertig: ${meeting.title}`, "meeting", meeting.id);
      }
    } else if (job.job_type === "knowledge_distill") {
      let added = 0;
      for (const fact of result.facts ?? []) {
        if (!fact.fact) continue;
        if (db.knowledge_items.some(
          (k) => k.org_id === job.org_id && k.fact.toLowerCase() === fact.fact.toLowerCase() && k.status !== "rejected",
        )) continue;
        let companyId = null;
        if (fact.company_name) {
          companyId = db.companies.find(
            (c) => c.org_id === job.org_id && c.name.toLowerCase() === fact.company_name.toLowerCase(),
          )?.id ?? null;
        }
        db.knowledge_items.push({
          id: randomUUID(), org_id: job.org_id, fact: fact.fact,
          category: fact.category ?? null, company_id: companyId, contact_id: null,
          source_type: fact.source_type ?? null, source_id: fact.source_id ?? null,
          confidence: fact.confidence ?? 0.8, status: "proposed", confirmed_by: null,
          job_id: job.id, created_at: now(), updated_at: now(),
        });
        added += 1;
      }
      if (added > 0) {
        notifyOrg(job.org_id, "knowledge_proposed", `${added} neue Wissens-Vorschläge zum Prüfen`, "knowledge_item", null);
      }
    } else if (job.job_type === "build_style_profile") {
      const account = db.mail_accounts.find((a) => a.id === job.payload?.account_id);
      const userId = account?.user_id ?? null;
      if (userId) {
        const existing = db.ai_style_profiles.find((p) => p.org_id === job.org_id && p.user_id === userId);
        const row = {
          id: existing?.id ?? randomUUID(), org_id: job.org_id, user_id: userId,
          profile: result.profile ?? {}, sample_count: result.sample_count ?? 0,
          built_at: now(), created_at: existing?.created_at ?? now(), updated_at: now(),
        };
        if (existing) Object.assign(existing, row);
        else db.ai_style_profiles.push(row);
      }
    } else if (job.job_type === "embed_backlog") {
      for (const item of result.items ?? []) {
        if (!Array.isArray(item.embedding) || item.embedding.length !== 1024) continue;
        const existing = db.embeddings.find(
          (e) => e.entity_type === item.entity_type && e.entity_id === item.entity_id &&
            e.chunk_index === (item.chunk_index ?? 0),
        );
        const row = {
          id: existing?.id ?? randomUUID(), org_id: job.org_id,
          entity_type: item.entity_type, entity_id: item.entity_id,
          chunk_index: item.chunk_index ?? 0, content: item.content ?? "",
          embedding: item.embedding, created_at: now(),
        };
        if (existing) Object.assign(existing, row);
        else db.embeddings.push(row);
      }
    }
    // semantic_search: kein Nebeneffekt — das Ergebnis (Query-Vektor) liest search_combined direkt.
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
      case "extract_commitments": {
        if (!message) return null;
        return {
          jobId: job.id, jobType: "extract_commitments", locale: "de-DE",
          today: now().slice(0, 10),
          message: {
            subject: message.subject ?? "", from: message.from_addr,
            body_excerpt: (message.body_text ?? "").slice(0, 4000),
            sent_at: message.sent_at,
          },
          existing_tasks: db.tasks
            .filter((t) => t.source_entity_id === message.id)
            .map((t) => t.title),
        };
      }
      case "gap_scan": {
        const dayMs = 86_400_000;
        const days = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / dayMs) : 0);
        return {
          jobId: job.id, jobType: "gap_scan", locale: "de-DE", today: now().slice(0, 10),
          stale_cases: db.cases
            .filter((c) => c.org_id === job.org_id && ["open", "waiting"].includes(c.status) &&
              days(c.last_activity_at) >= 5)
            .slice(0, 15)
            .map((c) => ({
              case_id: c.id, case_number: c.case_number, title: c.title,
              status: c.status, days_inactive: days(c.last_activity_at),
            })),
          unanswered_threads: db.mail_threads
            .filter((t) => t.org_id === job.org_id && t.is_unread && !t.archived_at &&
              days(t.last_message_at) >= 2)
            .slice(0, 15)
            .map((t) => ({
              thread_id: t.id, subject: t.subject ?? "",
              from: t.participants?.[0]?.email ?? "",
              days_waiting: days(t.last_message_at), urgency: t.urgency,
            })),
          overdue_followups: db.followups.filter(
            (f) => f.org_id === job.org_id && f.status === "waiting" && f.expected_by < now(),
          ).length,
          overdue_tasks: db.tasks.filter(
            (t) => t.org_id === job.org_id && ["open", "in_progress"].includes(t.status) &&
              t.due_at && t.due_at < now(),
          ).length,
        };
      }
      case "morning_briefing": {
        const org = db.orgs.find((o) => o.id === job.org_id);
        const unread = db.mail_threads.filter(
          (t) => t.org_id === job.org_id && t.is_unread && !t.archived_at,
        );
        const dueTasks = db.tasks.filter(
          (t) => t.org_id === job.org_id && ["open", "in_progress"].includes(t.status),
        ).slice(0, 5);
        const findings = db.agent_findings.filter(
          (f) => f.org_id === job.org_id && f.status === "open",
        ).slice(0, 5);
        return {
          jobId: job.id, jobType: "morning_briefing", locale: "de-DE",
          for_date: now().slice(0, 10), org_name: org?.name ?? "",
          stats: {
            unread_threads: unread.length,
            urgent_threads: unread.filter((t) => (t.urgency ?? 5) <= 2).length,
            due_tasks: dueTasks.length,
            overdue_followups: db.followups.filter(
              (f) => f.org_id === job.org_id && f.status === "waiting" && f.expected_by < now(),
            ).length,
            open_findings: findings.length,
          },
          top_items: [
            ...unread.slice(0, 4).map((t) => ({
              entity_type: "mail_thread", entity_id: t.id,
              title: t.subject ?? "(kein Betreff)", detail: "ungelesen",
            })),
            ...dueTasks.slice(0, 3).map((t) => ({
              entity_type: "task", entity_id: t.id, title: t.title, detail: "offene Aufgabe",
            })),
            ...findings.slice(0, 3).map((f) => ({
              entity_type: "agent_finding", entity_id: f.id, title: f.title,
              detail: `Severity ${f.severity}`,
            })),
          ].slice(0, 12),
        };
      }
      case "extract_invoice": {
        if (!message) return null;
        return {
          jobId: job.id, jobType: "extract_invoice", locale: "de-DE",
          today: now().slice(0, 10),
          message: {
            subject: message.subject ?? "", from: message.from_addr,
            body_excerpt: (message.body_text ?? "").slice(0, 6000),
          },
          attachments: db.mail_attachments
            .filter((a) => a.message_id === message.id)
            .map((a) => ({
              id: a.id, filename: a.filename, mime_type: a.mime_type,
              storage_path: a.storage_path,
            })),
        };
      }
      case "draft_dunning": {
        const invoice = db.invoices_out.find((i) => i.id === job.payload?.invoice_id);
        if (!invoice) return null;
        const profile = db.org_profile.find((p) => p.org_id === job.org_id);
        const company = db.companies.find((c) => c.id === invoice.company_id);
        const level = Number(job.payload?.level ?? 1);
        return {
          jobId: job.id, jobType: "draft_dunning", locale: "de-DE",
          level, fee: Number(profile?.dunning_fees?.[String(level)] ?? 0),
          invoice: {
            invoice_number: invoice.invoice_number,
            invoice_date: invoice.invoice_date, due_date: invoice.due_date,
            gross_amount: invoice.gross_amount, currency: invoice.currency,
            recipient_name: company?.name ?? "",
          },
          org: {
            legal_name: profile?.legal_name ?? "",
            iban: profile?.iban ?? null, bank_name: profile?.bank_name ?? null,
          },
        };
      }
      case "followup_check": {
        return {
          jobId: job.id, jobType: "followup_check", locale: "de-DE",
          today: now().slice(0, 10),
          overdue: db.followups
            .filter((f) => f.org_id === job.org_id && f.status === "waiting" &&
              f.entity_type === "mail_thread" && f.expected_by < now())
            .slice(0, 20)
            .map((f) => {
              const thread = db.mail_threads.find((t) => t.id === f.entity_id);
              return {
                followup_id: f.id, thread_id: f.entity_id,
                subject: thread?.subject ?? "",
                counterpart: thread?.participants?.[0]?.email ?? "",
                expected_by: f.expected_by,
                days_overdue: Math.max(0, Math.floor((Date.now() - Date.parse(f.expected_by)) / 86_400_000)),
              };
            }),
        };
      }

      // ---------- Etappe 4 ----------
      case "transcribe_note": {
        const note = db.notes.find((n) => n.id === job.payload?.note_id);
        if (!note) return null;
        return {
          jobId: job.id, jobType: "transcribe_note", locale: "de-DE",
          note_id: note.id, audio_storage_path: String(job.payload?.audio_storage_path ?? ""),
        };
      }
      case "transcribe_meeting": {
        const meeting = db.meetings.find((m) => m.id === job.payload?.meeting_id);
        if (!meeting || !meeting.audio_storage_path) return null;
        return {
          jobId: job.id, jobType: "transcribe_meeting", locale: "de-DE",
          meeting_id: meeting.id, title: meeting.title ?? "",
          audio_storage_path: meeting.audio_storage_path,
        };
      }
      case "summarize_meeting": {
        const meeting = db.meetings.find((m) => m.id === job.payload?.meeting_id);
        if (!meeting || !meeting.transcript) return null;
        const kase = db.cases.find((c) => c.id === meeting.case_id);
        return {
          jobId: job.id, jobType: "summarize_meeting", locale: "de-DE",
          today: now().slice(0, 10),
          meeting: {
            meeting_id: meeting.id, title: meeting.title ?? "", held_at: meeting.held_at,
            case_number: kase?.case_number ?? null,
            transcript_excerpt: (meeting.transcript ?? "").slice(0, 12000),
          },
        };
      }
      case "knowledge_distill": {
        const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const sources = [
          ...db.mail_messages
            .filter((m) => m.org_id === job.org_id && m.direction === "inbound" && m.created_at >= since)
            .slice(0, 20)
            .map((m) => ({
              source_type: "mail_message", source_id: m.id, title: m.subject ?? "",
              excerpt: (m.body_text ?? "").slice(0, 800), counterpart: m.from_addr?.email ?? "",
            })),
          ...db.meetings
            .filter((m) => m.org_id === job.org_id && m.protocol_md)
            .slice(0, 10)
            .map((m) => ({
              source_type: "meeting", source_id: m.id, title: m.title ?? "",
              excerpt: (m.protocol_md ?? "").slice(0, 800), counterpart: "",
            })),
        ].slice(0, 40);
        return {
          jobId: job.id, jobType: "knowledge_distill", locale: "de-DE",
          today: now().slice(0, 10),
          sources,
          known_facts: db.knowledge_items
            .filter((k) => k.org_id === job.org_id && k.status !== "rejected")
            .map((k) => k.fact),
        };
      }
      case "build_style_profile": {
        const account = db.mail_accounts.find((a) => a.id === job.payload?.account_id);
        if (!account) return null;
        return {
          jobId: job.id, jobType: "build_style_profile", locale: "de-DE",
          account_id: account.id,
          sent_samples: db.mail_messages
            .filter((m) => m.account_id === account.id && m.direction === "outbound")
            .slice(-20)
            .map((m) => (m.body_text ?? "").slice(0, 600))
            .filter((s) => s.length > 40),
        };
      }
      case "embed_backlog": {
        const done = new Set(db.embeddings.filter((e) => e.org_id === job.org_id).map((e) => `${e.entity_type}:${e.entity_id}`));
        const pending = [];
        const push = (type, id, content) => {
          if (pending.length >= 64 || !content?.trim() || done.has(`${type}:${id}`)) return;
          pending.push({ entity_type: type, entity_id: id, chunk_index: 0, content: content.slice(0, 2000) });
        };
        for (const m of db.mail_messages.filter((x) => x.org_id === job.org_id).slice(-40)) {
          push("mail_message", m.id, `${m.subject ?? ""}\n${m.body_text ?? ""}`);
        }
        for (const n of db.notes.filter((x) => x.org_id === job.org_id)) push("note", n.id, `${n.title ?? ""}\n${n.body_md ?? ""}`);
        for (const k of db.knowledge_items.filter((x) => x.org_id === job.org_id && x.status !== "rejected")) push("knowledge_item", k.id, k.fact);
        for (const s of db.meeting_segments.filter((x) => x.org_id === job.org_id)) push("meeting_segment", s.id, s.content);
        return { jobId: job.id, jobType: "embed_backlog", locale: "de-DE", pending };
      }
      case "semantic_search":
        return {
          jobId: job.id, jobType: "semantic_search", locale: "de-DE",
          query: String(job.payload?.query ?? "").slice(0, 500),
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
    if (fn === "next_number") {
      const range = db.number_ranges.find(
        (r) => r.org_id === body.p_org && r.kind === body.p_kind,
      );
      if (!range) return [400, { message: `Kein Nummernkreis für ${body.p_kind}` }];
      const value = range.next_value++;
      persist();
      return [200, `${range.prefix}${String(value).padStart(range.padding ?? 4, "0")}`];
    }
    if (fn === "record_automation_outcome") {
      const run = db.automation_runs.find((r) => r.id === body.p_run_id);
      if (!run) return [400, { message: "automation_run nicht gefunden" }];
      Object.assign(run, { outcome: body.p_outcome, outcome_by: user?.id ?? null, outcome_at: now() });
      // trust_stats neu berechnen (Spiegel von Migration 018)
      const runs = db.automation_runs.filter(
        (r) => r.automation_id === run.automation_id && r.outcome,
      );
      const last50 = [...runs]
        .sort((a, b) => (a.outcome_at > b.outcome_at ? -1 : 1))
        .slice(0, 50);
      const stats = {
        automation_id: run.automation_id,
        org_id: run.org_id,
        total_runs: runs.length,
        correct_runs: runs.filter((r) => r.outcome === "correct").length,
        last_50_correct: last50.filter((r) => r.outcome === "correct").length,
        last_50_total: last50.length,
        accuracy: runs.length ? runs.filter((r) => r.outcome === "correct").length / runs.length : null,
        updated_at: now(),
      };
      const existing = db.trust_stats.find((s) => s.automation_id === run.automation_id);
      if (existing) Object.assign(existing, stats);
      else db.trust_stats.push(stats);
      persist();
      return [204, null];
    }

    // ---------- Etappe 4 ----------
    if (fn === "set_autonomy_level") {
      const auto = db.automations.find((a) => a.id === body.p_automation);
      if (!auto) return [400, { message: "Automation nicht gefunden" }];
      const level = Number(body.p_level);
      if (level < 1 || level > 4) return [400, { message: "Ungültige Stufe" }];
      // Hochstufen-Gate (Spiegel von set_autonomy_level, Migration 021)
      if (level >= 3 && level > auto.autonomy_level) {
        const stats = db.trust_stats.find((s) => s.automation_id === auto.id);
        const total = stats?.last_50_total ?? 0;
        const quote = total === 0 ? 0 : (stats?.last_50_correct ?? 0) / total;
        if (total < auto.promote_min_runs || quote < auto.promote_threshold) {
          return [400, {
            code: "P0004",
            message: `Hochstufung erst ab ${Math.round(auto.promote_threshold * 100)} % Trefferquote über mindestens ` +
              `${auto.promote_min_runs} Läufe (aktuell: ${Math.round(quote * 100)} % über ${total} Läufe)`,
          }];
        }
      }
      auto.autonomy_level = level;
      auto.updated_at = now();
      db.audit_log.push({
        id: db.audit_log.length + 1, org_id: auto.org_id, actor_type: "user",
        actor_id: user?.id ?? null, action: "automation.level_changed",
        entity_type: "automation", entity_id: auto.id,
        detail: { level, key: auto.key }, created_at: now(),
      });
      persist();
      return [200, auto];
    }

    if (fn === "stop_automation_run") {
      const run = db.automation_runs.find((r) => r.id === body.p_run);
      if (!run) return [400, { message: "Lauf nicht gefunden" }];
      if (run.status !== "holding") return [400, { message: "Lauf ist nicht in der Halte-Zone" }];
      run.status = "stopped";
      run.decided_by = user?.id ?? null;
      const draftId = run.detail?.draft_id ?? null;
      if (draftId) {
        const draft = db.mail_drafts.find((d) => d.id === draftId);
        if (draft && draft.status === "scheduled") {
          Object.assign(draft, { status: "draft", send_after: null, updated_at: now() });
        }
      }
      if (run.entity_type === "dunning_run") {
        const dunning = db.dunning_runs.find((d) => d.id === run.entity_id && d.status === "approved");
        if (dunning) dunning.status = "proposed";
      }
      // Stopp = Korrektur → speist Trefferquote
      const outcomeResult = rpc("record_automation_outcome",
        { p_run_id: run.id, p_outcome: "corrected" }, user);
      if (outcomeResult && outcomeResult[0] >= 400) return outcomeResult;
      db.audit_log.push({
        id: db.audit_log.length + 1, org_id: run.org_id, actor_type: "user",
        actor_id: user?.id ?? null, action: "automation.stopped",
        entity_type: run.entity_type, entity_id: run.entity_id,
        detail: run.detail ?? {}, created_at: now(),
      });
      persist();
      return [204, null];
    }

    if (fn === "search_combined") {
      const orgId = body.p_org;
      const q = String(body.p_query ?? "").trim().toLowerCase();
      if (!q) return [200, []];
      const hit = (text) => (text ?? "").toLowerCase().includes(q);
      const results = [];
      for (const m of db.mail_messages.filter((x) => x.org_id === orgId)) {
        if (hit(m.subject) || hit(m.body_text)) {
          results.push({ entity_type: "mail_message", entity_id: m.id,
            title: m.subject || "(ohne Betreff)", snippet: (m.body_text ?? "").slice(0, 160),
            rank: 0.6, via: "volltext" });
        }
      }
      for (const c of db.cases.filter((x) => x.org_id === orgId && !x.deleted_at)) {
        if (hit(c.title) || hit(c.case_number)) {
          results.push({ entity_type: "case", entity_id: c.id, title: c.title,
            snippet: c.case_number ?? "", rank: 0.5, via: "volltext" });
        }
      }
      for (const n of db.notes.filter((x) => x.org_id === orgId)) {
        if (hit(n.title) || hit(n.body_md)) {
          results.push({ entity_type: "note", entity_id: n.id, title: n.title || "Notiz",
            snippet: (n.body_md ?? "").slice(0, 160), rank: 0.4, via: "volltext" });
        }
      }
      for (const k of db.knowledge_items.filter((x) => x.org_id === orgId && x.status !== "rejected")) {
        if (hit(k.fact)) {
          results.push({ entity_type: "knowledge_item", entity_id: k.id, title: k.fact,
            snippet: k.category ?? "", rank: 0.4, via: "volltext" });
        }
      }
      // Semantisch: Query-Vektor aus dem semantic_search-Job (falls vorhanden)
      const seen = new Set(results.map((r) => r.entity_id));
      if (body.p_embedding_job) {
        const job = db.agent_jobs.find(
          (j) => j.id === body.p_embedding_job && j.org_id === orgId &&
            j.job_type === "semantic_search" && j.status === "done" && j.result?.embedding,
        );
        const vec = job?.result?.embedding;
        if (Array.isArray(vec)) {
          const cos = (a) => {
            let dot = 0, na = 0, nb = 0;
            for (let i = 0; i < a.length; i += 1) { dot += a[i] * (vec[i] ?? 0); na += a[i] * a[i]; nb += (vec[i] ?? 0) ** 2; }
            return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
          };
          db.embeddings
            .filter((e) => e.org_id === orgId && !seen.has(e.entity_id))
            .map((e) => ({ e, sim: cos(e.embedding) }))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 12)
            .forEach(({ e, sim }) => results.push({
              entity_type: e.entity_type, entity_id: e.entity_id,
              title: (e.content ?? "").slice(0, 80), snippet: (e.content ?? "").slice(0, 160),
              rank: sim, via: "semantisch",
            }));
        }
      }
      results.sort((a, b) => b.rank - a.rank);
      return [200, results.slice(0, 20)];
    }

    return null;
  }

  // ---------- Cron-Ersatz: Sync alle 30 s + Wächter/Briefing/Follow-ups ----------
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

    // Etappe 2: Watchdog-Jobs pro Org (im Mock aggressiv statt nachts,
    // damit die Demo sofort etwas zeigt; Dedupe passiert in der Anwendung)
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    for (const org of db.orgs) {
      const hasRunner = db.runners.some(
        (r) => r.org_id === org.id && !["disabled", "pending_approval"].includes(r.status),
      );
      const hasMail = db.mail_threads.some((t) => t.org_id === org.id);
      if (!hasRunner || !hasMail) continue;
      // Prioritäten wie im echten Cron (009/019): Briefing 6, Follow-ups 7,
      // Wächter 8 (Nacht-Batch → respektiert das Nachtfenster)
      for (const [jobType, priority] of [
        ["morning_briefing", 6],
        ["followup_check", 7],
        ["gap_scan", 8],
        // Etappe 4: Wissen destillieren + Embeddings nachziehen (Nacht-Batch)
        ["knowledge_distill", 9],
        ["embed_backlog", 9],
      ]) {
        const recent = db.agent_jobs.some(
          (j) => j.org_id === org.id && j.job_type === jobType &&
            (["queued", "claimed", "running"].includes(j.status) || j.created_at > fiveMinAgo),
        );
        if (!recent) pushJob(org.id, jobType, { scope: "org" }, priority);
      }

      // Etappe 4: Stil-Profil pro Konto (build_style_profile)
      for (const account of db.mail_accounts.filter((a) => a.org_id === org.id)) {
        const hasSent = db.mail_messages.some(
          (m) => m.account_id === account.id && m.direction === "outbound",
        );
        const recent = db.agent_jobs.some(
          (j) => j.org_id === org.id && j.job_type === "build_style_profile" &&
            j.payload?.account_id === account.id &&
            (["queued", "claimed", "running"].includes(j.status) || j.created_at > fiveMinAgo),
        );
        if (hasSent && !recent) pushJob(org.id, "build_style_profile", { account_id: account.id }, 9);
      }

      // Etappe 3: Mahnvorschläge für überfällige Rechnungen (Spiegel von
      // process_overdue_invoices aus Migration 020)
      if (db.automations.some(
        (a) => a.org_id === org.id && a.key === "auto_dunning" && a.is_enabled !== false,
      )) {
        const today = now().slice(0, 10);
        for (const invoice of db.invoices_out.filter(
          (i) => i.org_id === org.id && ["sent", "overdue", "partially_paid"].includes(i.status) &&
            i.due_date && i.due_date < today,
        )) {
          if (invoice.status === "sent") invoice.status = "overdue";
          const level = Math.max(0, ...db.dunning_runs
            .filter((d) => d.invoice_id === invoice.id && ["approved", "sent"].includes(d.status))
            .map((d) => d.level)) + 1;
          if (level > 3) continue;
          if (db.dunning_runs.some((d) => d.invoice_id === invoice.id &&
            (d.status === "proposed" || d.level >= level))) continue;
          const profile = db.org_profile.find((p) => p.org_id === org.id);
          db.dunning_runs.push({
            id: randomUUID(), org_id: org.id, invoice_id: invoice.id, level,
            draft_id: null, fee: Number(profile?.dunning_fees?.[String(level)] ?? 0),
            status: "proposed", proposed_by: "ai", sent_at: null, created_at: now(),
          });
          pushJob(org.id, "draft_dunning", { invoice_id: invoice.id, level }, 7);
          for (const member of db.org_members.filter((m) => m.org_id === org.id && m.is_active)) {
            db.notifications.push({
              id: randomUUID(), org_id: org.id, user_id: member.user_id,
              kind: "dunning_proposed",
              title: `Mahnvorschlag: Rechnung ${invoice.invoice_number} (Stufe ${level})`,
              body: null, entity_type: "invoice_out", entity_id: invoice.id,
              read_at: null, pushed_at: null, created_at: now(),
            });
          }
        }
      }
    }
    persist();
  }

  // ---------- export-xrechnung (vereinfachtes Mock-XML) ----------
  function handleExportXrechnung(_req, _url, body, user) {
    if (!user) return [401, { error: "Nicht angemeldet" }];
    const invoice = db.invoices_out.find((i) => i.id === body.invoiceId);
    if (!invoice) return [404, { error: "Rechnung nicht gefunden" }];
    if (body.isB2G === true && !invoice.buyer_reference) {
      return [422, {
        error: "Für Rechnungen an öffentliche Auftraggeber (B2G) ist die Leitweg-ID (Käuferreferenz) Pflicht.",
        code: "buyer_reference_required",
      }];
    }
    const items = db.invoice_items.filter((i) => i.invoice_id === invoice.id);
    if (items.length === 0) return [422, { error: "Rechnung hat keine Positionen" }];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Mock-XRechnung (lokale Demo) -->\n<Invoice><ID>${invoice.invoice_number}</ID><PayableAmount currencyID="EUR">${invoice.gross_amount.toFixed(2)}</PayableAmount></Invoice>\n`;
    const path = `org/${invoice.org_id}/xrechnung/${invoice.invoice_number}.xml`;
    invoice.xml_storage_path = path;
    persist();
    return [200, { ok: true, xmlStoragePath: path, xml }];
  }

  return {
    handleGmailApi,
    handleOauthGmail,
    handleMailSync,
    handleSendMail,
    handleExportXrechnung,
    buildContext,
    applyJobResult,
    rpc,
    enqueueSyncJobs,
  };
}
