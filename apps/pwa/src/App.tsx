import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth, RequireOrg } from "./routes/guards";
import { AppShell } from "./routes/AppShell";
import { CaseDetail } from "./routes/CaseDetail";
import { CasesList } from "./routes/CasesList";
import { ComingSoon } from "./routes/ComingSoon";
import { Inbox } from "./routes/Inbox";
import { Login } from "./routes/Login";
import { MailSettings } from "./routes/MailSettings";
import { Onboarding } from "./routes/Onboarding";
import { Register } from "./routes/Register";
import { RulesSettings } from "./routes/RulesSettings";
import { RunnerSettings } from "./routes/RunnerSettings";
import { Today } from "./routes/Today";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registrieren" element={<Register />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <Onboarding />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RequireOrg>
              <AppShell />
            </RequireOrg>
          </RequireAuth>
        }
      >
        <Route index element={<Today />} />
        <Route path="posteingang" element={<Inbox />} />
        <Route path="vorgaenge" element={<CasesList />} />
        <Route path="vorgaenge/:caseId" element={<CaseDetail />} />
        <Route
          path="aufgaben"
          element={<ComingSoon titleKey="nav.tasks" phase={2} />}
        />
        <Route
          path="finanzen"
          element={<ComingSoon titleKey="nav.finance" phase={3} />}
        />
        <Route
          path="einstellungen"
          element={<Navigate to="/einstellungen/runner" replace />}
        />
        <Route path="einstellungen/runner" element={<RunnerSettings />} />
        <Route path="einstellungen/regeln" element={<RulesSettings />} />
        <Route path="einstellungen/postfaecher" element={<MailSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
