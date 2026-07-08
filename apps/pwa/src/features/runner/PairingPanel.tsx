import { useState, type FormEvent } from "react";
import { Button, Card, Field, Input } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { env } from "../../lib/env";
import { useCreatePairingCode } from "./queries";

export function PairingPanel() {
  const [code, setCode] = useState("");
  const [waiting, setWaiting] = useState(false);
  const pairing = useCreatePairingCode();

  const functionsUrl = `${env.supabaseUrl}/functions/v1`;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    pairing.mutate(code, {
      onSuccess: () => {
        setWaiting(true);
        setCode("");
      },
    });
  }

  return (
    <Card className="p-6">
      <h3 className="text-[16px] font-semibold text-lw-ink">
        {t("runner.pair.title")}
      </h3>
      <ol className="mt-4 flex flex-col gap-4 text-[14px] text-lw-ink-soft">
        <li>
          <p className="mb-2">1. {t("runner.pair.step1")}</p>
          <pre className="overflow-x-auto rounded-[var(--lw-radius-md)] bg-lw-surface-2 px-3 py-2 font-mono text-[12px] text-lw-ink">
            {`npx leitwerk-runner init --url ${functionsUrl}`}
          </pre>
        </li>
        <li>
          <p className="mb-2">2. {t("runner.pair.step2")}</p>
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <div className="w-44">
              <Field label={t("runner.pair.codeLabel")} htmlFor="pairing-code">
                <Input
                  id="pairing-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCD-2345"
                  autoComplete="off"
                  className="font-mono tracking-widest"
                />
              </Field>
            </div>
            <Button type="submit" disabled={pairing.isPending}>
              {pairing.isPending ? t("common.loading") : t("runner.pair.submit")}
            </Button>
          </form>
        </li>
      </ol>
      {pairing.isError ? (
        <p className="mt-3 text-[13px] text-lw-danger">
          {pairing.error.message}
        </p>
      ) : null}
      {waiting && !pairing.isError ? (
        <p className="mt-3 text-[13px] text-lw-ink-soft">
          {t("runner.pair.waiting")}
        </p>
      ) : null}
    </Card>
  );
}
