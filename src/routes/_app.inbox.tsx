import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { StatusBadge, patientStatusTone } from "@/components/StatusBadge";
import { EmptyState } from "@/components/States";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtTime, fmtDateTime } from "@/lib/format";
import { callAction } from "@/lib/api-client";
import type { Conversation, Patient } from "@/lib/types";
import {
  MessagesSquare, RefreshCw, Send, UserCog2, Bot, User as UserIcon, Loader2, HandMetal,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inbox")({
  component: InboxPage,
});

type Filter = "all" | "human_only" | "needs_human";
const DUBAI_TZ = "Asia/Dubai";

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.round(d / 7)}w ago`;
}

interface Thread {
  patient_id: string;
  patient: Patient | null;
  last: Conversation;
  count: number;
}

function InboxPage() {
  const { clinicUser, clinic } = useAuth();
  const tz = clinic?.timezone || DUBAI_TZ;
  const clinicId = clinicUser!.clinic_id;
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const threadsQ = useQuery({
    queryKey: ["inbox-threads", clinicId, filter],
    queryFn: async (): Promise<Thread[]> => {
      const { data: msgs, error } = await supabase
        .from("conversations")
        .select("id, clinic_id, patient_id, direction, content, message_type, ai_action, created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const byPatient = new Map<string, Thread>();
      for (const m of (msgs ?? []) as Conversation[]) {
        const cur = byPatient.get(m.patient_id);
        if (!cur) {
          byPatient.set(m.patient_id, {
            patient_id: m.patient_id, patient: null, last: m, count: 1,
          });
        } else {
          cur.count += 1;
        }
      }
      const ids = Array.from(byPatient.keys());
      if (ids.length) {
        const { data: ps } = await supabase
          .from("patients")
          .select("id, name, status, language_preference, channel")
          .in("id", ids);
        for (const p of (ps ?? []) as Patient[]) {
          const t = byPatient.get(p.id);
          if (t) t.patient = p;
        }
      }
      let list = Array.from(byPatient.values());
      if (filter === "human_only") list = list.filter((t) => t.patient?.status === "human_only");
      else if (filter === "needs_human") list = list.filter((t) => t.patient?.status !== "human_only");
      list.sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());
      return list.slice(0, 50);
    },
  });

  // Auto-select first thread when list loads
  useEffect(() => {
    if (!selected && threadsQ.data && threadsQ.data.length > 0) {
      setSelected(threadsQ.data[0].patient_id);
    }
  }, [threadsQ.data, selected]);

  const threadQ = useQuery({
    queryKey: ["inbox-thread", clinicId, selected],
    enabled: !!selected,
    queryFn: async () => {
      const [conv, pat] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, clinic_id, patient_id, direction, content, message_type, ai_action, created_at")
          .eq("clinic_id", clinicId)
          .eq("patient_id", selected!)
          .order("created_at", { ascending: true })
          .limit(500),
        supabase
          .from("patients")
          .select("id, name, status, language_preference, channel, pdpl_consent, is_minor")
          .eq("id", selected!)
          .eq("clinic_id", clinicId)
          .maybeSingle(),
      ]);
      if (conv.error) throw conv.error;
      return {
        messages: (conv.data ?? []) as Conversation[],
        patient: (pat.data as Patient | null) ?? null,
      };
    },
  });

  const refetchAll = async () => {
    await qc.invalidateQueries({ queryKey: ["inbox-threads", clinicId] });
    if (selected) {
      await qc.refetchQueries({ queryKey: ["inbox-thread", clinicId, selected], exact: true });
    }
  };

  const takeover = useMutation({
    mutationFn: async (patient_id: string) => {
      const res = await callAction("takeover", { patient_id });
      if (!res.ok) throw new Error(res.message || `Takeover failed: ${JSON.stringify(res)}`);
      return res;
    },
    onSuccess: async () => {
      toast.success("You are now handling this thread.");
      await refetchAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handback = useMutation({
    mutationFn: async (patient_id: string) => {
      const res = await callAction("handback", { patient_id });
      if (!res.ok) throw new Error(res.message || `Handback failed: ${JSON.stringify(res)}`);
      return res;
    },
    onSuccess: async () => {
      toast.success("Handed back to the assistant.");
      await refetchAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const sendReply = useMutation({
    mutationFn: async ({ patient_id, text }: { patient_id: string; text: string }) => {
      const res = await callAction("staff_reply", { patient_id, text });
      if (!res.ok) throw new Error(res.message || `Send failed: ${JSON.stringify(res)}`);
      return res;
    },
    onSuccess: async () => {
      toast.success("Sent");
      setReply("");
      await refetchAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const threads = threadsQ.data ?? [];
  const active = threadQ.data;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">Patient conversations across this clinic.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show</span>
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-[180px] min-h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All threads</SelectItem>
              <SelectItem value="human_only">Being handled</SelectItem>
              <SelectItem value="needs_human">Needs human</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={refetchAll} className="min-h-10">
            <RefreshCw className={`size-4 mr-1 ${threadsQ.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Thread list */}
        <Card className="lg:max-h-[calc(100vh-220px)] overflow-hidden flex flex-col">
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <MessagesSquare className="size-4" /> Threads
              <span className="text-xs text-muted-foreground tabular ml-auto">{threads.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {threadsQ.isLoading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : !threads.length ? (
              <div className="p-4">
                <EmptyState title="No conversations" hint="Patient messages will appear here." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {threads.map((t) => {
                  const isActive = t.patient_id === selected;
                  return (
                    <li key={t.patient_id}>
                      <button
                        type="button"
                        onClick={() => setSelected(t.patient_id)}
                        className={`w-full text-left px-3 py-3 min-h-16 transition-colors ${
                          isActive ? "bg-primary/10" : "hover:bg-muted/60"
                        }`}
                        aria-current={isActive ? "true" : undefined}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate text-sm">
                            {t.patient?.name ?? "Unknown patient"}
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular shrink-0">
                            {relTime(t.last.created_at)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {t.last.direction === "outbound" ? "↗ " : "↙ "}
                          {t.last.content ?? "—"}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <StatusBadge tone={patientStatusTone(t.patient?.status ?? null)}>
                            {t.patient?.status ?? "—"}
                          </StatusBadge>
                          {t.patient?.language_preference && (
                            <span className="text-[10px] text-muted-foreground uppercase">
                              {t.patient.language_preference}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Thread view */}
        <Card className="lg:max-h-[calc(100vh-220px)] flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 grid place-items-center p-8">
              <EmptyState title="Select a conversation" hint="Pick a thread from the left." />
            </div>
          ) : threadQ.isLoading || !active ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (
            <ThreadView
              tz={tz}
              messages={active.messages}
              patient={active.patient}
              reply={reply}
              setReply={setReply}
              onTakeover={() => active.patient && takeover.mutate(active.patient.id)}
              takeoverPending={takeover.isPending}
              onHandback={() => active.patient && handback.mutate(active.patient.id)}
              handbackPending={handback.isPending}
              onSend={() => active.patient && reply.trim() &&
                sendReply.mutate({ patient_id: active.patient.id, text: reply.trim() })}
              sendPending={sendReply.isPending}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function ThreadView({
  tz, messages, patient, reply, setReply,
  onTakeover, takeoverPending,
  onHandback, handbackPending,
  onSend, sendPending,
}: {
  tz: string;
  messages: Conversation[];
  patient: Patient | null;
  reply: string;
  setReply: (v: string) => void;
  onTakeover: () => void;
  takeoverPending: boolean;
  onHandback: () => void;
  handbackPending: boolean;
  onSend: () => void;
  sendPending: boolean;
}) {
  const isHuman = patient?.status === "human_only";
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  return (
    <>
      <CardHeader className="pb-2 shrink-0 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{patient?.name ?? "Unknown patient"}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1">
              <StatusBadge tone={patientStatusTone(patient?.status ?? null)}>
                {patient?.status ?? "—"}
              </StatusBadge>
              {patient?.channel && (
                <span className="text-[10px] text-muted-foreground uppercase tabular">
                  {patient.channel}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isHuman ? (
              <Button onClick={onTakeover} disabled={takeoverPending} className="min-h-10">
                {takeoverPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <UserCog2 className="size-4 mr-1" />}
                Take over
              </Button>
            ) : (
              <Button variant="outline" onClick={onHandback} disabled={handbackPending} className="min-h-10">
                {handbackPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <HandMetal className="size-4 mr-1" />}
                Hand back
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
        {messages.length === 0 ? (
          <EmptyState title="No messages yet" />
        ) : messages.map((m) => {
          const inbound = m.direction === "inbound";
          return (
            <div
              key={m.id}
              className={`flex gap-2 ${inbound ? "justify-start" : "justify-end"}`}
            >
              {inbound && (
                <div className="shrink-0 size-8 rounded-full bg-muted grid place-items-center text-muted-foreground">
                  <UserIcon className="size-4" />
                </div>
              )}
              <div
                className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm ${
                  inbound
                    ? "bg-card border-border"
                    : "bg-primary/10 border-primary/30 text-foreground"
                }`}
              >
                <div className="whitespace-pre-wrap break-words">
                  {m.content ?? <em className="text-muted-foreground">No content</em>}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground tabular flex items-center gap-2">
                  <span>{fmtTime(m.created_at, tz)}</span>
                  <span title={fmtDateTime(m.created_at, tz)}>· {fmtDateTime(m.created_at, tz)}</span>
                  {m.message_type && <span>· {m.message_type}</span>}
                </div>
              </div>
              {!inbound && (
                <div className="shrink-0 size-8 rounded-full bg-primary/15 grid place-items-center text-primary">
                  <Bot className="size-4" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3 shrink-0 bg-card">
        {isHuman ? (
          <form
            onSubmit={(e) => { e.preventDefault(); if (reply.trim()) onSend(); }}
            className="flex items-end gap-2"
          >
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type a reply…"
              rows={2}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (reply.trim()) onSend();
                }
              }}
            />
            <Button type="submit" disabled={sendPending || !reply.trim()} className="min-h-10">
              {sendPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Send className="size-4 mr-1" />}
              Send
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground text-center">
            The assistant is handling this thread. Click <span className="font-medium text-foreground">Take over</span> to reply.
          </p>
        )}
      </div>
    </>
  );
}
