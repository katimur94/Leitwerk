// Google-Calendar-Anbindung für den Sync-Connector (Etappe 5).
// Reine Normalisierung (testbar) + dünner API-Client. Der Runner spricht
// Google NUR mit dem kurzlebigen Access-Token an, das die Edge Function
// calendar-sync aus dem Vault-Refresh-Token erzeugt (wie bei Gmail).
const GCAL_BASE =
  process.env.LEITWERK_GCAL_API_URL ??
  "https://www.googleapis.com/calendar/v3/calendars";

export interface GcalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
}

/** Normalisiertes Event für /ingest (Edge Function calendar-sync). */
export interface IngestEvent {
  provider_event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  attendees: Array<{ name?: string; email: string }>;
  status: "confirmed" | "tentative" | "cancelled";
}

/** Google-Event → Ingest-Form (namespace-agnostisch, all-day-fähig). */
export function normalizeGcalEvent(event: GcalEvent): IngestEvent | null {
  const startsAt = event.start?.dateTime ?? event.start?.date;
  const endsAt = event.end?.dateTime ?? event.end?.date ?? startsAt;
  if (!event.id || !startsAt) return null;
  const allDay = !event.start?.dateTime;
  const status: IngestEvent["status"] =
    event.status === "cancelled"
      ? "cancelled"
      : event.status === "tentative"
        ? "tentative"
        : "confirmed";
  return {
    provider_event_id: event.id,
    title: event.summary ?? "(ohne Titel)",
    description: event.description ?? null,
    location: event.location ?? null,
    starts_at: allDay ? `${startsAt}T00:00:00Z` : startsAt,
    ends_at: allDay ? `${endsAt}T00:00:00Z` : (endsAt as string),
    all_day: allDay,
    attendees: (event.attendees ?? [])
      .filter((a) => a.email)
      .map((a) => ({ name: a.displayName, email: a.email as string })),
    status,
  };
}

export class GcalApi {
  constructor(
    private readonly accessToken: string,
    private readonly calendarRef: string,
  ) {}

  private async get<T>(path: string, params: URLSearchParams): Promise<T> {
    const ref = encodeURIComponent(this.calendarRef);
    const res = await fetch(`${GCAL_BASE}/${ref}${path}?${params}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = new Error(`Calendar API ${path} → HTTP ${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  /** Events auflisten: initial per timeMin, Delta per syncToken. */
  listEvents(opts: { syncToken?: string | null; timeMin?: string; pageToken?: string }): Promise<{
    items?: GcalEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
  }> {
    const params = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
    if (opts.syncToken) params.set("syncToken", opts.syncToken);
    else if (opts.timeMin) params.set("timeMin", opts.timeMin);
    if (opts.pageToken) params.set("pageToken", opts.pageToken);
    return this.get("/events", params);
  }
}
