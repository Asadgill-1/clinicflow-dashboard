import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/States";
import { Star } from "lucide-react";
import type { Appointment, Review } from "@/lib/types";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

type RangeKey = "30" | "90";
const DUBAI_TZ = "Asia/Dubai";

// Use semantic tokens via CSS variables (defined in styles.css)
const COLORS = {
  primary: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  destructive: "hsl(var(--destructive))",
  warning: "hsl(var(--warning))",
  muted: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
};

function ReportsPage() {
  const { clinicUser, hasRole } = useAuth();
  if (!hasRole("owner")) return <Navigate to="/" />;
  const clinicId = clinicUser!.clinic_id;

  const [range, setRange] = useState<RangeKey>("30");
  const days = range === "30" ? 30 : 90;
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }, [days]);

  const apptsQ = useQuery({
    queryKey: ["reports-appts", clinicId, days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, scheduled_at, status, attendance, reason")
        .eq("clinic_id", clinicId)
        .gte("scheduled_at", since)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });

  const reviewsQ = useQuery({
    queryKey: ["reports-reviews", clinicId, days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, rating, created_at")
        .eq("clinic_id", clinicId)
        .gte("created_at", since)
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Review[];
    },
  });

  const appts = apptsQ.data ?? [];

  // ---- Bookings over time (week buckets) ----
  const weekly = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 0; i < Math.ceil(days / 7); i++) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      const key = weekKey(d);
      buckets.set(key, 0);
    }
    for (const a of appts) {
      const k = weekKey(new Date(a.scheduled_at));
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([week, count]) => ({ week: formatWeek(week), count }));
  }, [appts, days]);

  // ---- Attendance breakdown ----
  const attendance = useMemo(() => {
    let came = 0, noShow = 0, unmarked = 0;
    for (const a of appts) {
      if (a.attendance === "came") came++;
      else if (a.attendance === "no_show") noShow++;
      else unmarked++;
    }
    return { came, noShow, unmarked, total: came + noShow + unmarked };
  }, [appts]);

  const noShowRate = attendance.came + attendance.noShow > 0
    ? Math.round((attendance.noShow / (attendance.came + attendance.noShow)) * 100)
    : 0;

  const attendanceData = [
    { name: "Came", value: attendance.came, fill: COLORS.success },
    { name: "No-show", value: attendance.noShow, fill: COLORS.destructive },
    { name: "Not marked", value: attendance.unmarked, fill: COLORS.muted },
  ].filter((d) => d.value > 0);

  // ---- Service mix ----
  const serviceMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of appts) {
      const k = (a.reason ?? "Unspecified").trim() || "Unspecified";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [appts]);

  // ---- Reviews ----
  const reviews = reviewsQ.data ?? [];
  const avgRating = reviews.length
    ? reviews.reduce((s, r) => s + (r.rating ?? 0), 0) / reviews.length
    : 0;

  const loading = apptsQ.isLoading || reviewsQ.isLoading;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">Bookings, attendance, services, and reviews ({DUBAI_TZ}).</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Range</span>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-[160px] min-h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi title="Appointments" value={appts.length} loading={loading} />
        <Kpi title="No-show rate" value={`${noShowRate}%`} loading={loading} tone={noShowRate >= 20 ? "warn" : "default"} />
        <Kpi title="Reviews" value={reviews.length} loading={loading} />
        <Kpi
          title="Avg. rating"
          value={reviews.length ? avgRating.toFixed(1) : "—"}
          loading={loading}
          suffix={reviews.length ? <Star className="size-4 text-warning" fill="currentColor" /> : null}
        />
      </div>

      {/* Bookings over time */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Bookings over time</CardTitle></CardHeader>
        <CardContent className="h-72">
          {loading ? <Skeleton className="h-full w-full" /> :
            !weekly.some((w) => w.count > 0) ? <EmptyState title="No bookings in this range" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weekly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
                  <XAxis dataKey="week" stroke={COLORS.muted} fontSize={12} />
                  <YAxis stroke={COLORS.muted} fontSize={12} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Line
                    name="Appointments / week"
                    type="monotone"
                    dataKey="count"
                    stroke={COLORS.primary}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attendance */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Attendance breakdown</CardTitle></CardHeader>
          <CardContent className="h-72">
            {loading ? <Skeleton className="h-full w-full" /> :
              attendance.total === 0 ? <EmptyState title="No appointments yet" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={attendanceData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                      label={(d) => `${d.name}: ${d.value}`}
                    >
                      {attendanceData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </CardContent>
        </Card>

        {/* Service mix */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Service mix (top 8)</CardTitle></CardHeader>
          <CardContent className="h-72">
            {loading ? <Skeleton className="h-full w-full" /> :
              serviceMix.length === 0 ? <EmptyState title="No services booked" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serviceMix} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
                    <XAxis type="number" stroke={COLORS.muted} fontSize={12} allowDecimals={false} />
                    <YAxis
                      type="category" dataKey="name" stroke={COLORS.muted} fontSize={12}
                      width={120}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar name="Appointments" dataKey="count" fill={COLORS.primary} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
          </CardContent>
        </Card>
      </div>

      {/* Reviews */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Reviews</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-16 w-full" /> :
            reviews.length === 0 ? <EmptyState title="No reviews in this range" /> : (
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <div className="text-xs text-muted-foreground">Average rating</div>
                  <div className="text-3xl font-semibold tabular flex items-center gap-2">
                    {avgRating.toFixed(2)}
                    <Star className="size-5 text-warning" fill="currentColor" />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Reviews collected</div>
                  <div className="text-3xl font-semibold tabular">{reviews.length}</div>
                </div>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  title, value, loading, suffix, tone,
}: {
  title: string;
  value: React.ReactNode;
  loading: boolean;
  suffix?: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : (
          <div className={`text-2xl font-semibold tabular flex items-center gap-1.5 mt-0.5 ${
            tone === "warn" ? "text-warning" : ""
          }`}>
            {value}{suffix}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "hsl(var(--card))",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  fontSize: 12,
};

function weekKey(d: Date): string {
  // Monday-start ISO week key as YYYY-MM-DD of that Monday
  const day = (d.getDay() + 6) % 7; // 0 = Mon
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function formatWeek(key: string): string {
  const d = new Date(key);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
