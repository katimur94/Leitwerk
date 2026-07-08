import type { BadgeTone } from "@leitwerk/ui";

/** Deutsche Labels + Badge-Töne für mail_threads.category. */
export const CATEGORY_META: Record<string, { label: string; tone: BadgeTone }> = {
  anfrage: { label: "Anfrage", tone: "success" },
  auftrag: { label: "Auftrag", tone: "success" },
  rechnung: { label: "Rechnung", tone: "warning" },
  termin: { label: "Termin", tone: "neutral" },
  mahnung: { label: "Mahnung", tone: "danger" },
  newsletter: { label: "Newsletter", tone: "neutral" },
  spam_verdacht: { label: "Spam-Verdacht", tone: "danger" },
  sonstiges: { label: "Sonstiges", tone: "neutral" },
};

export function categoryLabel(category: string | null): string {
  return category ? (CATEGORY_META[category]?.label ?? category) : "—";
}
