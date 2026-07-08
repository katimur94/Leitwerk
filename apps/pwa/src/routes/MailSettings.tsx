import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MailAccountRow } from "@leitwerk/shared";
import { Badge, Button, Card, EmptyState, SkeletonRows, StatusDot } from "@leitwerk/ui";
import { useConnectGmail, useMailAccounts } from "../features/mail/queries";
import { t } from "../i18n/de";
import { formatAgo } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useSessionStore } from "../stores/session";

const SYNC_META: Record<
  MailAccountRow["sync_state"],
  { labelKey: string; dot: "online" | "offline" | "busy" | "disabled" }
> = {
  pending: { labelKey: "mail.sync.pending", dot: "busy" },
  syncing: { labelKey: "mail.sync.syncing", dot: "busy" },
  ok: { labelKey: "mail.sync.ok", dot: "online" },
  error: { labelKey: "mail.sync.error", dot: "disabled" },
  revoked: { labelKey: "mail.sync.revoked", dot: "disabled" },
};

function SignatureEditor({ account }: { account: MailAccountRow }) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  const [value, setValue] = useState(account.signature_html ?? "");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("mail_accounts")
        .update({ signature_html: value || null })
        .eq("id", account.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["mail_accounts", orgId] });
    },
  });

  return (
    <div className="mt-3 flex flex-col gap-2">
      <label className="text-[13px] font-medium text-lw-ink" htmlFor={`sig-${account.id}`}>
        {t("mail.signature")}
      </label>
      <textarea
        id={`sig-${account.id}`}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        rows={4}
        placeholder="<p>Mit freundlichen Grüßen<br>…</p>"
        className="w-full rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface px-3 py-2 font-mono text-[12px] text-lw-ink focus:outline-none focus:ring-2 focus:ring-lw-accent"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
        {save.isError ? (
          <span className="text-[12px] text-lw-danger">{save.error.message}</span>
        ) : saved ? (
          <span className="text-[12px]" style={{ color: "var(--lw-success)" }}>
            {t("mail.signatureSaved")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function MailSettings() {
  const accounts = useMailAccounts();
  const connect = useConnectGmail();
  const [params, setParams] = useSearchParams();
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // OAuth-Redirect-Ergebnis (?connected= / ?error=) einmalig anzeigen
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      setBanner({ kind: "ok", text: t("mail.connectedBanner").replace("{email}", connected) });
    } else if (error) {
      setBanner({ kind: "error", text: t("mail.connectError").replace("{error}", error) });
    }
    if (connected || error) setParams({}, { replace: true });
  }, [params, setParams]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("mail.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("mail.subtitle")}</p>
      </header>

      {banner ? (
        <div
          className="rounded-[var(--lw-radius-md)] border px-4 py-3 text-[13px]"
          style={{
            borderColor: `color-mix(in srgb, var(--lw-${banner.kind === "ok" ? "success" : "danger"}) 35%, transparent)`,
            color: `var(--lw-${banner.kind === "ok" ? "success" : "danger"})`,
          }}
        >
          {banner.text}
        </div>
      ) : null}

      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-lw-ink">{t("mail.accounts")}</h3>
          <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
            {t("mail.connectGmail")}
          </Button>
        </div>
        {connect.isError ? (
          <p className="mt-2 text-[12px] text-lw-danger">{connect.error.message}</p>
        ) : null}

        <div className="mt-4">
          {accounts.isPending ? (
            <SkeletonRows rows={2} />
          ) : accounts.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-lw-danger">
                {t("common.error")} ({accounts.error.message})
              </p>
              <Button size="sm" variant="secondary" onClick={() => accounts.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (accounts.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Mail />}
              title={t("mail.empty.title")}
              description={t("mail.empty.description")}
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-lw-border">
              {(accounts.data ?? []).map((account) => {
                const meta = SYNC_META[account.sync_state];
                return (
                  <li key={account.id} className="py-4">
                    <div className="flex items-center gap-3">
                      <StatusDot status={meta.dot} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-lw-ink">
                          {account.email_address}
                        </p>
                        <p className="text-[12px] text-lw-ink-faint">
                          {t(meta.labelKey)}
                          {account.last_sync_at
                            ? ` · ${t("mail.lastSync")}: ${formatAgo(account.last_sync_at)}`
                            : ""}
                          {account.last_error ? ` · ${account.last_error}` : ""}
                        </p>
                      </div>
                      <Badge tone="neutral">Gmail</Badge>
                    </div>
                    <SignatureEditor account={account} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <p className="text-[12px] text-lw-ink-faint">{t("mail.syncHint")}</p>
    </div>
  );
}
