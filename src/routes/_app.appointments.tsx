import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  Table, TableHeader, TableHead, TableRow, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, appointmentStatusTone, attendanceTone } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import { fmtDateTime } from "@/lib/format";
import { callAction, toDubaiISO, type ActionResponse } from "@/lib/api-client";
import type { Appointment, Patient } from "@/lib/types";
import {
  MoreHorizontal, ArrowUpDown, CheckCircle2, XCircle, Plus, Loader2,
  CalendarClock, Ban, Check, Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";

export const Route = createFileRoute("/_app/appointments")({
  component: AppointmentsPage,
});

type SortKey = "scheduled_at" | "appointment_number" | "status";

const DUBAI_TZ = "Asia/Dubai";

function AppointmentsPage() {
  const { clinicUser, clinic } = useAuth();
  const tz = clinic?.timezone || DUBAI_TZ;
  const clinicId = clinicUser!.clinic_id;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("scheduled_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [newOpen, setNewOpen] = useState(false);
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: string } | null>(null);

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
          <Button onClick={() => setNewOpen(true)} className="min-h-10">
            <Plus className="size-4 mr-1" /> New appointment
          </Button>
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
                    const isPending = pending?.id === a.id;
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
                            pendingKind={isPending ? pending!.kind : null}
                            onConfirm={() =>
                              runAction(a.id, "confirm", "appt_confirm", { appointment_id: a.id }, "Patient notified — confirmed.")
                            }
                            onCancel={() =>
                              runAction(a.id, "cancel", "appt_cancel", { appointment_id: a.id }, "Patient notified — cancelled.")
                            }
                            onReschedule={() => setRescheduleAppt(a)}
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

      <NewAppointmentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        clinicId={clinicId}
        onBooked={refetch}
      />

      <RescheduleDialog
        appt={rescheduleAppt}
        tz={tz}
        onOpenChange={(o) => { if (!o) setRescheduleAppt(null); }}
        onDone={() => { setRescheduleAppt(null); refetch(); }}
      />
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
  appt, pendingKind, onConfirm, onCancel, onReschedule, onMarkAttendance, onOpen,
}: {
  appt: Appointment;
  pendingKind: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  onMarkAttendance: (a: "came" | "no_show") => void;
  onOpen: () => void;
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
        <DropdownMenuItem
          disabled={busy}
          onSelect={(e) => { e.preventDefault(); onMarkAttendance("came"); }}
        >
          {pendingKind === "came" ? Spin : <CheckCircle2 className="size-4 mr-2 text-success" />} Mark came
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
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
            <Input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

function NewAppointmentDialog({
  open, onOpenChange, clinicId, onBooked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinicId: string;
  onBooked: () => void;
}) {
  const tz = DUBAI_TZ;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState("");
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
    setName(""); setPhone(""); setService(""); setDate(""); setTime("");
    setConflict(null); setSubmitting(false);
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  const submit = async (overrideIso?: string) => {
    if (!name.trim()) { toast.error("Patient name is required."); return; }
    if (!service) { toast.error("Choose a service."); return; }
    const iso = overrideIso ?? (date && time ? toDubaiISO(date, time) : "");
    if (!iso) { toast.error("Pick a date and time."); return; }
    setSubmitting(true);
    setConflict(null);
    try {
      const res = await callAction("walk_in_book", {
        name: name.trim(),
        phone: phone.trim() || null,
        service,
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
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="n-name">Patient full name *</Label>
            <Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara Al Mansoori" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="n-phone">Phone (optional)</Label>
            <Input id="n-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 ..." inputMode="tel" />
          </div>
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
          <div className="space-y-1.5">
            <Label htmlFor="n-date">Date *</Label>
            <Input id="n-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
