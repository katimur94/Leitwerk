import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@leitwerk/ui";
import { t } from "../i18n/de";
import { supabase } from "../lib/supabase";
import { AuthLayout } from "./AuthLayout";

export function Register() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    setPending(false);
    if (authError) {
      setError(`Registrierung fehlgeschlagen: ${authError.message}`);
      return;
    }
    if (!data.session) {
      // Hosted-Setup mit E-Mail-Bestätigung
      setNeedsConfirmation(true);
      return;
    }
    navigate("/onboarding");
  }

  if (needsConfirmation) {
    return (
      <AuthLayout>
        <h1 className="mb-3 text-[20px] font-semibold text-lw-ink">
          Fast geschafft
        </h1>
        <p className="text-[14px] text-lw-ink-soft">
          Wir haben dir eine Bestätigungs-Mail an <strong>{email}</strong>{" "}
          geschickt. Klicke auf den Link darin und melde dich danach an.
        </p>
        <Button className="mt-6 w-full" onClick={() => navigate("/login")}>
          {t("auth.login")}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="mb-6 text-[20px] font-semibold text-lw-ink">
        {t("auth.register")}
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label={t("auth.displayName")} htmlFor="displayName">
          <Input
            id="displayName"
            autoComplete="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field label={t("auth.email")} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label={t("auth.password")}
          htmlFor="password"
          hint="Mindestens 8 Zeichen"
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p className="text-[13px] text-lw-danger">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t("common.loading") : t("auth.register")}
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-lw-ink-soft">
        {t("auth.hasAccount")}{" "}
        <Link to="/login" className="font-medium text-lw-accent hover:underline">
          {t("auth.login")}
        </Link>
      </p>
    </AuthLayout>
  );
}
