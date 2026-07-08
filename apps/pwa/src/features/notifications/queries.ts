import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationRow } from "@leitwerk/shared";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export function useNotifications() {
  const userId = useSessionStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ["notifications", userId],
    enabled: !!userId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationRow[];
    },
  });
}

export function useMarkNotificationsRead() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
  });
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type PushState = "unsupported" | "denied" | "off" | "on";

export function getPushState(): PushState {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "off"; // tatsächlicher Zustand wird nach Subscription-Check gesetzt
}

/** Web-Push abonnieren: Permission → PushManager → push_subscriptions. */
export function useSubscribePush() {
  const userId = useSessionStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (): Promise<PushState> => {
      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      if (!vapidKey) throw new Error("VITE_VAPID_PUBLIC_KEY ist nicht konfiguriert.");
      if (getPushState() === "unsupported") {
        throw new Error("Dieser Browser unterstützt keine Web-Push-Benachrichtigungen.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return "denied";

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = subscription.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          user_agent: navigator.userAgent.slice(0, 200),
        },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);
      return "on";
    },
  });
}
