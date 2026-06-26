import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === "ready") return <Navigate to="/overview" />;
  if (status === "no_access") return <Navigate to="/no-access" />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) setError(error);
    else navigate({ to: "/overview" });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="inline-flex items-center gap-2 text-primary">
            <Activity className="size-6" aria-hidden />
            <span className="font-semibold tracking-tight">Clinic Staff</span>
          </div>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>Use your clinic email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && (
              <div role="alert" className="text-sm text-destructive">{error}</div>
            )}
            <Button type="submit" className="w-full min-h-11" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
