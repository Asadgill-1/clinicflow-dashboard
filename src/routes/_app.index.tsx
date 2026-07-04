import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, appointmentStatusTone } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import { fmtTime } from "@/lib/format";
import type { Appointment, Patient, Review } from "@/lib/types";
import { CalendarClock, UserPlus, UserX, CalendarCheck2, Star } from "lucide-react";

export const Route = createFileRoute("/_app/")({
  component: Overview,
});

// midnight-to-midnight of the CLINIC's day, as UTC instants — independent of the
// viewer's machine timezone (was browser-local; wrong day when viewed from abroad)
function startEndOfTodayInTZ(tz: string) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = +parts.find((p) => p.type === "year")!.value;
  const m = +parts.find((p) => p.type === "month")!.value;
  const d = +parts.find((p) => p.type === "day")!.value;
  const asUtc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const asTz = new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime();
  const offsetMs = asTz - asUtc; // e.g. Dubai = +4h
  const start = new Date(Date.UTC(y, m - 1, d) - offsetMs);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function Overview() {
  const { clinicUser, clinic } = useAuth();
  const tz = clinic?.timezone || "UTC";
  const clinicId = clinicUser!.clinic_id;
  const isDoctorOnly = clinicUser!.role === "doctor";

  const todayQ = useQuery({
    queryKey: ["overview", clinicId, "today", isDoctorOnly ? clinicUser!.id : "all"],
    queryFn: async () => {
      const { start, end } = startEndOfTodayInTZ(tz);
      // doctors see their own appointment numbers; owner/reception see the clinic's
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scoped = <T,>(q: T): T => (isDoctorOnly ? (q as any).eq("doctor_user_id", clinicUser!.id) : q) as T;
      const [todayAppts, weekNoShows, weekPatients, pending, ratings] = await Promise.all([
        scoped(
          supabase.from("appointments")
            .select("id, appointment_number, patient_id, reason, scheduled_at, duration_min, status, attendance, doctor")
            .eq("clinic_id", clinicId)
            .gte("scheduled_at", start).lt("scheduled_at", end),
        ).order("scheduled_at", { ascending: true }),
        scoped(
          supabase.from("appointments")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinicId)
            .eq("attendance", "no_show")
            .gte("scheduled_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        ),
        // NEW patients = registered in the last 7 days (was last_visit — that counted returning visitors)
        supabase.from("patients")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", clinicId)
          .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        // pending = requests whose time hasn't passed yet (stale old requests no longer inflate this)
        scoped(
          supabase.from("appointments")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinicId)
            .eq("status", "requested")
            .gte("scheduled_at", new Date().toISOString()),
        ),
        supabase.from("reviews")
          .select("rating")
          .eq("clinic_id", clinicId)
          .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
      ]);

      const appts = (todayAppts.data ?? []) as Appointment[];
      const patientIds = Array.from(new Set(appts.map((a) => a.patient_id)));
      let patientsById: Record<string, Patient> = {};
      if (patientIds.length) {
        const { data: p } = await supabase
          .from("patients").select("id, name, language_preference, status").in("id", patientIds);
        patientsById = Object.fromEntries(((p ?? []) as Patient[]).map((x) => [x.id, x]));
      }

      const ratingsArr = (ratings.data ?? []) as Pick<Review, "rating">[];
      const avg = ratingsArr.length
        ? ratingsArr.reduce((s, r) => s + (r.rating ?? 0), 0) / ratingsArr.length
        : null;

      return {
        appts, patientsById,
        kpis: {
          today: appts.length,
          pending: pending.count ?? 0,
          noShows: weekNoShows.count ?? 0,
          newPatients: weekPatients.count ?? 0,
          avgRating: avg,
        },
      };
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-muted-foreground">
            {new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: tz }).format(new Date())}
            {isDoctorOnly && <span className="ml-2 italic">Showing: my patients</span>}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Today's appointments" value={todayQ.data?.kpis.today} icon={<CalendarClock className="size-4" />} to="/appointments" />
        <Kpi label="Pending confirmations" value={todayQ.data?.kpis.pending} icon={<CalendarCheck2 className="size-4" />} to="/appointments" />
        <Kpi label="No-shows (7d)" value={todayQ.data?.kpis.noShows} icon={<UserX className="size-4" />} to="/appointments" />
        <Kpi label="New patients (7d)" value={todayQ.data?.kpis.newPatients} icon={<UserPlus className="size-4" />} to="/patients" />
        <Kpi
          label="Avg rating (30d)"
          value={todayQ.data?.kpis.avgRating == null ? "—" : todayQ.data.kpis.avgRating.toFixed(2)}
          icon={<Star className="size-4" />}
          to="/reviews"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Today's schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {todayQ.isLoading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : !todayQ.data?.appts.length ? (
            <EmptyState title="No appointments today" hint="When new appointments are booked, they appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {todayQ.data.appts.map((a) => {
                const p = todayQ.data!.patientsById[a.patient_id];
                return (
                  <li key={a.id} className="py-3 flex items-center gap-4">
                    <div className="tabular text-sm w-16">{fmtTime(a.scheduled_at, tz)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p?.name ?? "Unknown patient"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {a.reason ?? "—"} · {a.duration_min ?? "?"} min{a.doctor ? ` · ${a.doctor}` : ""}
                      </div>
                    </div>
                    <StatusBadge tone={appointmentStatusTone(a.status)}>{a.status}</StatusBadge>
                    {a.attendance && (
                      <StatusBadge tone={a.attendance === "came" ? "success" : "destructive"}>
                        {a.attendance.replace("_", "-")}
                      </StatusBadge>
                    )}
                    <span className="tabular text-xs text-muted-foreground hidden sm:inline">{a.appointment_number}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon, to }: { label: string; value: number | string | undefined; icon: React.ReactNode; to?: string }) {
  const card = (
    <Card className={to ? "transition-colors hover:border-primary/50 cursor-pointer h-full" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground text-xs">
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular">{value ?? "—"}</div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to as never} className="block">{card}</Link> : card;
}
