import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Skeleton } from "@leitwerk/ui";
import { useSessionStore } from "../stores/session";

function BootSkeleton() {
  return (
    <div className="flex h-full">
      <Skeleton className="h-full w-14 rounded-none" />
      <Skeleton className="h-full w-60 rounded-none" />
      <div className="flex-1 space-y-4 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-2xl" />
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSessionStore();
  if (loading) return <BootSkeleton />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireOrg({ children }: { children: ReactNode }) {
  const { activeOrg, loading } = useSessionStore();
  if (loading) return <BootSkeleton />;
  if (!activeOrg) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
