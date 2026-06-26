import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { TableSkeleton, EmptyState } from "@/components/States";
import { fmtDateTime } from "@/lib/format";
import type { Review, Patient } from "@/lib/types";
import { Star } from "lucide-react";

export const Route = createFileRoute("/_app/reviews")({
  component: ReviewsPage,
});

function ReviewsPage() {
  const { clinicUser, clinic } = useAuth();
  const clinicId = clinicUser!.clinic_id;
  const tz = clinic?.timezone || "UTC";

  const q = useQuery({
    queryKey: ["reviews", clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, patient_id, appointment_id, rating, comment, routed_private, created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const reviews = (data ?? []) as Review[];
      const ids = Array.from(new Set(reviews.map((r) => r.patient_id).filter(Boolean) as string[]));
      let patientsById: Record<string, Patient> = {};
      if (ids.length) {
        const { data: p } = await supabase.from("patients").select("id, name").in("id", ids);
        patientsById = Object.fromEntries(((p ?? []) as Patient[]).map((x) => [x.id, x]));
      }
      return { reviews, patientsById };
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground">Patient feedback and follow-up flags.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">All reviews</CardTitle></CardHeader>
        <CardContent>
          {q.isLoading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : !q.data?.reviews.length ? (
            <EmptyState title="No reviews yet" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rating</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Follow-up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.reviews.map((r) => {
                    const p = r.patient_id ? q.data!.patientsById[r.patient_id] : null;
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/40">
                        <TableCell>
                          <span className="inline-flex items-center gap-1 tabular">
                            <Star className="size-3.5 text-warning" />
                            {r.rating}
                          </span>
                        </TableCell>
                        <TableCell>
                          {p
                            ? <Link to="/patients/$id" params={{ id: p.id }} className="hover:underline">{p.name ?? "Unnamed"}</Link>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="max-w-[400px]">
                          <span className="line-clamp-2 text-sm">{r.comment ?? <em className="text-muted-foreground">No comment</em>}</span>
                        </TableCell>
                        <TableCell className="tabular text-sm">{fmtDateTime(r.created_at, tz)}</TableCell>
                        <TableCell>
                          {r.routed_private
                            ? <StatusBadge tone="destructive">Needs private follow-up</StatusBadge>
                            : <StatusBadge tone="neutral">—</StatusBadge>}
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
    </div>
  );
}
