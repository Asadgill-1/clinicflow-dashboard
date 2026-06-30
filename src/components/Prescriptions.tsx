import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import type { Prescription, PrescriptionItem } from "@/lib/types";

type Row = { drug: string; dose: string; frequency: string; duration: string };

const emptyRow = (): Row => ({ drug: "", dose: "", frequency: "", duration: "" });

export function PrescriptionForm({
  clinicId,
  patientId,
  authorUserId,
  doctorName,
  appointmentId,
  onSaved,
}: {
  clinicId: string;
  patientId: string;
  authorUserId: string;
  doctorName: string | null;
  appointmentId?: string | null;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const add = () => setRows((r) => [...r, emptyRow()]);
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    const items: PrescriptionItem[] = rows
      .filter((r) => r.drug.trim())
      .map((r) => ({
        drug: r.drug.trim(),
        dose: r.dose.trim() || null,
        frequency: r.frequency.trim() || null,
        duration: r.duration.trim() || null,
      }));
    if (items.length === 0) {
      toast.error("Add at least one medication.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("prescriptions").insert({
        clinic_id: clinicId,
        patient_id: patientId,
        author_user_id: authorUserId,
        doctor_name: doctorName,
        appointment_id: appointmentId ?? null,
        items,
        body: notes.trim() || null,
      });
      if (error) throw error;
      toast.success("Prescription saved.");
      setRows([emptyRow()]);
      setNotes("");
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-start">
            <Input
              className="col-span-12 md:col-span-4"
              placeholder="Drug *"
              value={row.drug}
              onChange={(e) => update(i, { drug: e.target.value })}
            />
            <Input
              className="col-span-4 md:col-span-2"
              placeholder="Dose"
              value={row.dose}
              onChange={(e) => update(i, { dose: e.target.value })}
            />
            <Input
              className="col-span-4 md:col-span-3"
              placeholder="Frequency"
              value={row.frequency}
              onChange={(e) => update(i, { frequency: e.target.value })}
            />
            <Input
              className="col-span-3 md:col-span-2"
              placeholder="Duration"
              value={row.duration}
              onChange={(e) => update(i, { duration: e.target.value })}
            />
            <div className="col-span-1 flex justify-end">
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(i)}
                  aria-label="Remove medication"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="size-3.5 mr-1" /> Add medication
      </Button>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Notes / instructions
        </Label>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional instructions for the patient…"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="min-h-10">
          {saving ? (
            <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</>
          ) : (
            "Save prescription"
          )}
        </Button>
      </div>
    </div>
  );
}

export function PrescriptionCard({
  rx,
  clinicName,
  patientName,
  tz,
}: {
  rx: Prescription;
  clinicName: string;
  patientName: string | null;
  tz: string;
}) {
  const [printOpen, setPrintOpen] = useState(false);
  const items = Array.isArray(rx.items) ? rx.items : [];
  const cell = (v: string | null | undefined) =>
    v && v.toString().trim() ? v : <span className="text-muted-foreground">—</span>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-start justify-between gap-2 font-normal">
          <div className="space-y-0.5">
            <div className="tabular text-xs text-muted-foreground">
              {fmtDateTime(rx.created_at, tz)}
            </div>
            {rx.doctor_name && (
              <div className="text-sm font-medium">Dr. {rx.doctor_name}</div>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPrintOpen(true)}
            className="min-h-8"
          >
            <Printer className="size-3.5 mr-1.5" /> Print
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No medications listed.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Drug</th>
                  <th className="py-1.5 pr-3 font-medium">Dose</th>
                  <th className="py-1.5 pr-3 font-medium">Frequency</th>
                  <th className="py-1.5 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{cell(it.drug)}</td>
                    <td className="py-1.5 pr-3 tabular">{cell(it.dose)}</td>
                    <td className="py-1.5 pr-3">{cell(it.frequency)}</td>
                    <td className="py-1.5 tabular">{cell(it.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rx.body && (
          <div className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-2">{rx.body}</div>
        )}
      </CardContent>

      <RxPrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        rx={rx}
        clinicName={clinicName}
        patientName={patientName}
        tz={tz}
      />
    </Card>
  );
}

export function RxPrintDialog({
  open, onClose, rx, clinicName, patientName, tz,
}: {
  open: boolean;
  onClose: () => void;
  rx: Prescription;
  clinicName: string;
  patientName: string | null;
  tz: string;
}) {
  const items = Array.isArray(rx.items) ? rx.items : [];
  const cell = (v: string | null | undefined) => (v && v.toString().trim() ? v : "—");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="print-hide">
          <DialogTitle>Prescription</DialogTitle>
          <DialogDescription>Print the slip for the patient.</DialogDescription>
        </DialogHeader>
        <div className="print-slip rounded-md border border-border bg-card p-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground text-center">
            {clinicName}
          </div>
          <div className="mt-2 text-2xl font-bold text-center">Prescription</div>
          <div className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
            <div className="text-muted-foreground">Patient</div>
            <div className="font-medium">{patientName ?? "—"}</div>
            <div className="text-muted-foreground">Date</div>
            <div className="tabular">{fmtDateTime(rx.created_at, tz)}</div>
            <div className="text-muted-foreground">Doctor</div>
            <div className="font-medium">{rx.doctor_name ? `Dr. ${rx.doctor_name}` : "—"}</div>
          </div>

          <table className="w-full mt-4 text-sm border-t border-border">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">Drug</th>
                <th className="py-2 pr-3 font-medium">Dose</th>
                <th className="py-2 pr-3 font-medium">Frequency</th>
                <th className="py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} className="py-3 text-muted-foreground">No medications listed.</td></tr>
              ) : items.map((it, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-3 font-medium">{cell(it.drug)}</td>
                  <td className="py-2 pr-3 tabular">{cell(it.dose)}</td>
                  <td className="py-2 pr-3">{cell(it.frequency)}</td>
                  <td className="py-2 tabular">{cell(it.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {rx.body && (
            <div className="mt-4 text-sm">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Notes
              </div>
              <div className="whitespace-pre-wrap">{rx.body}</div>
            </div>
          )}
        </div>
        <DialogFooter className="print-hide">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4 mr-1" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
