import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Token, ClinicUser } from "@/lib/types";

export const Route = createFileRoute("/display")({
  component: DisplayPage,
});

const DUBAI_TZ = "Asia/Dubai";

function todayInDubai(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DUBAI_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}

function DisplayPage() {
  const { status, clinicUser, clinic } = useAuth();
  const qc = useQueryClient();

  if (status === "loading")
    return <div className="min-h-screen grid place-items-center text-2xl text-muted-foreground">Loading…</div>;
  if (status === "signed_out") return <Navigate to="/auth" />;
  if (status === "no_access") return <Navigate to="/no-access" />;
  if (!clinicUser) return null;

  return <DisplayInner clinicId={clinicUser.clinic_id} clinicName={clinic?.name ?? "Clinic"} qcRef={qc} />;
}

function DisplayInner({
  clinicId, clinicName, qcRef,
}: { clinicId: string; clinicName: string; qcRef: ReturnType<typeof useQueryClient> }) {
  const today = todayInDubai();

  const tokensQ = useQuery({
    queryKey: ["display-tokens", clinicId, today],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tokens")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("issued_date", today)
        .order("token_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Token[];
    },
  });

  const doctorsQ = useQuery({
    queryKey: ["display-doctors", clinicId],
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

  useEffect(() => {
    const channel = supabase
      .channel(`display-tokens-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tokens", filter: `clinic_id=eq.${clinicId}` },
        () => qcRef.invalidateQueries({ queryKey: ["display-tokens", clinicId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clinicId, qcRef]);

  const tokens = tokensQ.data ?? [];
  const doctors = doctorsQ.data ?? [];

  const rows = useMemo(() => {
    const map = new Map<string, { name: string; serving: Token | null; waiting: number }>();
    for (const d of doctors) {
      map.set(d.id, { name: d.name ?? d.email ?? "Doctor", serving: null, waiting: 0 });
    }
    for (const t of tokens) {
      const key = t.doctor_user_id ?? "_unassigned";
      if (!map.has(key)) map.set(key, { name: t.doctor_name ?? "Doctor", serving: null, waiting: 0 });
      const e = map.get(key)!;
      if (t.status === "serving") e.serving = t;
      if (t.status === "waiting") e.waiting += 1;
    }
    return Array.from(map.values());
  }, [tokens, doctors]);

  return (
    <div className="min-h-screen bg-background text-foreground p-8 md:p-12">
      <div className="flex items-baseline justify-between flex-wrap gap-4 mb-10">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">{clinicName}</h1>
        <div className="text-xl md:text-2xl tabular text-muted-foreground">{today} · Asia/Dubai</div>
      </div>

      {rows.length === 0 ? (
        <div className="text-3xl text-muted-foreground text-center py-20">No tokens issued today.</div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="rounded-xl border-2 border-border bg-card p-8 md:p-10"
              aria-label={`Doctor ${r.name}`}
            >
              <div className="text-2xl md:text-3xl font-semibold truncate">{r.name}</div>
              <div className="mt-2 text-base md:text-lg uppercase tracking-widest text-muted-foreground">Now serving</div>
              {r.serving ? (
                <div className="mt-4 flex items-baseline gap-6 flex-wrap">
                  <span className="tabular text-[8rem] md:text-[10rem] leading-none font-black text-primary">
                    T{r.serving.token_number}
                  </span>
                  <span className="text-3xl md:text-4xl font-medium truncate">
                    {r.serving.patient_name ?? "—"}
                  </span>
                </div>
              ) : (
                <div className="mt-4 text-5xl text-muted-foreground">—</div>
              )}
              <div className="mt-6 text-xl md:text-2xl text-muted-foreground tabular">
                {r.waiting} waiting
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
