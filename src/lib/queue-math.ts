// Client-side mirror of the queue math in the backend repo's lib/core.ts
// (source of truth — keep in sync if the queue math changes there).

// mean consult minutes from done tokens; null when no usable pair.
// 240-min cap: one forgotten open consult must not triple everyone's estimate.
export function avgConsultMin(tokens: { called_at: string | null; done_at: string | null }[]): number | null {
  const durs = tokens
    .map((t) => t.called_at && t.done_at
      ? (new Date(t.done_at).getTime() - new Date(t.called_at).getTime()) / 60000 : null)
    .filter((d): d is number => d !== null && d > 0 && d <= 240);
  if (!durs.length) return null;
  return durs.reduce((a, b) => a + b, 0) / durs.length;
}

// wait estimate in minutes. servingElapsedMin null = nobody serving (no remainder term).
export function estWaitMin(ahead: number, avgMin: number, servingElapsedMin: number | null): number {
  const remainder = servingElapsedMin === null ? 0 : Math.min(Math.max(avgMin - servingElapsedMin, 0), avgMin);
  return ahead * avgMin + remainder;
}

// banner rule: current consult overran 1.5x the average (min 10-min grace)
export function runningBehind(avgMin: number, servingElapsedMin: number | null): boolean {
  return servingElapsedMin !== null && servingElapsedMin > Math.max(avgMin * 1.5, 10);
}
