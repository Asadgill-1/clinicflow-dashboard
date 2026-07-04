import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, appointmentStatusTone, attendanceTone } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import { fmtDateTime } from "@/lib/format";
import { callAction, toDubaiISO, type ActionResponse } from "@/lib/api-client";
import type { Appointment, Patient } from "@/lib/types";
import {
  MoreHorizontal, CheckCircle2, XCircle, Plus, Loader2,
  CalendarClock, Ban, Check, Ticket, Stethoscope,
} from "lucide-react";
import { toast } from "sonner";


export const Route = createFileRoute("/_app/appointments")({
  component: AppointmentsPage,
});



const DUBAI_TZ = "Asia/Dubai";

function AppointmentsPage() {
  const { clinicUser, clinic, hasRole } = useAuth();
  const tz = clinic?.timezone || DUBAI_TZ;
  const clinicId = clinicUser!.clinic_id;
  const isDoctorOnly = clinicUser!.role === "doctor";
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [newOpen, setNewOpen] = useState(false);
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null);
  const [issueAppt, setIssueAppt] = useState<Appointment | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: string } | null>(null);

  const todayStr = useMemo(
    () => new Date().toLocaleDateString("en-CA", { timeZone: tz }),
    [tz],
  );

  const tokensQ = useQuery({
    queryKey: ["tokens-today", clinicId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tokens")
        .select("appointment_id, patient_id, token_number, room_number, doctor_name, status, issued_date, created_at")
        .eq("clinic_id", clinicId)
        .eq("issued_date", todayStr);
      if (error) throw error;
      const map: Record<string, { token_number: number; room_number: string | null; doctor_name: string | null; status: string; created_at: string }> = {};
      for (const t of (data ?? []) as Array<{ appointment_id: string | null; token_number: number; room_number: string | null; doctor_name: string | null; status: string; created_at: string }>) {
        if (!t.appointment_id) continue;
        const prev = map[t.appointment_id];
        if (!prev || new Date(t.created_at) > new Date(prev.created_at)) {
          map[t.appointment_id] = t;
        }
      }
      return map;
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`tokens-appts-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tokens", filter: `clinic_id=eq.${clinicId}` },
        () => qc.invalidateQueries({ queryKey: ["tokens-today", clinicId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clinicId, qc]);

  const doctorsQ = useQuery({
    queryKey: ["clinic-doctors", clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_users")
        .select("id, name, role, room_number")
        .eq("clinic_id", clinicId)
        .in("role", ["doctor", "owner"])
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DoctorRow[];
    },
  });

  const apptsQ = useQuery({
    queryKey: ["appointments", clinicId, isDoctorOnly ? clinicUser!.id : "all"],
    queryFn: async () => {
      // fetch newest-first so the 200-cap drops ancient history, not fresh bookings,
      // then re-sort ascending for display (hardening #16)
      let q = supabase
        .from("appointments")
        .select("id, appointment_number, patient_id, reason, scheduled_at, duration_min, status, attendance, attendance_marked_at, doctor, doctor_user_id")
        .eq("clinic_id", clinicId)
        .order("scheduled_at", { ascending: false })
        .limit(200);
      if (isDoctorOnly) q = q.eq("doctor_user_id", clinicUser!.id);
      const { data, error } = await q;
      if (error) throw error;
      const appts = ((data ?? []) as Appointment[]).sort(
        (a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
      );
      const capped = appts.length === 200;
      const ids = Array.from(new Set(appts.map((a) => a.patient_id)));
      let patientsById: Record<string, Patient> = {};
      if (ids.length) {
        const { data: p } = await supabase.from("patients").select("id, name").in("id", ids);
        patientsById = Object.fromEntries(((p ?? []) as Patient[]).map((x) => [x.id, x]));
      }
      return { appts, patientsById, capped };
    },
  });

  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["appointments", clinicId] });
    qc.invalidateQueries({ queryKey: ["overview", clinicId] });
  };

  const runAction = async (
    id: string,
    kind: string,
    action: string,
    payload: Record<string, unknown>,
    successMsg: string,
  ): Promise<ActionResponse | null> => {
    setPending({ id, kind });
    try {
      const res = await callAction(action, payload);
      if (res.ok) {
        toast.success(successMsg);
        refetch();
        return res;
      }
      if (res.reason === "closed") {
        toast.error("Clinic is closed that day.");
      } else if (res.reason === "past") {
        toast.error("That time is already in the past.");
      } else if (res.reason === "taken") {
        // caller handles nextFree UI
      } else {
        toast.error(res.message || `Action failed: ${res.reason || "unknown"}`);
      }
      return res;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setPending(null);
    }
  };


  const [search, setSearch] = useState("");

  const buckets = useMemo(() => {
    let rows = apptsQ.data?.appts ?? [];
    const pById = apptsQ.data?.patientsById ?? {};
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter((a) =>
        (pById[a.patient_id]?.name ?? "").toLowerCase().includes(s) ||
        (a.appointment_number ?? "").toLowerCase().includes(s) ||
        (a.reason ?? "").toLowerCase().includes(s),
      );
    }
    const sortByTime = (a: Appointment, b: Appointment) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    const byStatus = (st: Appointment["status"]) => rows.filter((a) => a.status === st).sort(sortByTime);
    // finished/cancelled: last 7 days only — the full history lives on each patient's page
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = (a: Appointment) => new Date(a.scheduled_at ?? 0).getTime() >= weekAgo;
    return {
      requested: byStatus("requested"),
      confirmed: rows.filter((a) => a.status === "confirmed" && a.attendance == null).sort(sortByTime),
      cancelled: byStatus("cancelled").filter(recent),
      completed: rows.filter((a) => a.attendance != null && recent(a)).sort(sortByTime),
    };
  }, [apptsQ.data, search]);

  // tokens are for a patient standing at reception TODAY — hide Issue on past/cancelled/finished cards
  const canIssueToken = (a: Appointment) =>
    a.status !== "cancelled" && a.attendance == null &&
    !!a.scheduled_at &&
    new Date(a.scheduled_at).toLocaleDateString("en-CA", { timeZone: tz }) === todayStr;

  const renderCard = (a: Appointment, column: "requested" | "confirmed" | "cancelled" | "completed") => {
    const p = apptsQ.data!.patientsById[a.patient_id];
    const isPending = pending?.id === a.id;
    const pendingKind = isPending ? pending!.kind : null;
    const assignedDoctor = doctorsQ.data?.find((d) => d.id === a.doctor_user_id) ?? null;
    const doctorLabel = assignedDoctor?.name ?? a.doctor ?? null;
    const muted = column === "cancelled";

    return (
      <div
        key={a.id}
        className={`rounded-md border border-border bg-card p-3 space-y-2 ${muted ? "opacity-60" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to="/patients/$id"
              params={{ id: a.patient_id }}
              className="font-medium text-sm hover:underline block truncate"
            >
              {p?.name ?? "Unknown"}
            </Link>
            <div className="text-[11px] text-muted-foreground tabular truncate">
              {a.appointment_number ?? "—"}
            </div>
          </div>
          <RowActions
            appt={a}
            pendingKind={pendingKind}
            canIssue={canIssueToken(a)}
            doctors={doctorsQ.data ?? []}
            onConfirm={() =>
              runAction(a.id, "confirm", "appt_confirm", { appointment_id: a.id }, "Patient notified — confirmed.")
            }
            onCancel={() =>
              runAction(a.id, "cancel", "appt_cancel", { appointment_id: a.id }, "Patient notified — cancelled.")
            }
            onReschedule={() => setRescheduleAppt(a)}
            onAssignDoctor={(docId) =>
              runAction(
                a.id,
                "assign",
                "appt_assign_doctor",
                { appointment_id: a.id, doctor_user_id: docId },
                docId ? "Doctor assigned." : "Doctor unassigned.",
              )
            }
            onMarkAttendance={async (att) => {
              await runAction(
                a.id,
                att === "came" ? "came" : "no_show",
                "attendance_mark",
                { appointment_id: a.id, attendance: att },
                `Marked ${att === "came" ? "came" : "no-show"}.`,
              );
            }}
            onOpen={() => navigate({ to: "/patients/$id", params: { id: a.patient_id } })}
            onIssueToken={() => setIssueAppt(a)}
          />
        </div>

        <div className="text-xs tabular text-foreground">
          {fmtDateTime(a.scheduled_at, tz)}
          {a.duration_min != null && <span className="text-muted-foreground"> · {a.duration_min}m</span>}
        </div>

        {a.reason && (
          <div className="text-xs text-muted-foreground line-clamp-2" title={a.reason}>
            {a.reason}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          {doctorLabel ? `Dr. ${doctorLabel}` : "Unassigned"}
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {a.attendance && (
            <StatusBadge tone={attendanceTone(a.attendance)}>
              {a.attendance.replace("_", "-")}
            </StatusBadge>
          )}
          <TokenCell
            token={tokensQ.data?.[a.id] ?? null}
            canIssue={canIssueToken(a)}
            onIssue={() => setIssueAppt(a)}
          />
        </div>

        {column === "requested" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              size="sm"
              className="bg-success text-success-foreground hover:bg-success/90 min-h-9"
              disabled={isPending}
              onClick={() =>
                runAction(a.id, "confirm", "appt_confirm", { appointment_id: a.id }, "Patient notified — confirmed.")
              }
            >
              {pendingKind === "confirm" ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Check className="size-4 mr-1" />}
              Confirm
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="min-h-9"
              disabled={isPending}
              onClick={() =>
                runAction(a.id, "cancel", "appt_cancel", { appointment_id: a.id }, "Patient notified — cancelled.")
              }
            >
              {pendingKind === "cancel" ? <Loader2 className="size-4 mr-1 animate-spin" /> : <XCircle className="size-4 mr-1" />}
              Reject
            </Button>
          </div>
        )}

        {column === "confirmed" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="min-h-9"
              disabled={isPending}
              onClick={() =>
                runAction(a.id, "came", "attendance_mark", { appointment_id: a.id, attendance: "came" }, "Marked came.")
              }
            >
              {pendingKind === "came" ? <Loader2 className="size-4 mr-1 animate-spin" /> : <CheckCircle2 className="size-4 mr-1 text-success" />}
              Came
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-9"
              disabled={isPending}
              onClick={() =>
                runAction(a.id, "no_show", "attendance_mark", { appointment_id: a.id, attendance: "no_show" }, "Marked no-show.")
              }
            >
              {pendingKind === "no_show" ? <Loader2 className="size-4 mr-1 animate-spin" /> : <XCircle className="size-4 mr-1 text-destructive" />}
              No-show
            </Button>
          </div>
        )}
      </div>
    );
  };


  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            Manage booking status and attendance.{" "}
            <span className="ml-1 italic">
              Showing: {isDoctorOnly ? "my patients" : "all"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ref, service…"
            className="w-[240px] min-h-10"
            aria-label="Search appointments"
          />
          <Button onClick={() => setNewOpen(true)} className="min-h-10">
            <Plus className="size-4 mr-1" /> New appointment
          </Button>
        </div>
      </div>

      {apptsQ.data?.capped && (
        <p className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-md px-3 py-2">
          Showing the latest 200 appointments — older history is not displayed.
        </p>
      )}

      {apptsQ.isLoading ? (
        <TableSkeleton rows={6} cols={3} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Column 1 — Requested */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <StatusBadge tone={appointmentStatusTone("requested")}>Requested</StatusBadge>
                </span>
                <span className="text-xs tabular text-muted-foreground">{buckets.requested.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {buckets.requested.length === 0 ? (
                  <EmptyState title="No appointments" />
                ) : (
                  buckets.requested.map((a) => renderCard(a, "requested"))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Column 2 — Confirmed */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <StatusBadge tone={appointmentStatusTone("confirmed")}>Confirmed</StatusBadge>
                </span>
                <span className="text-xs tabular text-muted-foreground">{buckets.confirmed.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {buckets.confirmed.length === 0 ? (
                  <EmptyState title="No appointments" />
                ) : (
                  buckets.confirmed.map((a) => renderCard(a, "confirmed"))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Column 3 — Cancelled + Completed stacked */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <StatusBadge tone={appointmentStatusTone("cancelled")}>Cancelled</StatusBadge>
                    <span className="text-xs font-normal text-muted-foreground">last 7 days</span>
                  </span>
                  <span className="text-xs tabular text-muted-foreground">{buckets.cancelled.length}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {buckets.cancelled.length === 0 ? (
                    <EmptyState title="No appointments" />
                  ) : (
                    buckets.cancelled.map((a) => renderCard(a, "cancelled"))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <StatusBadge tone="success">Finished</StatusBadge>
                    <span className="text-xs font-normal text-muted-foreground">came + no-show · last 7 days</span>
                  </span>
                  <span className="text-xs tabular text-muted-foreground">{buckets.completed.length}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {buckets.completed.length === 0 ? (
                    <EmptyState title="No appointments" />
                  ) : (
                    buckets.completed.map((a) => renderCard(a, "completed"))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <NewAppointmentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        clinicId={clinicId}
        doctors={doctorsQ.data ?? []}
        onBooked={refetch}
      />

      <RescheduleDialog
        appt={rescheduleAppt}
        tz={tz}
        onOpenChange={(o) => { if (!o) setRescheduleAppt(null); }}
        onDone={() => { setRescheduleAppt(null); refetch(); }}
      />

      <IssueTokenDialog
        appt={issueAppt}
        clinicId={clinicId}
        patientName={issueAppt ? (apptsQ.data?.patientsById[issueAppt.patient_id]?.name ?? null) : null}
        onOpenChange={(o) => { if (!o) setIssueAppt(null); }}
        onIssued={() => {
          setIssueAppt(null);
          qc.invalidateQueries({ queryKey: ["tokens-today", clinicId] });
        }}
      />
    </div>
  );
}



function RowActions({
  appt, pendingKind, canIssue, doctors, onConfirm, onCancel, onReschedule, onAssignDoctor, onMarkAttendance, onOpen, onIssueToken,
}: {
  appt: Appointment;
  pendingKind: string | null;
  canIssue: boolean;
  doctors: DoctorRow[];
  onConfirm: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  onAssignDoctor: (doctorUserId: string | null) => void;
  onMarkAttendance: (a: "came" | "no_show") => void;
  onOpen: () => void;
  onIssueToken: () => void;
}) {
  const busy = pendingKind !== null;
  const Spin = <Loader2 className="size-4 mr-2 animate-spin" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9" aria-label="Row actions" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={onOpen}>Open patient</DropdownMenuItem>
        <DropdownMenuItem disabled={!canIssue} onSelect={(e) => { e.preventDefault(); onIssueToken(); }}>
          <Ticket className="size-4 mr-2 text-primary" /> Issue token
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy || appt.status === "confirmed" || appt.status === "cancelled"}
          onSelect={(e) => { e.preventDefault(); onConfirm(); }}
        >
          {pendingKind === "confirm" ? Spin : <Check className="size-4 mr-2 text-success" />} Confirm
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || appt.status === "cancelled"}
          onSelect={(e) => { e.preventDefault(); onReschedule(); }}
        >
          <CalendarClock className="size-4 mr-2 text-primary" /> Reschedule
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || appt.status === "cancelled"}
          onSelect={(e) => { e.preventDefault(); onCancel(); }}
        >
          {pendingKind === "cancel" ? Spin : <Ban className="size-4 mr-2 text-destructive" />} Cancel
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={busy}>
            {pendingKind === "assign" ? Spin : <Stethoscope className="size-4 mr-2 text-primary" />}
            Assign doctor
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-56 max-h-72 overflow-y-auto">
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onAssignDoctor(null); }}>
                <span className="text-muted-foreground">Unassigned</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {doctors.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No doctors found</div>
              ) : doctors.map((d) => (
                <DropdownMenuItem
                  key={d.id}
                  onSelect={(e) => { e.preventDefault(); onAssignDoctor(d.id); }}
                >
                  {d.id === appt.doctor_user_id ? <Check className="size-4 mr-2 text-success" /> : <span className="w-4 mr-2" />}
                  Dr. {d.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy || appt.status !== "confirmed"}
          onSelect={(e) => { e.preventDefault(); onMarkAttendance("came"); }}
        >
          {pendingKind === "came" ? Spin : <CheckCircle2 className="size-4 mr-2 text-success" />} Mark came
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || appt.status !== "confirmed"}
          onSelect={(e) => { e.preventDefault(); onMarkAttendance("no_show"); }}
        >
          {pendingKind === "no_show" ? Spin : <XCircle className="size-4 mr-2 text-destructive" />} Mark no-show
        </DropdownMenuItem>
        <div className="px-2 py-1 text-[10px] text-muted-foreground tabular">
          {appt.appointment_number}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------------- Reschedule Dialog ---------------- */

function RescheduleDialog({
  appt, tz, onOpenChange, onDone,
}: {
  appt: Appointment | null;
  tz: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const open = !!appt;
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<{ nextFree: string } | null>(null);

  // initialize when opening
  const initFromAppt = (a: Appointment) => {
    try {
      const d = new Date(a.scheduled_at);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DUBAI_TZ, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(d);
      const ymd = `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
      const t = new Intl.DateTimeFormat("en-GB", {
        timeZone: DUBAI_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(d);
      setDate(ymd);
      setTime(t);
    } catch { /* noop */ }
    setConflict(null);
  };

  // Run init exactly when appt changes from null -> value
  const [lastApptId, setLastApptId] = useState<string | null>(null);
  if (appt && appt.id !== lastApptId) {
    setLastApptId(appt.id);
    initFromAppt(appt);
  }
  if (!appt && lastApptId !== null) setLastApptId(null);

  const submit = async (overrideIso?: string) => {
    if (!appt) return;
    const iso = overrideIso ?? (date && time ? toDubaiISO(date, time) : "");
    if (!iso) { toast.error("Pick a date and time."); return; }
    setSubmitting(true);
    setConflict(null);
    try {
      const res = await callAction("appt_reschedule", {
        appointment_id: appt.id,
        preferred_datetime: iso,
      });
      if (res.ok) {
        toast.success("Patient notified — rescheduled.");
        onDone();
      } else if (res.reason === "taken" && res.nextFree) {
        setConflict({ nextFree: res.nextFree });
      } else if (res.reason === "closed") {
        toast.error("Clinic is closed that day.");
      } else if (res.reason === "past") {
        toast.error("That time is already in the past.");
      } else {
        toast.error(res.message || `Reschedule failed: ${res.reason || "unknown"}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
          <DialogDescription>
            {appt?.appointment_number ? `Ref ${appt.appointment_number} — ` : ""}
            Times are in Asia/Dubai. The patient will be notified.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="r-date">Date</Label>
            <Input id="r-date" type="date" value={date} min={new Date().toLocaleDateString("en-CA", { timeZone: DUBAI_TZ })} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-time">Time</Label>
            <Input id="r-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} />
          </div>
        </div>
        {conflict && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            <div className="text-foreground">
              That time is taken — nearest free:{" "}
              <span className="tabular font-medium">{fmtDateTime(conflict.nextFree, tz)}</span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={submitting}
              onClick={() => submit(conflict.nextFree)}
            >
              {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
              Use this time
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={() => submit()} disabled={submitting || !date || !time}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- New / Walk-in Dialog ---------------- */

interface ClinicService {
  name: string;
  price?: number | string;
  duration_min?: number;
}

export function NewAppointmentDialog({
  open, onOpenChange, clinicId, doctors, onBooked, fixedPatient,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinicId: string;
  doctors: DoctorRow[];
  onBooked: () => void;
  /** book for an EXISTING patient (from their detail page) — skips the name/phone fields */
  fixedPatient?: { id: string; name: string | null };
}) {
  const tz = DUBAI_TZ;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState("");
  const [doctorId, setDoctorId] = useState<string>("__none__");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<{ nextFree: string } | null>(null);

  const servicesQ = useQuery({
    queryKey: ["clinic-services", clinicId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics").select("services").eq("id", clinicId).maybeSingle();
      if (error) throw error;
      const raw = (data?.services ?? []) as unknown;
      if (!Array.isArray(raw)) return [] as ClinicService[];
      return raw as ClinicService[];
    },
  });

  const reset = () => {
    setName(""); setPhone(""); setService(""); setDoctorId("__none__"); setDate(""); setTime("");
    setConflict(null); setSubmitting(false);
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  const submit = async (overrideIso?: string) => {
    if (!fixedPatient && !name.trim()) { toast.error("Patient name is required."); return; }
    if (!service) { toast.error("Choose a service."); return; }
    const iso = overrideIso ?? (date && time ? toDubaiISO(date, time) : "");
    if (!iso) { toast.error("Pick a date and time."); return; }
    setSubmitting(true);
    setConflict(null);
    try {
      const res = await callAction("walk_in_book", {
        ...(fixedPatient
          ? { patient_id: fixedPatient.id }
          : { name: name.trim(), phone: phone.trim() || null }),
        service,
        doctor_user_id: doctorId === "__none__" ? null : doctorId,
        preferred_datetime: iso,
        patient_type: "walk_in",
      });
      if (res.ok) {
        toast.success(`Booked ${res.appointment_number ?? ""}`.trim());
        onBooked();
        close(false);
      } else if (res.reason === "taken" && res.nextFree) {
        setConflict({ nextFree: res.nextFree });
      } else if (res.reason === "closed") {
        toast.error("Clinic is closed that day.");
      } else if (res.reason === "past") {
        toast.error("That time is already in the past.");
      } else {
        toast.error(res.message || `Booking failed: ${res.reason || "unknown"}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription>
            Walk-in booking. Times are in Asia/Dubai.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {fixedPatient ? (
            <div className="col-span-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              Booking for <span className="font-medium">{fixedPatient.name ?? "this patient"}</span>
            </div>
          ) : (
            <>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="n-name">Patient full name *</Label>
                <Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara Al Mansoori" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="n-phone">Phone (optional)</Label>
                <Input id="n-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 ..." inputMode="tel" />
              </div>
            </>
          )}
          <div className="col-span-2 space-y-1.5">
            <Label>Service *</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="min-h-10">
                <SelectValue placeholder={servicesQ.isLoading ? "Loading…" : "Choose a service"} />
              </SelectTrigger>
              <SelectContent>
                {(servicesQ.data ?? []).map((s, i) => (
                  <SelectItem key={`${s.name}-${i}`} value={s.name}>
                    <span>{s.name}</span>
                    {(s.duration_min || s.price !== undefined) && (
                      <span className="text-muted-foreground tabular ml-2">
                        {s.duration_min ? `${s.duration_min}m` : ""}
                        {s.duration_min && s.price !== undefined ? " · " : ""}
                        {s.price !== undefined ? `AED ${s.price}` : ""}
                      </span>
                    )}
                  </SelectItem>
                ))}
                {!servicesQ.isLoading && !(servicesQ.data ?? []).length && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No services configured.</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="min-h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>Dr. {d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-date">Date *</Label>
            <Input id="n-date" type="date" value={date} min={new Date().toLocaleDateString("en-CA", { timeZone: DUBAI_TZ })} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-time">Time *</Label>
            <Input id="n-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} />
          </div>
        </div>
        {conflict && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            <div className="text-foreground">
              That time is taken — nearest free:{" "}
              <span className="tabular font-medium">{fmtDateTime(conflict.nextFree, tz)}</span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={submitting}
              onClick={() => submit(conflict.nextFree)}
            >
              {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
              Book this time
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={() => submit()} disabled={submitting}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            Book appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Token cell ---------------- */

interface TokenRow {
  token_number: number;
  room_number: string | null;
  doctor_name: string | null;
  status: string;
}

function statusDotClass(s: string) {
  if (s === "serving") return "bg-primary";
  if (s === "waiting") return "bg-warning";
  if (s === "done") return "bg-success";
  if (s === "skipped") return "bg-destructive";
  return "bg-muted-foreground";
}

function TokenCell({ token, canIssue, onIssue }: { token: TokenRow | null; canIssue: boolean; onIssue: () => void }) {
  if (!token) {
    if (!canIssue) return null; // past / cancelled / finished — a queue token makes no sense
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">—</span>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onIssue}>
          <Ticket className="size-3.5 mr-1" /> Issue
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col leading-tight">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block size-1.5 rounded-full ${statusDotClass(token.status)}`} aria-label={token.status} />
        <span className="tabular font-semibold text-sm">#{token.token_number}</span>
      </div>
      <span className="text-[11px] text-muted-foreground">Room {token.room_number || "—"}</span>
    </div>
  );
}

/* ---------------- Issue Token Dialog ---------------- */

export interface DoctorRow {
  id: string;
  name: string | null;
  role: string;
  room_number: string | null;
}

function IssueTokenDialog({
  appt, clinicId, patientName, onOpenChange, onIssued,
}: {
  appt: Appointment | null;
  clinicId: string;
  patientName: string | null;
  onOpenChange: (o: boolean) => void;
  onIssued: () => void;
}) {
  const open = !!appt;
  const [doctorId, setDoctorId] = useState<string>("");
  const [room, setRoom] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const doctorsQ = useQuery({
    queryKey: ["clinic-doctors", clinicId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_users")
        .select("id, name, role, room_number")
        .eq("clinic_id", clinicId)
        .in("role", ["doctor", "owner"])
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DoctorRow[];
    },
  });

  // Default selection when dialog opens / doctors load.
  useEffect(() => {
    if (!open || !doctorsQ.data?.length) return;
    if (doctorId && doctorsQ.data.some((d) => d.id === doctorId)) return;
    const match = appt?.doctor
      ? doctorsQ.data.find((d) => (d.name ?? "").toLowerCase() === appt.doctor!.toLowerCase())
      : null;
    const pick = match ?? doctorsQ.data[0];
    setDoctorId(pick.id);
    setRoom(pick.room_number ?? "");
  }, [open, doctorsQ.data, appt, doctorId]);

  // Reset on close
  useEffect(() => {
    if (!open) { setDoctorId(""); setRoom(""); setSubmitting(false); }
  }, [open]);

  const selected = doctorsQ.data?.find((d) => d.id === doctorId) ?? null;

  // When doctor changes, sync room to that doctor's default
  const onDoctorChange = (id: string) => {
    setDoctorId(id);
    const d = doctorsQ.data?.find((x) => x.id === id);
    setRoom(d?.room_number ?? "");
  };

  const submit = async () => {
    if (!appt || !doctorId) return;
    setSubmitting(true);
    try {
      const trimmedRoom = room.trim();
      const { data, error } = await supabase.functions.invoke("dashboard-api", {
        body: {
          action: "issue_token",
          clinic_id: clinicId,
          appointment_id: appt.id,
          patient_id: appt.patient_id,
          doctor_user_id: doctorId,
          service: appt.reason,
          ...(trimmedRoom ? { room_number: trimmedRoom } : {}),
        },
      });
      if (error) {
        const ctx = (error as { context?: { body?: unknown } }).context;
        let detail = "";
        try {
          if (ctx?.body && typeof (ctx.body as ReadableStream).getReader === "function") {
            // body is a stream; ignore
          } else if (typeof ctx?.body === "string") {
            detail = ctx.body;
          }
        } catch { /* noop */ }
        throw new Error(detail || error.message);
      }
      const res = data as { ok?: boolean; message?: string; token?: { token_number: number; doctor_name: string | null; room_number: string | null } };
      if (!res?.ok) throw new Error(res?.message || "Failed to issue token");
      const tok = res.token!;
      toast.success(`Token #${tok.token_number} · Dr ${tok.doctor_name ?? "—"} · Room ${tok.room_number || "—"}`);
      onIssued();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue token</DialogTitle>
          <DialogDescription>
            Assign a queue token to this patient at reception.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="font-medium">{patientName ?? "Unknown patient"}</div>
            <div className="tabular text-xs text-muted-foreground">
              Ref {appt?.appointment_number ?? "—"}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Doctor *</Label>
            <Select value={doctorId} onValueChange={onDoctorChange}>
              <SelectTrigger className="min-h-10">
                <SelectValue placeholder={doctorsQ.isLoading ? "Loading…" : "Choose a doctor"} />
              </SelectTrigger>
              <SelectContent>
                {(doctorsQ.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name ?? "Unnamed"} <span className="text-muted-foreground ml-1">· {d.role}</span>
                  </SelectItem>
                ))}
                {!doctorsQ.isLoading && !(doctorsQ.data ?? []).length && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No doctors found.</div>
                )}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              Doctor's default room: <span className="tabular">{selected?.room_number || "not set"}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="token-room">Room</Label>
            <Input
              id="token-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. 2"
              className="min-h-10"
            />
            <div className="text-xs text-muted-foreground">
              Override the room for this token, or leave to use the doctor's default.
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !doctorId}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            Issue token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
