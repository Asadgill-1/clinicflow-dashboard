import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { hasRole } = useAuth();
  if (!hasRole("owner")) return <Navigate to="/" />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <Card>
        <CardContent className="p-10 text-center space-y-3">
          <Construction className="size-8 text-warning mx-auto" />
          <div className="font-medium">Coming soon</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Operational and clinical reports will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
