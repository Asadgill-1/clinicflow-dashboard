import { SUPABASE_URL } from "./supabase";

/**
 * Typed action client for backend-side actions that message patients
 * (confirm/cancel/reschedule). Currently a placeholder — UI buttons
 * call this but are disabled with a tooltip until backend wiring lands.
 */
export const apiClient = {
  async action<T = unknown>(
    name: string,
    payload: Record<string, unknown>,
    accessToken?: string | null,
  ): Promise<T> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-handler`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ action: name, payload }),
    });
    if (!res.ok) throw new Error(`Action ${name} failed: ${res.status}`);
    return (await res.json()) as T;
  },
};
