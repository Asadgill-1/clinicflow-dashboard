import { supabase } from "./supabase";

export interface ActionResponse<T = Record<string, unknown>> {
  ok: boolean;
  reason?: "taken" | "closed" | string;
  nextFree?: string;
  appointment_number?: string;
  message?: string;
  [k: string]: unknown;
}

/**
 * Invoke the `dashboard-api` Supabase Edge Function.
 * supabase-js automatically attaches the logged-in user's JWT.
 */
export async function callAction<T extends ActionResponse = ActionResponse>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("dashboard-api", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message || `Action ${action} failed`);
  return (data ?? { ok: false }) as T;
}

/**
 * Build an ISO 8601 datetime string in the Asia/Dubai offset (+04:00, no DST).
 * date: YYYY-MM-DD, time: HH:mm
 */
export function toDubaiISO(date: string, time: string): string {
  return `${date}T${time.length === 5 ? time + ":00" : time}+04:00`;
}
