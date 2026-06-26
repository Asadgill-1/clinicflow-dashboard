import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const { status } = useAuth();
  if (status === "loading")
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  if (status === "ready") return <Navigate to="/overview" />;
  return <Navigate to="/auth" />;
}
