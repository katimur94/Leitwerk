import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@leitwerk/ui";
import { t } from "../i18n/de";
import { supabase } from "../lib/supabase";
import { AuthLayout } from "./AuthLayout";

function loginErrorMessage(message: string): string {
  if (message.includes("Invalid login credentials")) {
    return "E-Mail oder Passwort ist falsch.";
  }
  if (message.includes("Email not confirmed")) {
    return "Bitte bestätige zuerst deine E-Mail-Adresse.";
  }
  return `Anmeldung fehlgeschlagen: ${message}`;
}

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setPending(false);
    if (authError) {
      setError(loginErrorMessage(authError.message));
      return;
    }
    navigate("/");
  }

  async function onGoogle() {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) setError(`Google-Anmeldung fehlgeschlagen: ${authError.message}`);
  }

  return (
    <AuthLayout>
      <h1 className="mb-6 text-[20px] font-semibold text-lw-ink">
        {t("auth.login")}
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
        <Field label={t("auth.password")} htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p className="text-[13px] text-lw-danger">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t("common.loading") : t("auth.login")}
        </Button>
      </form>
      <div className="my-4 flex items-center gap-3 text-[12px] text-lw-ink-faint">
        <span className="h-px flex-1 bg-lw-border" />
        oder
        <span className="h-px flex-1 bg-lw-border" />
      </div>
      <Button variant="secondary" className="w-full" onClick={onGoogle}>
        {t("auth.loginWithGoogle")}
      </Button>
      <p className="mt-6 text-center text-[13px] text-lw-ink-soft">
        {t("auth.noAccount")}{" "}
        <Link
          to="/registrieren"
          className="font-medium text-lw-accent hover:underline"
        >
          {t("auth.register")}
        </Link>
      </p>
    </AuthLayout>
  );
}
