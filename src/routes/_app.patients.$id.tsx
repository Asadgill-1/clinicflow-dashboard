import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { callAction } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge, patientStatusTone, appointmentStatusTone, attendanceTone } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import { fmtDateTime } from "@/lib/format";
import type { Patient, Appointment, Conversation, DoctorNote, ConsentLog, Prescription } from "@/lib/types";
import { ArrowLeft, MessageSquare, ArrowUpRight, ArrowDownLeft, ChevronDown, Pencil, Loader2, CalendarPlus, MessagesSquare } from "lucide-react";
import { PrescriptionForm, PrescriptionCard } from "@/components/Prescriptions";
import { NewAppointmentDialog, type DoctorRow } from "./_app.appointments";
import { toast } from "sonner";


export const Route = createFileRoute("/_app/patients/$id")({
  component: PatientDetail,
});

function PatientDetail() {
  const { id } = Route.useParams();
  const { clinicUser, clinic, hasRole } = useAuth();
  const tz = clinic?.timezone || "UTC";
  const clinicId = clinicUser!.clinic_id;
  const qc = useQueryClient();
  const canEditNotes = hasRole("doctor", "owner");

  const patientQ = useQuery({
    queryKey: ["patient", id],
    queryFn: async () => {
      const [p, appts, convs, notes, consents, rx] = await Promise.all([
        supabase.from("patients").select("*").eq("id", id).eq("clinic_id", clinicId).maybeSingle(),
        supabase.from("appointments").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("scheduled_at", { ascending: false }).limit(50),
        supabase.from("conversations").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
        supabase.from("doctor_notes").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
        supabase.from("consent_logs").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
        supabase.from("prescriptions").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
      ]);
      return {
        patient: (p.data as Patient | null) ?? null,
        appts: (appts.data ?? []) as Appointment[],
        convs: (convs.data ?? []) as Conversation[],
        notes: (notes.data ?? []) as DoctorNote[],
        consents: (consents.data ?? []) as ConsentLog[],
        prescriptions: (rx.data ?? []) as Prescription[],
      };
    },
  });

  const [noteDraft, setNoteDraft] = useState("");
  const [bookOpen, setBookOpen] = useState(false);

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
  const addNote = useMutation({
    mutationFn: async () => {
      const text = noteDraft.trim();
      if (!text) throw new Error("Note is empty.");
      const { error } = await supabase.from("doctor_notes").insert({
        clinic_id: clinicId,
        patient_id: id,
        author_user_id: clinicUser!.auth_user_id,
        note: text,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Note added.");
      setNoteDraft("");
      qc.invalidateQueries({ queryKey: ["patient", id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // PDPL consent from the front desk (walk-ins who consented on paper). Audited in consent_logs.
  const consentM = useMutation({
    mutationFn: (granted: boolean) => callAction("set_consent", { patient_id: id, granted }),
    onSuccess: (_d, granted) => {
      toast.success(granted ? "PDPL consent recorded." : "PDPL consent revoked.");
      qc.invalidateQueries({ queryKey: ["patient", id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (patientQ.isLoading) return <div className="space-y-3"><TableSkeleton rows={6} cols={4} /></div>;
  const p = patientQ.data?.patient;
  if (!p) return <EmptyState title="Patient not found" hint="They may belong to a different clinic." />;

  const came = patientQ.data!.appts.filter((a) => a.attendance === "came").length;
  const noShow = patientQ.data!.appts.filter((a) => a.attendance === "no_show").length;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/patients" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3" /> Back to patients
        </Link>
      </div>

      <Card>
        <CardContent className="p-5 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate">{p.name ?? "Unnamed"}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={patientStatusTone(p.status)}>{p.status ?? "—"}</StatusBadge>
              <StatusBadge tone="neutral">{p.language_preference ?? "—"}</StatusBadge>
              {p.is_minor && <StatusBadge tone="info">minor</StatusBadge>}
              {p.pdpl_consent
                ? <StatusBadge tone="success">PDPL consent</StatusBadge>
                : <StatusBadge tone="warning">No PDPL consent</StatusBadge>}
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={consentM.isPending}
                onClick={() => consentM.mutate(!p.pdpl_consent)}
              >
                {consentM.isPending
                  ? <Loader2 className="size-3 animate-spin" />
                  : p.pdpl_consent ? "Revoke consent" : "Record consent"}
              </Button>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="text-sm text-right">
              <div className="text-muted-foreground text-xs">Reliability</div>
              <div className="tabular">
                <span className="text-success">{came}</span> came ·{" "}
                <span className="text-destructive">{noShow}</span> no-show
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="min-h-9" onClick={() => setBookOpen(true)}>
                <CalendarPlus className="size-3.5 mr-1.5" /> Book appointment
              </Button>
              {p.channel === "telegram" && (
                <Button size="sm" variant="outline" className="min-h-9" asChild>
                  <Link to="/inbox" search={{ patient: p.id }}>
                    <MessagesSquare className="size-3.5 mr-1.5" /> Open chat
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <NewAppointmentDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        clinicId={clinicId}
        doctors={doctorsQ.data ?? []}
        fixedPatient={{ id: p.id, name: p.name }}
        onBooked={() => qc.invalidateQueries({ queryKey: ["patient", id] })}
      />

      <PatientInfoCard patient={p} clinicId={clinicId} />

      <Tabs defaultValue="bookings">

        <TabsList>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="notes">Doctor notes</TabsTrigger>
          <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
          <TabsTrigger value="consents">Consent audit</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Booking history</CardTitle></CardHeader>
            <CardContent>
              {patientQ.data!.appts.length === 0 ? (
                <EmptyState title="No appointments" />
              ) : (
                <ul className="divide-y divide-border">
                  {patientQ.data!.appts.map((a) => (
                    <li key={a.id} className="py-3 flex flex-wrap items-center gap-3">
                      <div className="tabular text-sm w-44">{fmtDateTime(a.scheduled_at, tz)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.reason ?? "—"}</div>
                        <div className="text-xs text-muted-foreground tabular">{a.appointment_number}</div>
                      </div>
                      <StatusBadge tone={appointmentStatusTone(a.status)}>{a.status}</StatusBadge>
                      {a.attendance && <StatusBadge tone={attendanceTone(a.attendance)}>{a.attendance.replace("_", "-")}</StatusBadge>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Recent messages</CardTitle></CardHeader>
            <CardContent>
              {patientQ.data!.convs.length === 0 ? (
                <EmptyState title="No messages" />
              ) : (
                <ul className="space-y-2">
                  {patientQ.data!.convs.map((c) => {
                    const inbound = c.direction === "inbound";
                    return (
                      <li
                        key={c.id}
                        className={`rounded-md border border-border p-3 text-sm ${inbound ? "bg-muted/40" : "bg-primary/5"}`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
                          <span className="inline-flex items-center gap-1">
                            {inbound
                              ? <><ArrowDownLeft className="size-3" /> inbound</>
                              : <><ArrowUpRight className="size-3" /> outbound</>}
                            {c.message_type && <> · {c.message_type}</>}
                          </span>
                          <span className="tabular">{fmtDateTime(c.created_at, tz)}</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{c.content ?? <em className="text-muted-foreground">No content</em>}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-4 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base inline-flex items-center gap-2">
                <MessageSquare className="size-4" /> Doctor notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEditNotes ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); addNote.mutate(); }}
                  className="space-y-2"
                >
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add a clinical note…"
                    rows={3}
                  />
                  <div className="flex justify-end">
                    <Button type="submit" disabled={addNote.isPending || !noteDraft.trim()} className="min-h-10">
                      {addNote.isPending ? "Saving…" : "Add note"}
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">Read-only. Doctors and owners can add notes.</p>
              )}
              {patientQ.data!.notes.length === 0 ? (
                <EmptyState title="No notes yet" />
              ) : (
                <ul className="space-y-2">
                  {patientQ.data!.notes.map((n) => (
                    <li key={n.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="text-xs text-muted-foreground tabular mb-1">{fmtDateTime(n.created_at, tz)}</div>
                      <div className="whitespace-pre-wrap">{n.note}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prescriptions" className="mt-4 space-y-3">
          {canEditNotes ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base inline-flex items-center gap-2">
                  <MessageSquare className="size-4" /> New prescription
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PrescriptionForm
                  clinicId={clinicId}
                  patientId={id}
                  authorUserId={clinicUser!.auth_user_id}
                  doctorName={clinicUser!.name}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["patient", id] })}
                />
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Read-only. Doctors and owners can add prescriptions.</p>
          )}
          {patientQ.data!.prescriptions.length === 0 ? (
            <EmptyState title="No prescriptions yet" />
          ) : (
            <div className="space-y-3">
              {patientQ.data!.prescriptions.map((r) => (
                <PrescriptionCard
                  key={r.id}
                  rx={r}
                  clinicName={clinic?.name ?? "Clinic"}
                  patientName={p.name}
                  tz={tz}
                />
              ))}
            </div>
          )}
        </TabsContent>


        <TabsContent value="consents" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Consent audit</CardTitle></CardHeader>
            <CardContent>
              {patientQ.data!.consents.length === 0 ? (
                <EmptyState title="No consent records" />
              ) : (
                <ul className="divide-y divide-border">
                  {patientQ.data!.consents.map((c) => (
                    <li key={c.id} className="py-2 flex items-center gap-3 text-sm">
                      <span className="tabular text-xs w-44 text-muted-foreground">{fmtDateTime(c.created_at, tz)}</span>
                      <StatusBadge tone={c.status === "granted" ? "success" : "neutral"}>{c.status}</StatusBadge>
                      <span className="text-muted-foreground">via {c.source}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PatientInfoCard({ patient, clinicId }: { patient: Patient; clinicId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);

  const initial = {
    phone: patient.phone ?? "",
    emirates_id: patient.emirates_id ?? "",
    date_of_birth: patient.date_of_birth ?? "",
    address: patient.address ?? "",
    medical_notes: patient.medical_notes ?? "",
  };
  const [form, setForm] = useState(initial);

  useEffect(() => {
    setForm({
      phone: patient.phone ?? "",
      emirates_id: patient.emirates_id ?? "",
      date_of_birth: patient.date_of_birth ?? "",
      address: patient.address ?? "",
      medical_notes: patient.medical_notes ?? "",
    });
  }, [patient.id, patient.phone, patient.emirates_id, patient.date_of_birth, patient.address, patient.medical_notes]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        phone: form.phone.trim() || null,
        emirates_id: form.emirates_id.trim() || null,
        date_of_birth: form.date_of_birth || null,
        address: form.address.trim() || null,
        medical_notes: form.medical_notes.trim() || null,
      };
      const { error } = await supabase
        .from("patients")
        .update(payload)
        .eq("id", patient.id)
        .eq("clinic_id", clinicId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Patient details saved");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const cancel = () => {
    setForm(initial);
    setEditing(false);
  };

  const display = (v: string | null | undefined) =>
    v && v.toString().trim() ? v : <span className="text-muted-foreground">—</span>;

  const summary = [patient.phone, patient.emirates_id].filter(Boolean).join(" · ") || "No contact details on file";

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CollapsibleTrigger className="group inline-flex items-center gap-2 text-left">
                <CardTitle className="text-base">Patient information</CardTitle>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
              </CollapsibleTrigger>
              {!open && (
                <div className="text-xs text-muted-foreground mt-1 tabular truncate">{summary}</div>
              )}
            </div>
            {!editing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); setEditing(true); setOpen(true); }}
                className="min-h-9"
              >
                <Pencil className="size-3.5 mr-1.5" /> Edit
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={save.isPending}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</> : "Save"}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-2">
            {!editing ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <Field label="Phone"><span className="tabular">{display(patient.phone)}</span></Field>
                <Field label="Emirates ID"><span className="tabular">{display(patient.emirates_id)}</span></Field>
                <Field label="Date of birth"><span className="tabular">{display(patient.date_of_birth)}</span></Field>
                <Field label="Address" full>{display(patient.address)}</Field>
                <Field label="Medical notes" full>
                  <span className="whitespace-pre-wrap">{display(patient.medical_notes)}</span>
                </Field>
              </dl>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <EditField label="Phone">
                  <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+971 …" />
                </EditField>
                <EditField label="Emirates ID">
                  <Input value={form.emirates_id} onChange={(e) => setForm({ ...form, emirates_id: e.target.value })} placeholder="784-…" />
                </EditField>
                <EditField label="Date of birth">
                  <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
                </EditField>
                <EditField label="Address" full>
                  <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </EditField>
                <EditField label="Medical notes" full>
                  <Textarea rows={3} value={form.medical_notes} onChange={(e) => setForm({ ...form, medical_notes: e.target.value })} />
                </EditField>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EditField({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
