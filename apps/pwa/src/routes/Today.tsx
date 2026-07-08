import { Sunrise } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState } from "@leitwerk/ui";
import { t } from "../i18n/de";

export function Today() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<Sunrise />}
        title={t("today.empty.title")}
        description={t("today.empty.description")}
        action={
          <Button
            variant="secondary"
            onClick={() => navigate("/einstellungen/runner")}
          >
            {t("today.empty.cta")}
          </Button>
        }
      />
    </div>
  );
}
