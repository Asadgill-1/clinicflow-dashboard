import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
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
import type { Patient, Appointment, Conversation, DoctorNote, ConsentLog } from "@/lib/types";
import { ArrowLeft, MessageSquare, ArrowUpRight, ArrowDownLeft, ChevronDown, Pencil, Loader2 } from "lucide-react";
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
      const [p, appts, convs, notes, consents] = await Promise.all([
        supabase.from("patients").select("*").eq("id", id).eq("clinic_id", clinicId).maybeSingle(),
        supabase.from("appointments").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("scheduled_at", { ascending: false }).limit(50),
        supabase.from("conversations").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
        supabase.from("doctor_notes").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
        supabase.from("consent_logs").select("*").eq("patient_id", id).eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
      ]);
      return {
        patient: (p.data as Patient | null) ?? null,
        appts: (appts.data ?? []) as Appointment[],
        convs: (convs.data ?? []) as Conversation[],
        notes: (notes.data ?? []) as DoctorNote[],
        consents: (consents.data ?? []) as ConsentLog[],
      };
    },
  });

  const [noteDraft, setNoteDraft] = useState("");
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
            </div>
          </div>
          <div className="text-sm text-right">
            <div className="text-muted-foreground text-xs">Reliability</div>
            <div className="tabular">
              <span className="text-success">{came}</span> came ·{" "}
              <span className="text-destructive">{noShow}</span> no-show
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="bookings">
        <TabsList>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="notes">Doctor notes</TabsTrigger>
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
