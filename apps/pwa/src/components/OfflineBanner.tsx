import { useEffect, useState } from "react";
import { t } from "../i18n/de";

export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;
  return (
    <div
      className="px-4 py-2 text-center text-[13px] font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, var(--lw-warning) 12%, transparent)",
        color: "var(--lw-warning)",
      }}
    >
      {t("common.offline")}
    </div>
  );
}
