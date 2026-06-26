import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Clinic, ClinicUser, Role } from "./types";

interface AuthState {
  status: "loading" | "signed_out" | "no_access" | "ready";
  session: Session | null;
  clinicUser: ClinicUser | null;
  clinic: Clinic | null;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    session: null,
    clinicUser: null,
    clinic: null,
  });

  const loadProfile = async (session: Session | null) => {
    if (!session) {
      setState({ status: "signed_out", session: null, clinicUser: null, clinic: null });
      return;
    }
    const { data: cu, error } = await supabase
      .from("clinic_users")
      .select("id, clinic_id, auth_user_id, role, name, email")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();
    if (error || !cu) {
      setState({ status: "no_access", session, clinicUser: null, clinic: null });
      return;
    }
    const { data: clinic } = await supabase
      .from("clinics")
      .select("id, code, name, timezone, default_language, review_link, booking_link")
      .eq("id", cu.clinic_id)
      .maybeSingle();
    setState({
      status: "ready",
      session,
      clinicUser: cu as ClinicUser,
      clinic: (clinic as Clinic) ?? null,
    });
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) loadProfile(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) loadProfile(session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    ...state,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    async refresh() {
      const { data } = await supabase.auth.getSession();
      await loadProfile(data.session);
    },
    hasRole(...roles) {
      return !!state.clinicUser && roles.includes(state.clinicUser.role);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
