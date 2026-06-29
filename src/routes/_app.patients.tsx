import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { StatusBadge, patientStatusTone } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import type { Patient, Appointment } from "@/lib/types";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_app/patients")({
  component: PatientsPage,
});

function PatientsPage() {
  const { clinicUser } = useAuth();
  const clinicId = clinicUser!.clinic_id;
  const isDoctorOnly = clinicUser!.role === "doctor";
  const [search, setSearch] = useState("");

  const patientsQ = useQuery({
    queryKey: ["patients", clinicId, search, isDoctorOnly ? clinicUser!.id : "all"],
    queryFn: async () => {
      // For doctor-only view, first collect patient ids assigned to them via appts or tokens.
      let allowed: Set<string> | null = null;
      if (isDoctorOnly) {
        const [a, t] = await Promise.all([
          supabase.from("appointments").select("patient_id").eq("clinic_id", clinicId).eq("doctor_user_id", clinicUser!.id),
          supabase.from("tokens").select("patient_id").eq("clinic_id", clinicId).eq("doctor_user_id", clinicUser!.id),
        ]);
        allowed = new Set<string>();
        ((a.data ?? []) as { patient_id: string | null }[]).forEach((r) => r.patient_id && allowed!.add(r.patient_id));
        ((t.data ?? []) as { patient_id: string | null }[]).forEach((r) => r.patient_id && allowed!.add(r.patient_id));
        if (allowed.size === 0) return { patients: [] as Patient[], counts: {} as Record<string, { came: number; no_show: number }> };
      }

      let q = supabase
        .from("patients")
        .select("id, name, language_preference, status, pdpl_consent, is_minor")
        .eq("clinic_id", clinicId)
        .order("name", { ascending: true })
        .limit(200);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      if (allowed) q = q.in("id", Array.from(allowed));
      const { data, error } = await q;
      if (error) throw error;
      const patients = (data ?? []) as Patient[];

      // load attendance counts
      const ids = patients.map((p) => p.id);
      let counts: Record<string, { came: number; no_show: number }> = {};
      if (ids.length) {
        const { data: aData } = await supabase
          .from("appointments")
          .select("patient_id, attendance")
          .eq("clinic_id", clinicId)
          .in("patient_id", ids)
          .not("attendance", "is", null);
        counts = {};
        ((aData ?? []) as Pick<Appointment, "patient_id" | "attendance">[]).forEach((a) => {
          const c = counts[a.patient_id] ??= { came: 0, no_show: 0 };
          if (a.attendance === "came") c.came++;
          else if (a.attendance === "no_show") c.no_show++;
        });
      }
      return { patients, counts };
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
          <p className="text-sm text-muted-foreground">
            Search and manage clinic patients.{" "}
            <span className="ml-1 italic">Showing: {isDoctorOnly ? "my patients" : "all"}</span>
          </p>
        </div>
        <div className="relative">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="pl-9 w-[280px] min-h-10"
            aria-label="Search patients"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Directory</CardTitle></CardHeader>
        <CardContent>
          {patientsQ.isLoading ? (
            <TableSkeleton rows={8} cols={5} />
          ) : !patientsQ.data?.patients.length ? (
            <EmptyState title="No patients found" hint="Try a different search term." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Reliability</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patientsQ.data.patients.map((p) => {
                    const c = patientsQ.data!.counts[p.id] ?? { came: 0, no_show: 0 };
                    return (
                      <TableRow key={p.id} className="hover:bg-muted/40">
                        <TableCell>
                          <Link to="/patients/$id" params={{ id: p.id }} className="font-medium hover:underline">
                            {p.name ?? "Unnamed"}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={patientStatusTone(p.status)}>{p.status ?? "—"}</StatusBadge>
                        </TableCell>
                        <TableCell className="text-sm">{p.language_preference ?? "—"}</TableCell>
                        <TableCell className="tabular text-sm">
                          <span className="text-success">{c.came}</span>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-destructive">{c.no_show}</span>
                          <span className="text-muted-foreground text-xs ml-1">came / no-show</span>
                        </TableCell>
                        <TableCell className="space-x-1">
                          {p.is_minor && <StatusBadge tone="info">minor</StatusBadge>}
                          {p.pdpl_consent ? (
                            <StatusBadge tone="success">PDPL ✓</StatusBadge>
                          ) : (
                            <StatusBadge tone="warning">No PDPL</StatusBadge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
