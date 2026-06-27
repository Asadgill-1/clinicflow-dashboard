import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

interface ServiceRow { name: string; price: number | string; duration_min: number | string }

interface Hours {
  mon_thu?: string;
  fri?: string;
  sat?: string;
  sun?: string;
  [k: string]: string | undefined;
}

interface ClinicRow {
  id: string;
  code?: string | null;
  name?: string | null;
  address?: string | null;
  timezone?: string | null;
  default_language?: string | null;
  emergency_number?: string | null;
  dha_license?: string | null;
  booking_link?: string | null;
  review_link?: string | null;
  hours?: Hours | null;
  ramadan_hours?: Hours | null;
  services?: ServiceRow[] | null;
  accepted_insurance?: string[] | null;
  active_offers?: string[] | null;
  default_slot_min?: number | null;
  parallel_capacity?: number | null;
  status?: string | null;
  billing_status?: string | null;
}

const HOUR_KEYS: Array<keyof Hours> = ["mon_thu", "fri", "sat", "sun"];
const HOUR_LABELS: Record<string, string> = {
  mon_thu: "Mon–Thu",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function SettingsPage() {
  const { clinicUser, hasRole } = useAuth();
  if (!hasRole("owner")) return <Navigate to="/" />;
  const clinicId = clinicUser!.clinic_id;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["clinic-settings", clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("*").eq("id", clinicId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as ClinicRow | null;
    },
  });

  const [form, setForm] = useState<ClinicRow | null>(null);

  useEffect(() => {
    if (q.data && !form) setForm(normalize(q.data));
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: async (payload: Partial<ClinicRow>) => {
      const { error } = await supabase.from("clinics").update(payload).eq("id", clinicId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved.");
      qc.invalidateQueries({ queryKey: ["clinic-settings", clinicId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading || !form) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const update = <K extends keyof ClinicRow>(k: K, v: ClinicRow[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const updateHours = (which: "hours" | "ramadan_hours", key: keyof Hours, val: string) =>
    setForm((f) => {
      if (!f) return f;
      const cur = (f[which] ?? {}) as Hours;
      return { ...f, [which]: { ...cur, [key]: val } };
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const services = (form.services ?? []).map((s) => ({
      name: String(s.name ?? "").trim(),
      price: Number(s.price) || 0,
      duration_min: Number(s.duration_min) || 0,
    })).filter((s) => s.name);
    const faq = (form.faq ?? []).map((r) => ({
      question: String(r.question ?? "").trim(),
      answer: String(r.answer ?? "").trim(),
    })).filter((r) => r.question);
    const accepted_insurance = (form.accepted_insurance ?? []).map((x) => x.trim()).filter(Boolean);
    const active_offers = (form.active_offers ?? []).map((x) => x.trim()).filter(Boolean);

    save.mutate({
      name: form.name ?? null,
      address: form.address ?? null,
      timezone: form.timezone ?? null,
      default_language: form.default_language ?? null,
      emergency_number: form.emergency_number ?? null,
      dha_license: form.dha_license ?? null,
      booking_link: form.booking_link ?? null,
      review_link: form.review_link ?? null,
      hours: cleanHours(form.hours),
      ramadan_hours: cleanHours(form.ramadan_hours),
      services,
      faq,
      accepted_insurance,
      active_offers,
      default_slot_min: numOrNull(form.default_slot_min),
      parallel_capacity: numOrNull(form.parallel_capacity),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Clinic profile, hours, services, and more.</p>
        </div>
        <Button type="submit" disabled={save.isPending} className="min-h-10">
          {save.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
          Save changes
        </Button>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Clinic name"><Input value={form.name ?? ""} onChange={(e) => update("name", e.target.value)} /></Field>
          <Field label="Timezone"><Input value={form.timezone ?? ""} onChange={(e) => update("timezone", e.target.value)} placeholder="Asia/Dubai" /></Field>
          <Field label="Address" full>
            <Textarea value={form.address ?? ""} onChange={(e) => update("address", e.target.value)} rows={2} />
          </Field>
          <Field label="Default language"><Input value={form.default_language ?? ""} onChange={(e) => update("default_language", e.target.value)} placeholder="en, ar…" /></Field>
          <Field label="Emergency number"><Input value={form.emergency_number ?? ""} onChange={(e) => update("emergency_number", e.target.value)} inputMode="tel" /></Field>
          <Field label="DHA license"><Input value={form.dha_license ?? ""} onChange={(e) => update("dha_license", e.target.value)} /></Field>
          <Field label="Booking link"><Input value={form.booking_link ?? ""} onChange={(e) => update("booking_link", e.target.value)} type="url" /></Field>
          <Field label="Review link" full><Input value={form.review_link ?? ""} onChange={(e) => update("review_link", e.target.value)} type="url" /></Field>
        </CardContent>
      </Card>

      {/* Hours */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Hours</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <h3 className="text-sm font-medium mb-2">Regular</h3>
            <div className="space-y-2">
              {HOUR_KEYS.map((k) => (
                <div key={k} className="grid grid-cols-[110px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">{HOUR_LABELS[k as string]}</Label>
                  <Input
                    value={(form.hours ?? {})[k] ?? ""}
                    onChange={(e) => updateHours("hours", k, e.target.value)}
                    placeholder="09:00-21:00 or closed"
                    className="tabular"
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Ramadan</h3>
            <div className="space-y-2">
              {HOUR_KEYS.map((k) => (
                <div key={k} className="grid grid-cols-[110px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">{HOUR_LABELS[k as string]}</Label>
                  <Input
                    value={(form.ramadan_hours ?? {})[k] ?? ""}
                    onChange={(e) => updateHours("ramadan_hours", k, e.target.value)}
                    placeholder="10:00-16:00 or closed"
                    className="tabular"
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Services */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Services</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() =>
            setForm((f) => f && ({ ...f, services: [...(f.services ?? []), { name: "", price: 0, duration_min: 30 }] }))
          }><Plus className="size-3.5 mr-1" />Add service</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(form.services ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No services yet.</p>
          )}
          {(form.services ?? []).map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_120px_40px] gap-2 items-center">
              <Input
                value={s.name}
                onChange={(e) => setForm((f) => f && updateArrayItem(f, "services", i, { ...s, name: e.target.value }))}
                placeholder="Cleaning"
              />
              <Input
                value={String(s.price)}
                onChange={(e) => setForm((f) => f && updateArrayItem(f, "services", i, { ...s, price: e.target.value }))}
                placeholder="AED price"
                inputMode="decimal"
                className="tabular"
              />
              <Input
                value={String(s.duration_min)}
                onChange={(e) => setForm((f) => f && updateArrayItem(f, "services", i, { ...s, duration_min: e.target.value }))}
                placeholder="mins"
                inputMode="numeric"
                className="tabular"
              />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() =>
                setForm((f) => f && removeArrayItem(f, "services", i))}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          {(form.services ?? []).length > 0 && (
            <div className="grid grid-cols-[1fr_120px_120px_40px] gap-2 text-[11px] text-muted-foreground px-1">
              <span>Name</span><span>Price (AED)</span><span>Duration (m)</span><span />
            </div>
          )}
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">FAQ</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() =>
            setForm((f) => f && ({ ...f, faq: [...(f.faq ?? []), { question: "", answer: "" }] }))
          }><Plus className="size-3.5 mr-1" />Add Q&A</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {(form.faq ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No FAQs yet.</p>
          )}
          {(form.faq ?? []).map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_40px] gap-2 items-start">
              <div className="space-y-2">
                <Input
                  value={r.question}
                  onChange={(e) => setForm((f) => f && updateArrayItem(f, "faq", i, { ...r, question: e.target.value }))}
                  placeholder="Question"
                />
                <Textarea
                  value={r.answer}
                  onChange={(e) => setForm((f) => f && updateArrayItem(f, "faq", i, { ...r, answer: e.target.value }))}
                  placeholder="Answer"
                  rows={2}
                />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() =>
                setForm((f) => f && removeArrayItem(f, "faq", i))}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Insurance + Offers */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Insurance & Offers</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <StringList
            label="Accepted insurance"
            items={form.accepted_insurance ?? []}
            onChange={(v) => update("accepted_insurance", v)}
            placeholder="e.g. Daman"
          />
          <StringList
            label="Active offers"
            items={form.active_offers ?? []}
            onChange={(v) => update("active_offers", v)}
            placeholder="e.g. 20% off whitening in June"
          />
        </CardContent>
      </Card>

      {/* Scheduling */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Scheduling</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Default slot (minutes)">
            <Input
              type="number" min={5} step={5} className="tabular"
              value={form.default_slot_min ?? ""}
              onChange={(e) => update("default_slot_min", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Parallel capacity (concurrent appts)">
            <Input
              type="number" min={1} step={1} className="tabular"
              value={form.parallel_capacity ?? ""}
              onChange={(e) => update("parallel_capacity", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Billing (read-only) */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Billing</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Clinic status:</span>
            <StatusBadge tone={form.status === "active" ? "success" : "neutral"}>{form.status ?? "—"}</StatusBadge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Billing status:</span>
            <StatusBadge tone={form.billing_status === "active" ? "success" : "warning"}>{form.billing_status ?? "—"}</StatusBadge>
          </div>
          <p className="basis-full text-xs text-muted-foreground">
            Billing is managed by your platform administrator.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending} className="min-h-10">
          {save.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`space-y-1.5 ${full ? "md:col-span-2" : ""}`}>
      <Label className="text-sm text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function StringList({
  label, items, onChange, placeholder,
}: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm">{label}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
          <Plus className="size-3.5 mr-1" /> Add
        </Button>
      </div>
      {items.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_40px] gap-2 items-center">
            <Input
              value={v}
              onChange={(e) => {
                const next = items.slice(); next[i] = e.target.value; onChange(next);
              }}
              placeholder={placeholder}
            />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => {
              const next = items.slice(); next.splice(i, 1); onChange(next);
            }}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----- helpers ----- */

function normalize(row: ClinicRow): ClinicRow {
  return {
    ...row,
    hours: (row.hours ?? {}) as Hours,
    ramadan_hours: (row.ramadan_hours ?? {}) as Hours,
    services: Array.isArray(row.services) ? row.services : [],
    faq: Array.isArray(row.faq) ? row.faq : [],
    accepted_insurance: Array.isArray(row.accepted_insurance) ? row.accepted_insurance : [],
    active_offers: Array.isArray(row.active_offers) ? row.active_offers : [],
  };
}

function cleanHours(h: Hours | null | undefined): Hours {
  const out: Hours = {};
  for (const k of HOUR_KEYS) {
    const v = (h ?? {})[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function updateArrayItem<K extends keyof ClinicRow>(f: ClinicRow, key: K, i: number, item: unknown): ClinicRow {
  const arr = ((f[key] as unknown) as unknown[] | null) ?? [];
  const next = arr.slice();
  next[i] = item;
  return { ...f, [key]: next as unknown as ClinicRow[K] };
}

function removeArrayItem<K extends keyof ClinicRow>(f: ClinicRow, key: K, i: number): ClinicRow {
  const arr = ((f[key] as unknown) as unknown[] | null) ?? [];
  const next = arr.slice();
  next.splice(i, 1);
  return { ...f, [key]: next as unknown as ClinicRow[K] };
}
