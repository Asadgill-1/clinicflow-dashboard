import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import { Info } from "lucide-react";
import type { ClinicUser } from "@/lib/types";

export const Route = createFileRoute("/_app/staff")({
  component: StaffPage,
});

function StaffPage() {
  const { clinicUser, hasRole } = useAuth();
  if (!hasRole("owner")) return <Navigate to="/" />;
  const clinicId = clinicUser!.clinic_id;

  const q = useQuery({
    queryKey: ["staff", clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_users")
        .select("id, clinic_id, auth_user_id, role, name, email")
        .eq("clinic_id", clinicId)
        .order("role", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClinicUser[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        <p className="text-sm text-muted-foreground">Members with access to this clinic.</p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Info className="size-4 mt-0.5 shrink-0" />
        <span>Staff accounts are managed by your platform administrator.</span>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Members</CardTitle></CardHeader>
        <CardContent>
          {q.isLoading ? <TableSkeleton rows={4} cols={3} /> :
            !q.data?.length ? <EmptyState title="No staff members" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                      <TableCell className="tabular text-sm">{u.email ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge tone={u.role === "owner" ? "info" : "neutral"}>{u.role}</StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
