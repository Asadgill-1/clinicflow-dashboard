// Optional TOTP two-factor auth (Supabase MFA).
//  - MfaButton: header control — enroll (QR + confirm code), status, disable.
//  - MfaLoginStep: the code prompt shown at sign-in when a factor is enrolled.
//  - useMfaPending: gate hook — true while a signed-in session still owes its TOTP code.
// ponytail: UI-level enforcement only; add AAL2 checks in RLS if stolen-token risk matters.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";

type Factor = { id: string; status: string };

export function useMfaPending(sessionExists: boolean): boolean | null {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (!sessionExists) {
      setPending(null);
      return;
    }
    let alive = true;
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (alive) setPending(!!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2");
    });
    return () => {
      alive = false;
    };
  }, [sessionExists]);
  return pending;
}

export async function verifyMfaCode(code: string): Promise<string | null> {
  const { data: fs, error: fErr } = await supabase.auth.mfa.listFactors();
  if (fErr) return fErr.message;
  const totp = (fs?.totp ?? []) as Factor[];
  const f = totp.find((x) => x.status === "verified") ?? totp[0];
  if (!f) return "No authenticator enrolled on this account.";
  const ch = await supabase.auth.mfa.challenge({ factorId: f.id });
  if (ch.error) return ch.error.message;
  const v = await supabase.auth.mfa.verify({ factorId: f.id, challengeId: ch.data.id, code: code.trim() });
  return v.error ? v.error.message : null;
}

export function MfaLoginStep({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) return;
    setBusy(true);
    const err = await verifyMfaCode(code);
    setBusy(false);
    if (err) toast.error(err);
    else onVerified();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-sm">Enter the 6-digit code from your authenticator app.</div>
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoFocus
        placeholder="123456"
        className="text-center tracking-widest font-mono"
        aria-label="Authenticator code"
      />
      <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
      </Button>
    </form>
  );
}

export function MfaButton() {
  const [open, setOpen] = useState(false);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = (data?.totp ?? []) as Factor[];
    // clean up abandoned half-enrollments so re-enrolling never conflicts
    for (const f of totp) {
      if (f.status !== "verified") void supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    setFactors(totp.filter((f) => f.status === "verified"));
  };

  useEffect(() => {
    if (open) {
      void load();
      setQr(null);
      setSecret(null);
      setFactorId(null);
      setCode("");
    }
  }, [open]);

  const startEnroll = async () => {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `authenticator-${Date.now()}`,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
  };

  const confirmEnroll = async () => {
    if (!factorId) return;
    setBusy(true);
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) {
      setBusy(false);
      toast.error(ch.error.message);
      return;
    }
    const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
    setBusy(false);
    if (v.error) {
      toast.error(v.error.message);
      return;
    }
    toast.success("Two-factor authentication enabled");
    setQr(null);
    setSecret(null);
    setFactorId(null);
    setCode("");
    void load();
  };

  const disable = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Two-factor authentication disabled");
      void load();
    }
  };

  const enabled = factors.length > 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
        title="Two-factor authentication"
      >
        {enabled ? <ShieldCheck className="size-3.5" /> : <KeyRound className="size-3.5" />}
        <span className="hidden md:inline">2FA</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Two-factor authentication</DialogTitle>
            <DialogDescription>
              Adds a 6-digit authenticator code to your sign-in (Google Authenticator, 1Password, Authy…).
            </DialogDescription>
          </DialogHeader>
          {enabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-emerald-500">
                <ShieldCheck className="size-4" /> Enabled on this account.
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => disable(factors[0].id)}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Disable 2FA"}
              </Button>
            </div>
          ) : qr ? (
            <div className="space-y-3">
              <div className="text-sm">Scan with your authenticator app, then enter the code it shows.</div>
              <img src={qr} alt="TOTP QR code" className="mx-auto size-44 rounded bg-white p-2" />
              {secret && (
                <div className="text-center text-xs font-mono text-muted-foreground break-all">{secret}</div>
              )}
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="123456"
                className="text-center tracking-widest font-mono"
                aria-label="Authenticator code"
              />
              <Button className="w-full" disabled={busy || code.trim().length < 6} onClick={confirmEnroll}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Confirm"}
              </Button>
            </div>
          ) : (
            <Button onClick={startEnroll} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Enable 2FA"}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
