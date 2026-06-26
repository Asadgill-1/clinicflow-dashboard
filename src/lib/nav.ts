import type { Role } from "@/lib/types";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Star,
  Settings,
  BarChart3,
  UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  exact?: boolean;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, roles: ["owner", "doctor", "receptionist"], exact: true },
  { to: "/appointments", label: "Appointments", icon: CalendarDays, roles: ["owner", "doctor", "receptionist"] },
  { to: "/patients", label: "Patients", icon: Users, roles: ["owner", "doctor", "receptionist"] },
  { to: "/reviews", label: "Reviews", icon: Star, roles: ["owner", "doctor", "receptionist"] },
  { to: "/staff", label: "Staff", icon: UserCog, roles: ["owner"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["owner"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["owner"] },
];
