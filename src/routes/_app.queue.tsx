import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { callAction } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { StatusBadge, appointmentStatusTone, attendanceTone } from "@/components/StatusBadge";
import { EmptyState } from "@/components/States";
import { fmtDateTime } from "@/lib/format";
import {
  Ticket as TicketIcon, Plus, RefreshCcw, Monitor, Loader2, Printer, SkipForward, PhoneCall,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Token, ClinicUser, Patient, Appointment, DoctorNote, Prescription } from "@/lib/types";
import { PrescriptionForm, PrescriptionCard } from "@/components/Prescriptions";

export const Route = createFileRoute("/_app/queue")({
  component: QueuePage,
});

const DUBAI_TZ = "Asia/Dubai";

function todayInDubai(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DUBAI_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}

interface ClinicService {
  name: string;
  price?: number | string;
  duration_min?: number;
}

function QueuePage() {
  const { clinicUser, clinic, hasRole } = useAuth();
  const clinicId = clinicUser!.clinic_id;
  const qc = useQueryClient();
  const isDoctor = hasRole("doctor", "owner");

  const [issueOpen, setIssueOpen] = useState(false);
  const [slip, setSlip] = useState<Token | null>(null);
  const [callingNext, setCallingNext] = useState(false);
  const [skipping, setSkipping] = useState<string | null>(null);

  const today = todayInDubai();

  const isDoctorOnly = clinicUser!.role === "doctor";

  const tokensQ = useQuery({
    queryKey: ["tokens", clinicId, today, isDoctorOnly ? clinicUser!.id : "all"],
    refetchInterval: 5000,
    queryFn: async () => {
      let q = supabase
        .from("tokens")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("issued_date", today)
        .order("token_number", { ascending: true });
      if (isDoctorOnly) q = q.eq("doctor_user_id", clinicUser!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Token[];
    },
  });

  const doctorsQ = useQuery({
    queryKey: ["clinic-doctors", clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_users")
        .select("id, clinic_id, auth_user_id, role, name, email")
        .eq("clinic_id", clinicId)
        .in("role", ["doctor", "owner"])
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClinicUser[];
    },
  });

  // Live subscription
  useEffect(() => {
    const channel = supabase
      .channel(`tokens-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tokens", filter: `clinic_id=eq.${clinicId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["tokens", clinicId] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clinicId, qc]);

  const tokens = tokensQ.data ?? [];
  const doctors = doctorsQ.data ?? [];

  // Group by doctor_user_id
  const byDoctor = useMemo(() => {
    const groups: Record<string, { doctor: ClinicUser | null; name: string; tokens: Token[] }> = {};
    for (const d of doctors) {
      groups[d.id] = { doctor: d, name: d.name ?? d.email ?? "Doctor", tokens: [] };
    }
    for (const t of tokens) {
      const key = t.doctor_user_id ?? "_unassigned";
      if (!groups[key]) {
        groups[key] = { doctor: null, name: t.doctor_name ?? "Unassigned", tokens: [] };
      }
      groups[key].tokens.push(t);
    }
    return groups;
  }, [tokens, doctors]);

  // The doctor's own line
  const myDoctorRow = doctors.find((d) => d.auth_user_id === clinicUser!.auth_user_id);
  const myTokens = myDoctorRow ? (byDoctor[myDoctorRow.id]?.tokens ?? []) : [];
  const myServing = myTokens.find((t) => t.status === "serving") ?? null;
  const myWaitingCount = myTokens.filter((t) => t.status === "waiting").length;

  const refetchAll = () => qc.invalidateQueries({ queryKey: ["tokens", clinicId] });

  const callNext = async () => {
    setCallingNext(true);
    try {
      const res = await callAction("call_next");
      if (res.ok) {
        toast.success("Next patient called.");
        refetchAll();
      } else {
        toast.error(res.message || `Failed: ${res.reason ?? "unknown"}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCallingNext(false);
    }
  };

  const skip = async (id: string) => {
    setSkipping(id);
    try {
      const res = await callAction("token_skip", { token_id: id });
      if (res.ok) { toast.success("Token skipped."); refetchAll(); }
      else toast.error(res.message || `Failed: ${res.reason ?? "unknown"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSkipping(null);
    }
  };

  const openDisplay = () => window.open("/display", "_blank", "noopener");

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <TicketIcon className="size-6 text-primary" aria-hidden /> Queue
          </h1>
          <p className="text-sm text-muted-foreground">
            Today’s patient tokens · <span className="tabular">{today}</span> · Asia/Dubai
            <span className="ml-2 italic">Showing: {isDoctorOnly ? "my patients" : "all"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetchAll} className="min-h-10">
            <RefreshCcw className="size-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={openDisplay} className="min-h-10">
            <Monitor className="size-4 mr-1" /> Open display
          </Button>
          <Button onClick={() => setIssueOpen(true)} className="min-h-10">
            <Plus className="size-4 mr-1" /> Issue token
          </Button>
        </div>
      </div>

      {isDoctor && myDoctorRow && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneCall className="size-4 text-primary" /> My line
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Now serving</div>
                  {myServing ? (
                    <div className="flex items-baseline gap-3">
                      <span className="tabular text-5xl font-bold text-primary">T{myServing.token_number}</span>
                      <span className="text-lg">{myServing.patient_name ?? "—"}</span>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No one being served</div>
                  )}
                </div>
                <div className="hidden md:block h-12 w-px bg-border" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Waiting</div>
                  <div className="tabular text-3xl font-semibold">{myWaitingCount}</div>
                </div>
              </div>
              <Button
                size="lg"
                onClick={callNext}
                disabled={callingNext || (myWaitingCount === 0 && !myServing)}
                className="min-h-14 text-base"
              >
                {callingNext ? <Loader2 className="size-5 mr-2 animate-spin" /> : <PhoneCall className="size-5 mr-2" />}
                {myWaitingCount === 0 && !myServing ? "No one waiting" : myWaitingCount === 0 ? "Finish current" : "Next patient"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isDoctor && myServing?.patient_id && (
        <ConsultationPanel
          clinicId={clinicId}
          patientId={myServing.patient_id}
          patientName={myServing.patient_name}
          tz={clinic?.timezone || DUBAI_TZ}
          authorUserId={clinicUser!.auth_user_id}
          doctorName={clinicUser!.name}
          clinicName={clinic?.name ?? "Clinic"}
        />
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Queue board</h2>
        {tokensQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : Object.keys(byDoctor).length === 0 ? (
          <EmptyState title="No doctors configured" hint="Ask your platform admin to add doctors." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(byDoctor).map(([key, g]) => {
              const serving = g.tokens.find((t) => t.status === "serving") ?? null;
              const waiting = g.tokens.filter((t) => t.status === "waiting");
              const done = g.tokens.filter((t) => t.status === "done").length;
              const skipped = g.tokens.filter((t) => t.status === "skipped").length;
              return (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <span className="truncate">{g.name}</span>
                      <span className="text-xs text-muted-foreground tabular">
                        {waiting.length} waiting · {done} done · {skipped} skipped
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-md border border-border bg-muted/40 p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Now serving</div>
                      {serving ? (
                        <div className="flex items-baseline gap-3">
                          <span className="tabular text-4xl font-bold text-primary">T{serving.token_number}</span>
                          <span className="truncate">{serving.patient_name ?? "—"}</span>
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-sm">—</div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Waiting</div>
                      {waiting.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No one waiting.</div>
                      ) : (
                        <ul className="divide-y divide-border">
                          {waiting.map((t) => (
                            <li key={t.id} className="flex items-center justify-between py-2 gap-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="tabular text-lg font-semibold text-primary w-12">T{t.token_number}</span>
                                <span className="truncate">{t.patient_name ?? "—"}</span>
                                <StatusBadge tone="warning">waiting</StatusBadge>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => skip(t.id)}
                                disabled={skipping === t.id}
                                aria-label={`Skip token T${t.token_number}`}
                              >
                                {skipping === t.id ? <Loader2 className="size-4 animate-spin" /> : <SkipForward className="size-4" />}
                                <span className="ml-1">Skip</span>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <IssueTokenDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        clinicId={clinicId}
        doctors={doctors}
        onIssued={(t) => { setSlip(t); refetchAll(); }}
      />

      <SlipDialog
        token={slip}
        clinicName={clinic?.name ?? "Clinic"}
        onClose={() => setSlip(null)}
      />
    </div>
  );
}

/* ---------------- Issue Token Dialog ---------------- */

function IssueTokenDialog({
  open, onOpenChange, clinicId, doctors, onIssued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinicId: string;
  doctors: ClinicUser[];
  onIssued: (t: Token) => void;
}) {
  const [mode, setMode] = useState<"existing" | "walkin">("existing");
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [walkinName, setWalkinName] = useState("");
  const [service, setService] = useState<string>("");
  const [doctorUserId, setDoctorUserId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const servicesQ = useQuery({
    queryKey: ["clinic-services", clinicId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics").select("services").eq("id", clinicId).maybeSingle();
      if (error) throw error;
      const raw = (data?.services ?? []) as unknown;
      return Array.isArray(raw) ? (raw as ClinicService[]) : [];
    },
  });

  const patientsQ = useQuery({
    queryKey: ["patients-search", clinicId, search],
    enabled: open && mode === "existing" && search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, name, channel, channel_user_id, language_preference")
        .eq("clinic_id", clinicId)
        .ilike("name", `%${search.trim()}%`)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Patient[];
    },
  });

  const reset = () => {
    setMode("existing"); setSearch(""); setPatientId(null);
    setWalkinName(""); setService(""); setDoctorUserId(""); setSubmitting(false);
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  const selectedPatient = patientsQ.data?.find((p) => p.id === patientId) ?? null;

  const submit = async () => {
    if (!doctorUserId) { toast.error("Choose a doctor."); return; }
    if (mode === "existing" && !patientId) { toast.error("Pick a patient."); return; }
    if (mode === "walkin" && !walkinName.trim()) { toast.error("Enter patient name."); return; }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        doctor_user_id: doctorUserId,
        service: service || null,
      };
      if (mode === "existing") payload.patient_id = patientId;
      else payload.name = walkinName.trim();

      const res = await callAction<{ ok: boolean; token?: Token; reason?: string; message?: string }>(
        "issue_token", payload,
      );
      if (res.ok && res.token) {
        toast.success(`Token T${res.token.token_number} issued.`);
        onIssued(res.token);
        close(false);
      } else {
        toast.error(res.message || `Failed: ${res.reason ?? "unknown"}`);
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
          <DialogTitle>Issue token</DialogTitle>
          <DialogDescription>Add a patient to the queue.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "existing" ? "default" : "outline"}
              onClick={() => setMode("existing")}
            >Existing patient</Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "walkin" ? "default" : "outline"}
              onClick={() => setMode("walkin")}
            >Walk-in</Button>
          </div>

          {mode === "existing" ? (
            <div className="space-y-2">
              <Label htmlFor="q-search">Search patient by name</Label>
              <Input
                id="q-search"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPatientId(null); }}
                placeholder="Type at least 2 characters…"
              />
              {selectedPatient && (
                <div className="text-sm text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{selectedPatient.name}</span>
                </div>
              )}
              {search.trim().length >= 2 && (
                <div className="max-h-44 overflow-auto rounded-md border border-border divide-y divide-border">
                  {patientsQ.isLoading ? (
                    <div className="p-3 text-sm text-muted-foreground">Searching…</div>
                  ) : !patientsQ.data?.length ? (
                    <div className="p-3 text-sm text-muted-foreground">No matches.</div>
                  ) : patientsQ.data.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => setPatientId(p.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-muted ${
                        patientId === p.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <span>{p.name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground tabular">{p.language_preference ?? ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="q-walkin">Walk-in name *</Label>
              <Input
                id="q-walkin"
                value={walkinName}
                onChange={(e) => setWalkinName(e.target.value)}
                placeholder="Full name"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Service (optional)</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="min-h-10">
                <SelectValue placeholder={servicesQ.isLoading ? "Loading…" : "Choose a service"} />
              </SelectTrigger>
              <SelectContent>
                {(servicesQ.data ?? []).map((s, i) => (
                  <SelectItem key={`${s.name}-${i}`} value={s.name}>
                    <span>{s.name}</span>
                    {s.duration_min && <span className="text-muted-foreground tabular ml-2">{s.duration_min}m</span>}
                  </SelectItem>
                ))}
                {!servicesQ.isLoading && !(servicesQ.data ?? []).length && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No services configured.</div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Doctor *</Label>
            <Select value={doctorUserId} onValueChange={setDoctorUserId}>
              <SelectTrigger className="min-h-10"><SelectValue placeholder="Choose a doctor" /></SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name ?? d.email ?? "Doctor"}
                    <span className="ml-2 text-xs text-muted-foreground capitalize">{d.role}</span>
                  </SelectItem>
                ))}
                {doctors.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No doctors found.</div>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
            Issue token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Print Slip ---------------- */

function SlipDialog({
  token, clinicName, onClose,
}: { token: Token | null; clinicName: string; onClose: () => void }) {
  const open = !!token;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="print-hide">
          <DialogTitle>Token issued</DialogTitle>
          <DialogDescription>Print the slip for the patient.</DialogDescription>
        </DialogHeader>
        {token && (
          <div className="print-slip rounded-md border border-border bg-card p-6 text-center">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{clinicName}</div>
            <div className="mt-3 tabular text-7xl font-bold text-primary">T{token.token_number}</div>
            <div className="mt-4 text-lg font-medium">{token.patient_name ?? "—"}</div>
            {token.service && <div className="text-sm text-muted-foreground">{token.service}</div>}
            {token.doctor_name && (
              <div className="mt-2 text-sm">Doctor: <span className="font-medium">{token.doctor_name}</span></div>
            )}
            <div className="mt-4 text-xs tabular text-muted-foreground">
              Issued {fmtDateTime(token.created_at, DUBAI_TZ)}
            </div>
          </div>
        )}
        <DialogFooter className="print-hide">
          <Button variant="ghost" onClick={onClose}>Done</Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4 mr-1" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Consultation Panel ---------------- */

function ConsultationPanel({
  clinicId, patientId, patientName, tz, authorUserId, doctorName, clinicName,
}: {
  clinicId: string;
  patientId: string;
  patientName: string | null;
  tz: string;
  authorUserId: string;
  doctorName: string | null;
  clinicName: string;
}) {
  const qc = useQueryClient();
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const historyQ = useQuery({
    queryKey: ["consult-history", clinicId, patientId],
    enabled: !!patientId,
    queryFn: async () => {
      const [appts, notes, rx] = await Promise.all([
        supabase.from("appointments").select("*").eq("clinic_id", clinicId).eq("patient_id", patientId).order("scheduled_at", { ascending: false }).limit(8),
        supabase.from("doctor_notes").select("*").eq("clinic_id", clinicId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(5),
        supabase.from("prescriptions").select("*").eq("clinic_id", clinicId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(5),
      ]);
      return {
        appts: (appts.data ?? []) as Appointment[],
        notes: (notes.data ?? []) as DoctorNote[],
        rx: (rx.data ?? []) as Prescription[],
      };
    },
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["consult-history", clinicId, patientId] });

  const saveNote = async () => {
    const note = noteDraft.trim();
    if (!note) return;
    setSavingNote(true);
    try {
      const { error } = await supabase.from("doctor_notes").insert({
        clinic_id: clinicId, patient_id: patientId, author_user_id: authorUserId, note,
      });
      if (error) throw error;
      toast.success("Note added.");
      setNoteDraft("");
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingNote(false);
    }
  };

  const appts = historyQ.data?.appts ?? [];
  const came = appts.filter((a) => a.attendance === "came").length;
  const noShow = appts.filter((a) => a.attendance === "no_show").length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span>
            With patient —{" "}
            <Link to="/patients/$id" params={{ id: patientId }} className="text-primary hover:underline">
              {patientName ?? "Patient"}
            </Link>
          </span>
          <span className="text-xs text-muted-foreground tabular font-normal">
            <span className="text-success">{came}</span> came · <span className="text-destructive">{noShow}</span> no-show
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add prescription</Label>
            <PrescriptionForm
              clinicId={clinicId}
              patientId={patientId}
              authorUserId={authorUserId}
              doctorName={doctorName}
              onSaved={refetch}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add note</Label>
            <Textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="Clinical note…" />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={saveNote} disabled={savingNote || !noteDraft.trim()} className="min-h-10">
                {savingNote ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</> : "Save note"}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Recent appointments</div>
            {appts.length === 0 ? (
              <div className="text-sm text-muted-foreground">None.</div>
            ) : (
              <ul className="space-y-2">
                {appts.map((a) => (
                  <li key={a.id} className="rounded-md border border-border p-2 text-xs space-y-1">
                    <div className="tabular text-muted-foreground">{fmtDateTime(a.scheduled_at, tz)}</div>
                    <div className="truncate">{a.reason ?? "—"}</div>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge tone={appointmentStatusTone(a.status)}>{a.status}</StatusBadge>
                      {a.attendance && <StatusBadge tone={attendanceTone(a.attendance)}>{a.attendance.replace("_", "-")}</StatusBadge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Recent doctor notes</div>
            {(historyQ.data?.notes ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">None.</div>
            ) : (
              <ul className="space-y-2">
                {historyQ.data!.notes.map((n) => (
                  <li key={n.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="tabular text-muted-foreground mb-1">{fmtDateTime(n.created_at, tz)}</div>
                    <div className="whitespace-pre-wrap">{n.note}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Recent prescriptions</div>
            {(historyQ.data?.rx ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">None.</div>
            ) : (
              <div className="space-y-2">
                {historyQ.data!.rx.map((r) => (
                  <PrescriptionCard
                    key={r.id}
                    rx={r}
                    clinicName={clinicName}
                    patientName={patientName}
                    tz={tz}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

