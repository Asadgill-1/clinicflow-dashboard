import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/no-access")({
  component: NoAccess,
});

function NoAccess() {
  const { signOut, session } = useAuth();
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-muted">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">No clinic access</h1>
        <p className="text-muted-foreground">
          The account <span className="tabular">{session?.user.email}</span> is signed in but is not linked to any clinic.
          Ask your clinic owner to add you.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
          <Button asChild><Link to="/auth">Back to sign in</Link></Button>
        </div>
      </div>
    </div>
  );
}
