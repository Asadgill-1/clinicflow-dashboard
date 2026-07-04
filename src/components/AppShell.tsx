import { Link, Outlet, useNavigate, useRouterState, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { LogOut, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { MfaButton, useMfaPending } from "@/components/MfaDialog";

export function AppShell() {
  const { status, clinicUser, clinic, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // deep-link guard: a 2FA-enrolled session that hasn't entered its code goes back to /auth
  const mfaPending = useMfaPending(status === "ready");

  if (status === "loading")
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (status === "signed_out") return <Navigate to="/auth" />;
  if (status === "no_access") return <Navigate to="/no-access" />;
  if (mfaPending) return <Navigate to="/auth" />;
  if (!clinicUser) return null;

  const items = NAV.filter((n) => n.roles.includes(clinicUser.role));

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2 text-primary">
            <Activity className="size-5" aria-hidden />
            <span className="font-semibold tracking-tight">Clinic Staff</span>
          </div>
          {clinic && (
            <div className="mt-2 text-xs text-muted-foreground truncate" title={clinic.name}>
              {clinic.name}
              {clinic.code && <span className="tabular ml-1">· {clinic.code}</span>}
            </div>
          )}
        </div>
        <nav className="flex-1 p-2" aria-label="Primary">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = item.exact
                ? pathname === item.to
                : pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm min-h-11 transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/80 hover:bg-muted hover:text-foreground",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="p-3 border-t border-sidebar-border text-xs text-muted-foreground">
          Role: <span className="capitalize font-medium text-foreground">{clinicUser.role}</span>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="md:hidden text-primary"><Activity className="size-5" /></span>
            <h1 className="truncate text-sm md:text-base font-medium">
              {clinic?.name ?? "Clinic"}
              {clinic?.timezone && (
                <span className="ml-2 text-xs text-muted-foreground tabular">{clinic.timezone}</span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block leading-tight">
              <div className="text-sm font-medium">{clinicUser.name ?? clinicUser.email}</div>
              <div className="text-xs text-muted-foreground capitalize">{clinicUser.role}</div>
            </div>
            <MfaButton />
            <Button variant="outline" size="sm" onClick={handleSignOut} className="min-h-9">
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="md:hidden border-b border-border bg-card overflow-x-auto" aria-label="Primary mobile">
          <ul className="flex gap-1 px-2 py-2">
            {items.map((item) => {
              const active = item.exact
                ? pathname === item.to
                : pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap",
                      active ? "bg-primary/10 text-primary font-medium" : "text-foreground/80 hover:bg-muted",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1 p-4 md:p-6 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
