import type { ReactNode } from "react";
import { Card } from "@leitwerk/ui";
import { t } from "../i18n/de";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-lw-bg px-4 py-12">
      <div className="flex items-center gap-3">
        <img src="/logo.svg" alt="" className="h-10 w-10 rounded-[10px]" />
        <div>
          <p className="text-[20px] font-semibold leading-tight text-lw-ink">
            {t("app.name")}
          </p>
          <p className="text-[13px] text-lw-ink-soft">{t("app.tagline")}</p>
        </div>
      </div>
      <Card className="w-full max-w-[400px] p-8">{children}</Card>
    </div>
  );
}
