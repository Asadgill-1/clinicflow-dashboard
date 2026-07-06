import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { avgConsultMin, estWaitMin, runningBehind } from "@/lib/queue-math";
import type { Token } from "@/lib/types";

export const Route = createFileRoute("/display")({
  component: DisplayPage,
});

const DUBAI_TZ = "Asia/Dubai";

function todayInTz(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function DisplayPage() {
  const { status, clinicUser, clinic } = useAuth();
  const qc = useQueryClient();

  if (status === "loading")
    return (
      <div className="dark min-h-screen bg-background text-foreground grid place-items-center text-3xl text-muted-foreground">
        Loading…
      </div>
    );
  if (status === "signed_out")
    return (
      <div className="dark min-h-screen bg-background text-foreground grid place-items-center p-10 text-center">
        <div>
          <div className="text-4xl font-semibold mb-3">Sign in on this screen first</div>
          <div className="text-xl text-muted-foreground">
            Open the dashboard, sign in, then return to /display on this TV.
          </div>
        </div>
      </div>
    );
  if (status === "no_access") return <Navigate to="/no-access" />;
  if (!clinicUser) return null;

  return (
    <DisplayInner
      clinicId={clinicUser.clinic_id}
      clinicName={clinic?.name ?? "Clinic"}
      tz={clinic?.timezone || DUBAI_TZ}
      qcRef={qc}
    />
  );
}

function DisplayInner({
  clinicId, clinicName, tz, qcRef,
}: {
  clinicId: string;
  clinicName: string;
  tz: string;
  qcRef: ReturnType<typeof useQueryClient>;
}) {
  const today = todayInTz(tz);

  const tokensQ = useQuery({
    queryKey: ["display-tokens", clinicId, today],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tokens")
        .select("token_number, room_number, doctor_name, doctor_user_id, status, created_at, called_at, done_at")
        .eq("clinic_id", clinicId)
        .eq("issued_date", today)
        .order("token_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<Pick<Token, "token_number" | "room_number" | "doctor_name" | "doctor_user_id" | "status" | "created_at" | "called_at" | "done_at">>;
    },
  });

  // fallback avg for a line with no completed consults yet
  const slotQ = useQuery({
    queryKey: ["display-slot-min", clinicId],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("clinics").select("default_slot_min").eq("id", clinicId).maybeSingle();
      return data?.default_slot_min ?? 15;
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

  // Live clock
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const clock = now.toLocaleTimeString("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const tokens = tokensQ.data ?? [];
  const serving = useMemo(
    () => tokens.filter((t) => t.status === "serving").sort((a, b) => a.token_number - b.token_number),
    [tokens],
  );
  const waiting = useMemo(
    () => tokens.filter((t) => t.status === "waiting").sort((a, b) => a.token_number - b.token_number),
    [tokens],
  );

  const waitingShown = waiting.slice(0, 12);
  const waitingMore = Math.max(0, waiting.length - waitingShown.length);

  // per-doctor-line queue stats: avg consult min, per-waiting-token position +
  // estimated wait, and whether any line is running behind. Pure math from the
  // token timestamps (mirrors the backend), re-evaluated on the 1s clock.
  const fallbackAvg = slotQ.data ?? 15;
  const lineStats = useMemo(() => {
    const byLine = new Map<string, typeof tokens>();
    for (const t of tokens) {
      const key = t.doctor_user_id ?? "__none__";
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key)!.push(t);
    }
    const avgByLine = new Map<string, number>();
    const waitByToken = new Map<number, { position: number; est: number }>();
    let behind = false;
    for (const [key, line] of byLine) {
      const avg = avgConsultMin(line.filter((t) => t.status === "done")) ?? fallbackAvg;
      avgByLine.set(key, avg);
      const srv = line.find((t) => t.status === "serving") ?? null;
      const elapsed = srv
        ? (srv.called_at ? Math.max(0, (now.getTime() - new Date(srv.called_at).getTime()) / 60000) : 0)
        : null;
      if (runningBehind(avg, elapsed)) behind = true;
      const lineWaiting = line.filter((t) => t.status === "waiting").sort((a, b) => a.token_number - b.token_number);
      lineWaiting.forEach((t, i) => {
        waitByToken.set(t.token_number, { position: i + 1, est: Math.round(estWaitMin(i, avg, elapsed)) });
      });
    }
    return { avgByLine, waitByToken, behind };
  }, [tokens, now, fallbackAvg]);

  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <style>{`
        @keyframes pulseRing {
          0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.55); }
          50%      { box-shadow: 0 0 0 18px hsl(var(--primary) / 0); }
        }
        .serve-pulse { animation: pulseRing 2.2s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .serve-pulse { animation: none; } }
      `}</style>

      {/* Top bar */}
      <header className="flex items-end justify-between gap-6 px-10 pt-8 pb-6 border-b border-border">
        <div>
          <div className="text-xs md:text-sm uppercase tracking-[0.3em] text-muted-foreground">
            Waiting room
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mt-1">{clinicName}</h1>
        </div>
        <div
          className="tabular text-5xl md:text-7xl font-semibold text-foreground leading-none"
          aria-label="Current time"
        >
          {clock}
        </div>
      </header>

      {/* Running-behind banner (display-only) */}
      {lineStats.behind && (
        <div className="px-10 py-3 bg-amber-500/15 border-b border-amber-500/40 text-amber-500 text-xl md:text-2xl font-medium text-center">
          Running a little behind schedule — thank you for your patience.
        </div>
      )}

      {/* Now serving */}
      <section className="flex-1 px-10 py-8 min-h-0">
        <div className="text-sm md:text-base uppercase tracking-[0.3em] text-muted-foreground mb-4">
          Now serving
        </div>

        {serving.length === 0 ? (
          <div className="grid place-items-center h-full">
            <div className="text-4xl md:text-6xl font-medium text-muted-foreground text-center">
              Please wait to be called
            </div>
          </div>
        ) : (
          <div
            className={`grid gap-6 ${
              serving.length === 1
                ? "grid-cols-1"
                : serving.length === 2
                ? "grid-cols-1 lg:grid-cols-2"
                : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            }`}
          >
            {serving.map((t, i) => (
              <article
                key={`${t.token_number}-${i}`}
                className="serve-pulse rounded-2xl border-2 border-primary/40 bg-primary/10 px-8 py-7"
                aria-label={`Now serving token ${t.token_number}, room ${t.room_number ?? "unassigned"}`}
              >
                <div className="flex items-center gap-6 flex-wrap">
                  <span className="tabular text-[7rem] md:text-[10rem] leading-none font-black text-primary">
                    #{t.token_number}
                  </span>
                  <span className="text-5xl md:text-7xl text-muted-foreground leading-none" aria-hidden>
                    →
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs md:text-sm uppercase tracking-[0.25em] text-muted-foreground">
                      Room
                    </span>
                    <span className="tabular text-6xl md:text-8xl font-bold leading-none">
                      {t.room_number || "—"}
                    </span>
                  </div>
                </div>
                {(t.doctor_name || lineStats.avgByLine.has(t.doctor_user_id ?? "__none__")) && (
                  <div className="mt-5 text-lg md:text-2xl text-muted-foreground truncate">
                    {t.doctor_name}
                    {lineStats.avgByLine.has(t.doctor_user_id ?? "__none__") && (
                      <span className="tabular">
                        {t.doctor_name ? " · " : ""}~{Math.round(lineStats.avgByLine.get(t.doctor_user_id ?? "__none__")!)} min per patient
                      </span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Waiting next */}
      <footer className="px-10 pb-8 pt-4 border-t border-border">
        <div className="text-sm md:text-base uppercase tracking-[0.3em] text-muted-foreground mb-3">
          Waiting next
        </div>
        {waiting.length === 0 ? (
          <div className="text-2xl md:text-3xl text-muted-foreground">No one waiting.</div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {waitingShown.map((t, i) => {
              const w = lineStats.waitByToken.get(t.token_number);
              return (
                <span
                  key={`${t.token_number}-${i}`}
                  className="tabular inline-flex items-baseline gap-2 rounded-xl border border-border bg-card px-5 py-3 text-2xl md:text-3xl font-semibold"
                >
                  <span className="text-primary">#{t.token_number}</span>
                  {t.room_number && (
                    <span className="text-muted-foreground text-xl md:text-2xl font-medium">
                      · Room {t.room_number}
                    </span>
                  )}
                  {w && (
                    <span className="text-muted-foreground text-xl md:text-2xl font-medium">
                      · ~{w.est} min
                    </span>
                  )}
                </span>
              );
            })}
            {waitingMore > 0 && (
              <span className="tabular inline-flex items-center rounded-xl border border-dashed border-border px-5 py-3 text-2xl md:text-3xl font-medium text-muted-foreground">
                +{waitingMore} more
              </span>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
