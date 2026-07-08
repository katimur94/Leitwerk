import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mail } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SkeletonRows,
  cn,
} from "@leitwerk/ui";
import type {
  NumberRangeRow,
  OrgProfileOnboarding,
  OrgProfileRow,
} from "@leitwerk/shared";
import { PairingPanel } from "../features/runner/PairingPanel";
import { RunnerList } from "../features/runner/RunnerList";
import { useRunners } from "../features/runner/queries";
import { t } from "../i18n/de";
import { supabase } from "../lib/supabase";
import { refreshSessionContext } from "../providers/AuthProvider";
import { useSessionStore } from "../stores/session";

// ---------- Daten ----------

function useOrgProfile(orgId: string | undefined) {
  return useQuery({
    queryKey: ["org_profile", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_profile")
        .select("*")
        .eq("org_id", orgId!)
        .single();
      if (error) throw new Error(error.message);
      return data as OrgProfileRow;
    },
  });
}

function useUpdateOnboarding(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      current,
      patch,
    }: {
      current: OrgProfileOnboarding;
      patch: Partial<OrgProfileOnboarding>;
    }) => {
      if (!orgId) throw new Error("Keine aktive Organisation");
      const { error } = await supabase
        .from("org_profile")
        .update({ onboarding: { ...current, ...patch } })
        .eq("org_id", orgId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["org_profile", orgId] }),
  });
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "org"}-${suffix}`;
}

// ---------- Schritt 0: Organisation anlegen ----------

function CreateOrgStep() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setPending(true);
    setError(null);
    const { data: org, error: insertError } = await supabase
      .from("orgs")
      .insert({ name: name.trim(), slug: slugify(name), created_by: userId })
      .select("id")
      .single();
    if (insertError || !org) {
      setPending(false);
      setError(insertError?.message ?? "Organisation konnte nicht angelegt werden.");
      return;
    }
    await supabase
      .from("profiles")
      .update({ active_org_id: org.id })
      .eq("id", userId);
    await refreshSessionContext();
    setPending(false);
  }

  return (
    <Card className="w-full max-w-[440px] p-8">
      <h2 className="text-[20px] font-semibold text-lw-ink">
        {t("onboarding.createOrg.title")}
      </h2>
      <p className="mt-1 text-[13px] text-lw-ink-soft">
        Deine Organisation ist der gemeinsame Arbeitsbereich — Mails, Vorgänge
        und Rechnungen gehören immer genau einer Organisation.
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <Field label={t("onboarding.createOrg.name")} htmlFor="org-name">
          <Input
            id="org-name"
            required
            minLength={2}
            placeholder="z. B. Muster GmbH"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {error ? <p className="text-[13px] text-lw-danger">{error}</p> : null}
        <Button type="submit" disabled={pending || name.trim().length < 2}>
          {pending ? t("common.loading") : t("onboarding.createOrg.submit")}
        </Button>
      </form>
    </Card>
  );
}

// ---------- Schritt 1: Firmen-Stammdaten ----------

function CompanyStep({
  profile,
  onDone,
}: {
  profile: OrgProfileRow;
  onDone: () => void;
}) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    legal_name: profile.legal_name ?? "",
    legal_form: profile.legal_form ?? "",
    owner_name: profile.owner_name ?? "",
    street: profile.street ?? "",
    zip: profile.zip ?? "",
    city: profile.city ?? "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    vat_id: profile.vat_id ?? "",
    tax_number: profile.tax_number ?? "",
    bank_name: profile.bank_name ?? "",
    iban: profile.iban ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setPending(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("org_profile")
      .update({
        ...form,
        onboarding: { ...profile.onboarding, company_done: true },
      })
      .eq("org_id", orgId);
    setPending(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["org_profile", orgId] });
    onDone();
  }

  const fields: Array<{ key: keyof typeof form; label: string; span2?: boolean }> = [
    { key: "legal_name", label: "Firmenname", span2: true },
    { key: "legal_form", label: "Rechtsform (GmbH, e.K., …)" },
    { key: "owner_name", label: "Inhaber / Geschäftsführung" },
    { key: "street", label: "Straße und Hausnummer", span2: true },
    { key: "zip", label: "PLZ" },
    { key: "city", label: "Ort" },
    { key: "phone", label: "Telefon" },
    { key: "email", label: "E-Mail (geschäftlich)" },
    { key: "vat_id", label: "USt-IdNr." },
    { key: "tax_number", label: "Steuernummer" },
    { key: "bank_name", label: "Bank" },
    { key: "iban", label: "IBAN" },
  ];

  return (
    <form onSubmit={onSubmit}>
      <p className="text-[13px] text-lw-ink-soft">{t("onboarding.company.hint")}</p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className={cn(field.span2 && "sm:col-span-2")}>
            <Field label={field.label} htmlFor={`company-${field.key}`}>
              <Input
                id={`company-${field.key}`}
                required={field.key === "legal_name"}
                value={form[field.key]}
                onChange={(e) => update(field.key, e.target.value)}
              />
            </Field>
          </div>
        ))}
      </div>
      {error ? <p className="mt-3 text-[13px] text-lw-danger">{error}</p> : null}
      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t("common.loading") : t("common.next")}
        </Button>
      </div>
    </form>
  );
}

// ---------- Schritt 2: Postfach (Platzhalter) ----------

function MailStep({ onDone }: { onDone: () => void }) {
  return (
    <div>
      <EmptyState
        icon={<Mail />}
        title={t("onboarding.mail.title")}
        description={t("onboarding.mail.hint")}
        className="py-8"
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled>
          Gmail verbinden (Phase 1)
        </Button>
        <Button onClick={onDone}>{t("common.skip")}</Button>
      </div>
    </div>
  );
}

// ---------- Schritt 3: Runner-Pairing ----------

function RunnerStep({
  profile,
  onDone,
}: {
  profile: OrgProfileRow;
  onDone: () => void;
}) {
  const runners = useRunners();
  const updateOnboarding = useUpdateOnboarding(
    useSessionStore((s) => s.activeOrg?.id),
  );
  const hasRunner = (runners.data?.length ?? 0) > 0;

  // Sobald der erste Runner gepairt ist: Flag setzen (Feedback in DB)
  useEffect(() => {
    if (hasRunner && !profile.onboarding.runner_paired) {
      updateOnboarding.mutate({
        current: profile.onboarding,
        patch: { runner_paired: true },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRunner]);

  return (
    <div className="flex flex-col gap-4">
      <RunnerList />
      <PairingPanel />
      <div className="flex justify-end gap-2">
        {!hasRunner ? (
          <Button variant="secondary" onClick={onDone}>
            {t("common.skip")}
          </Button>
        ) : null}
        <Button onClick={onDone} disabled={!hasRunner}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------- Schritt 4: Nummernkreise ----------

const rangeLabels: Record<string, string> = {
  case: "Vorgänge",
  quote: "Angebote",
  invoice: "Rechnungen",
  dunning: "Mahnungen",
};

function NumberRangesStep({
  profile,
  onDone,
}: {
  profile: OrgProfileRow;
  onDone: () => void;
}) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const updateOnboarding = useUpdateOnboarding(orgId);
  const ranges = useQuery({
    queryKey: ["number_ranges", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("number_ranges")
        .select("*")
        .eq("org_id", orgId!)
        .order("kind");
      if (error) throw new Error(error.message);
      return (data ?? []) as NumberRangeRow[];
    },
  });

  function confirm() {
    updateOnboarding.mutate(
      { current: profile.onboarding, patch: { number_ranges_done: true } },
      { onSuccess: onDone },
    );
  }

  return (
    <div>
      <p className="text-[13px] text-lw-ink-soft">
        {t("onboarding.numberRanges.hint")}
      </p>
      <div className="mt-4">
        {ranges.isPending ? (
          <SkeletonRows rows={4} />
        ) : ranges.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({ranges.error.message})
            </p>
            <Button variant="secondary" size="sm" onClick={() => ranges.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-lw-border rounded-[var(--lw-radius-md)] border border-lw-border">
            {ranges.data.map((range) => (
              <li
                key={range.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <span className="text-[14px] text-lw-ink">
                  {rangeLabels[range.kind] ?? range.kind}
                </span>
                <span className="font-mono text-[13px] text-lw-ink-soft tnum">
                  {range.prefix}
                  {String(range.next_value).padStart(range.padding, "0")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={confirm} disabled={updateOnboarding.isPending || !ranges.isSuccess}>
          {updateOnboarding.isPending ? t("common.loading") : t("common.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------- Schritt 5: Fertig ----------

function DoneStep() {
  const navigate = useNavigate();
  return (
    <div>
      <EmptyState
        icon={<CheckCircle2 />}
        title={t("onboarding.done.title")}
        description={t("onboarding.done.hint")}
        className="py-8"
      />
      <div className="flex justify-end">
        <Button onClick={() => navigate("/")}>{t("onboarding.done.cta")}</Button>
      </div>
    </div>
  );
}

// ---------- Wizard-Container ----------

const stepTitles = [
  "onboarding.company.title",
  "onboarding.mail.title",
  "onboarding.runner.title",
  "onboarding.numberRanges.title",
  "onboarding.done.title",
] as const;

function firstIncompleteStep(onboarding: OrgProfileOnboarding): number {
  if (!onboarding.company_done) return 0;
  if (!onboarding.mail_connected) return 1;
  if (!onboarding.runner_paired) return 2;
  if (!onboarding.number_ranges_done) return 3;
  return 4;
}

export function Onboarding() {
  const activeOrg = useSessionStore((s) => s.activeOrg);
  const profileQuery = useOrgProfile(activeOrg?.id);
  const [step, setStep] = useState<number | null>(null);

  // Initialen Schritt einmalig aus den Onboarding-Flags ableiten
  const initialStep = useMemo(
    () =>
      profileQuery.data
        ? firstIncompleteStep(profileQuery.data.onboarding)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileQuery.isSuccess],
  );
  const currentStep = step ?? initialStep ?? 0;

  if (!activeOrg) {
    return (
      <div className="flex min-h-full items-center justify-center bg-lw-bg px-4 py-12">
        <CreateOrgStep />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-lw-bg px-4 py-12">
      <div className="mx-auto w-full max-w-[640px]">
        <header className="mb-6 flex items-center gap-3">
          <img src="/logo.svg" alt="" className="h-9 w-9 rounded-[10px]" />
          <div>
            <h1 className="text-[20px] font-semibold text-lw-ink">
              {t("onboarding.title")}
            </h1>
            <p className="text-[13px] text-lw-ink-soft">{activeOrg.name}</p>
          </div>
        </header>

        {/* Schritt-Anzeige */}
        <ol className="mb-6 flex items-center gap-2">
          {stepTitles.map((titleKey, index) => (
            <li key={titleKey} className="flex items-center gap-2">
              <button
                onClick={() => index < currentStep && setStep(index)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium transition-colors",
                  index === currentStep
                    ? "bg-lw-brand text-white"
                    : index < currentStep
                      ? "bg-lw-surface-2 text-lw-ink cursor-pointer"
                      : "bg-lw-surface-2 text-lw-ink-faint",
                )}
              >
                {index + 1}
              </button>
              {index < stepTitles.length - 1 ? (
                <span className="h-px w-6 bg-lw-border-strong" />
              ) : null}
            </li>
          ))}
        </ol>

        <Card className="p-8">
          <h2 className="mb-4 text-[16px] font-semibold text-lw-ink">
            {t(stepTitles[currentStep] ?? stepTitles[0])}
          </h2>

          {profileQuery.isPending ? (
            <SkeletonRows rows={4} />
          ) : profileQuery.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-lw-danger">
                {t("common.error")} ({profileQuery.error.message})
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => profileQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : currentStep === 0 ? (
            <CompanyStep profile={profileQuery.data} onDone={() => setStep(1)} />
          ) : currentStep === 1 ? (
            <MailStep onDone={() => setStep(2)} />
          ) : currentStep === 2 ? (
            <RunnerStep profile={profileQuery.data} onDone={() => setStep(3)} />
          ) : currentStep === 3 ? (
            <NumberRangesStep
              profile={profileQuery.data}
              onDone={() => setStep(4)}
            />
          ) : (
            <DoneStep />
          )}
        </Card>
      </div>
    </div>
  );
}
