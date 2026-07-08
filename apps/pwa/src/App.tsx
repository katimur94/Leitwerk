import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth, RequireOrg } from "./routes/guards";
import { AppShell } from "./routes/AppShell";
import { AutomationsSettings } from "./routes/AutomationsSettings";
import { CaseDetail } from "./routes/CaseDetail";
import { CasesList } from "./routes/CasesList";
import { Calendar } from "./routes/Calendar";
import { Finance } from "./routes/Finance";
import { Inbox } from "./routes/Inbox";
import { Login } from "./routes/Login";
import { MailSettings } from "./routes/MailSettings";
import { Meetings } from "./routes/Meetings";
import { Notes } from "./routes/Notes";
import { Onboarding } from "./routes/Onboarding";
import { Register } from "./routes/Register";
import { RulesSettings } from "./routes/RulesSettings";
import { RunnerSettings } from "./routes/RunnerSettings";
import { Tasks } from "./routes/Tasks";
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
        <Route path="aufgaben" element={<Tasks />} />
        <Route path="finanzen" element={<Finance />} />
        <Route path="notizen" element={<Notes />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="kalender" element={<Calendar />} />
        <Route
          path="einstellungen"
          element={<Navigate to="/einstellungen/runner" replace />}
        />
        <Route path="einstellungen/runner" element={<RunnerSettings />} />
        <Route path="einstellungen/regeln" element={<RulesSettings />} />
        <Route path="einstellungen/postfaecher" element={<MailSettings />} />
        <Route path="einstellungen/automationen" element={<AutomationsSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
