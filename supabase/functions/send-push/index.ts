// send-push — stellt ungepushte Benachrichtigungen als Web-Push zu (Etappe 2).
// Aufruf per pg_cron + pg_net mit Service-Role-Key: {mode:'due'}.
// VAPID-Schlüssel kommen aus den Function-Secrets (Betreiber, tutorials/04).
import webpush from "npm:web-push@3";
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function targetUrl(n: NotificationRow): string {
  switch (n.entity_type) {
    case "mail_thread":
    case "mail_message":
      return "/posteingang";
    case "task":
      return "/aufgaben";
    case "agent_finding":
    case "briefing":
      return "/";
    case "case":
      return `/vorgaenge/${n.entity_id ?? ""}`;
    default:
      return "/";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (auth !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return json({ error: "Nur mit Service-Role-Key aufrufbar" }, 403);
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    return json({ error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY sind nicht gesetzt" }, 500);
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const db = serviceClient();
  try {
    // Ungepushte Benachrichtigungen der letzten Stunde (älteres verfällt still)
    const { data: pending } = await db
      .from("notifications")
      .select("id, user_id, kind, title, body, entity_type, entity_id")
      .is("pushed_at", null)
      .gt("created_at", new Date(Date.now() - 60 * 60_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(100);
    const notifications = (pending ?? []) as NotificationRow[];
    if (notifications.length === 0) return json({ sent: 0 });

    const userIds = [...new Set(notifications.map((n) => n.user_id))];
    const { data: subs } = await db
      .from("push_subscriptions")
      .select("id, user_id, endpoint, keys")
      .in("user_id", userIds);
    const byUser = new Map<string, SubscriptionRow[]>();
    for (const sub of (subs ?? []) as SubscriptionRow[]) {
      byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);
    }

    let sent = 0;
    const deadSubscriptions: string[] = [];
    for (const notification of notifications) {
      for (const sub of byUser.get(notification.user_id) ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: notification.title,
              body: notification.body ?? "",
              url: targetUrl(notification),
              kind: notification.kind,
            }),
          );
          sent += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // 404/410 = Subscription tot → aufräumen
          if (status === 404 || status === 410) deadSubscriptions.push(sub.id);
        }
      }
    }

    await db
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", notifications.map((n) => n.id));
    if (deadSubscriptions.length > 0) {
      await db.from("push_subscriptions").delete().in("id", deadSubscriptions);
    }

    return json({ sent, processed: notifications.length, removed: deadSubscriptions.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
