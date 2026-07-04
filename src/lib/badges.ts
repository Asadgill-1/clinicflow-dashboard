// "New prescriptions" attention marker — per-browser unread tracking.
// Reception sees a badge on Patients until they open the page; each device
// tracks its own last-seen so every staff member gets their own nudge.
// ponytail: localStorage, not a DB column — prescriptions stay write-once.

const KEY = (clinicId: string) => `rx_seen_${clinicId}`;

export function rxLastSeen(clinicId: string): string {
  if (typeof localStorage === "undefined") return new Date().toISOString();
  return localStorage.getItem(KEY(clinicId)) ?? new Date(Date.now() - 86400000).toISOString();
}

export function markRxSeen(clinicId: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY(clinicId), new Date().toISOString());
}
