import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableHead, TableRow, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, appointmentStatusTone, attendanceTone } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import { fmtDateTime } from "@/lib/format";
import type { Appointment, Patient } from "@/lib/types";
import { MoreHorizontal, ArrowUpDown, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/appointments")({
  component: AppointmentsPage,
});

type SortKey = "scheduled_at" | "appointment_number" | "status";

function AppointmentsPage() {
  const { clinicUser, clinic } = useAuth();
  const tz = clinic?.timezone || "UTC";
  const clinicId = clinicUser!.clinic_id;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("scheduled_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const apptsQ = useQuery({
    queryKey: ["appointments", clinicId, statusFilter, sortKey, sortDir],
    queryFn: async () => {
      let q = supabase
        .from("appointments")
        .select("id, appointment_number, patient_id, reason, scheduled_at, duration_min, status, attendance, attendance_marked_at, doctor")
        .eq("clinic_id", clinicId)
        .order(sortKey, { ascending: sortDir === "asc" })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      const appts = (data ?? []) as Appointment[];
      const ids = Array.from(new Set(appts.map((a) => a.patient_id)));
      let patientsById: Record<string, Patient> = {};
      if (ids.length) {
        const { data: p } = await supabase.from("patients").select("id, name").in("id", ids);
        patientsById = Object.fromEntries(((p ?? []) as Patient[]).map((x) => [x.id, x]));
      }
      return { appts, patientsById };
    },
  });

  const markAttendance = useMutation({
    mutationFn: async ({ id, attendance }: { id: string; attendance: "came" | "no_show" }) => {
      const { error } = await supabase
        .from("appointments")
        .update({ attendance, attendance_marked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success(`Marked ${vars.attendance === "came" ? "came" : "no-show"}.`);
      qc.invalidateQueries({ queryKey: ["appointments", clinicId] });
      qc.invalidateQueries({ queryKey: ["overview", clinicId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const rows = useMemo(() => apptsQ.data?.appts ?? [], [apptsQ.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground">Manage booking status and attendance.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] min-h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="requested">Requested</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {apptsQ.isLoading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : !rows.length ? (
            <EmptyState title="No appointments found" hint="Try changing the status filter." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead onClick={() => toggleSort("appointment_number")} active={sortKey === "appointment_number"}>Ref</SortableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Reason</TableHead>
                    <SortableHead onClick={() => toggleSort("scheduled_at")} active={sortKey === "scheduled_at"}>Scheduled</SortableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <SortableHead onClick={() => toggleSort("status")} active={sortKey === "status"}>Status</SortableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead className="w-10" aria-label="actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => {
                    const p = apptsQ.data!.patientsById[a.patient_id];
                    return (
                      <TableRow key={a.id} className="hover:bg-muted/40">
                        <TableCell className="tabular text-xs">{a.appointment_number ?? "—"}</TableCell>
                        <TableCell>
                          <Link to="/patients/$id" params={{ id: a.patient_id }} className="hover:underline">
                            {p?.name ?? "Unknown"}
                          </Link>
                          {a.doctor && <div className="text-xs text-muted-foreground">Dr. {a.doctor}</div>}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate" title={a.reason ?? ""}>{a.reason ?? "—"}</TableCell>
                        <TableCell className="tabular text-sm">{fmtDateTime(a.scheduled_at, tz)}</TableCell>
                        <TableCell className="tabular text-right">{a.duration_min ?? "—"}m</TableCell>
                        <TableCell><StatusBadge tone={appointmentStatusTone(a.status)}>{a.status}</StatusBadge></TableCell>
                        <TableCell>
                          {a.attendance
                            ? <StatusBadge tone={attendanceTone(a.attendance)}>{a.attendance.replace("_", "-")}</StatusBadge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <RowActions
                            appt={a}
                            onMark={(attendance) => markAttendance.mutate({ id: a.id, attendance })}
                            onOpen={() => navigate({ to: "/patients/$id", params: { id: a.patient_id } })}
                          />
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

function SortableHead({
  children, onClick, active,
}: { children: React.ReactNode; onClick: () => void; active: boolean }) {
  return (
    <TableHead>
      <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground" aria-pressed={active}>
        {children}
        <ArrowUpDown className={`size-3 ${active ? "text-primary" : "text-muted-foreground"}`} />
      </button>
    </TableHead>
  );
}

function RowActions({
  appt, onMark, onOpen,
}: { appt: Appointment; onMark: (a: "came" | "no_show") => void; onOpen: () => void }) {
  return (
    <TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-9" aria-label="Row actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={onOpen}>Open patient</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onMark("came")}>
            <CheckCircle2 className="size-4 mr-2 text-success" /> Mark came
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMark("no_show")}>
            <XCircle className="size-4 mr-2 text-destructive" /> Mark no-show
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {(["Confirm", "Cancel", "Reschedule"] as const).map((label) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <div>
                  <DropdownMenuItem disabled onSelect={(e) => e.preventDefault()}>
                    {label} (messages patient)
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">Sends via backend (wiring pending)</TooltipContent>
            </Tooltip>
          ))}
          <div className="px-2 py-1 text-[10px] text-muted-foreground tabular">
            {appt.appointment_number}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
