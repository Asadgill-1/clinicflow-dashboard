import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "destructive" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-foreground/80 border-border",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/30",
};

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function appointmentStatusTone(s: string): Tone {
  if (s === "confirmed") return "success";
  if (s === "cancelled") return "destructive";
  if (s === "requested") return "warning";
  return "neutral";
}

export function attendanceTone(a: string | null): Tone {
  if (a === "came") return "success";
  if (a === "no_show") return "destructive";
  return "neutral";
}

export function patientStatusTone(s: string | null): Tone {
  if (s === "active") return "success";
  if (s === "monitoring") return "warning";
  if (s === "blocked") return "destructive";
  if (s === "human_only") return "info";
  return "neutral";
}
