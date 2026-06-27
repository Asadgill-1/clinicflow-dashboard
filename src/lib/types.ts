export type Role = "owner" | "doctor" | "receptionist";

export interface Clinic {
  id: string;
  code: string;
  name: string;
  timezone: string | null;
  default_language: string | null;
  review_link: string | null;
  booking_link: string | null;
}

export interface ClinicUser {
  id: string;
  clinic_id: string;
  auth_user_id: string;
  role: Role;
  name: string | null;
  email: string | null;
}

export interface Patient {
  id: string;
  clinic_id: string;
  name: string | null;
  language_preference: string | null;
  pdpl_consent: boolean | null;
  is_minor: boolean | null;
  status: "active" | "monitoring" | "human_only" | "blocked" | null;
  last_visit: string | null;
  next_appointment: string | null;
  doctor_notes_summary: string | null;
  channel: string | null;
  channel_user_id: string | null;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_number: string | null;
  reason: string | null;
  scheduled_at: string;
  duration_min: number | null;
  status: "requested" | "confirmed" | "cancelled";
  attendance: "came" | "no_show" | null;
  attendance_marked_at: string | null;
  review_requested: boolean | null;
  doctor: string | null;
  patient_type: string | null;
}

export interface Conversation {
  id: string;
  clinic_id: string;
  patient_id: string;
  direction: "inbound" | "outbound";
  content: string | null;
  message_type: string | null;
  ai_action: string | null;
  created_at: string;
}

export interface DoctorNote {
  id: string;
  clinic_id: string;
  patient_id: string;
  author_user_id: string;
  note: string;
  created_at: string;
}

export interface Review {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  appointment_id: string | null;
  rating: number;
  comment: string | null;
  routed_private: boolean | null;
  created_at: string;
}

export interface Token {
  id: string;
  clinic_id: string;
  issued_date: string;
  token_number: number;
  patient_id: string | null;
  patient_name: string | null;
  service: string | null;
  doctor_user_id: string | null;
  doctor_name: string | null;
  room_number: string | null;
  status: "waiting" | "serving" | "done" | "skipped";
  created_at: string;
  called_at: string | null;
  done_at: string | null;
}

export interface ConsentLog {
  id: string;
  clinic_id: string;
  patient_id: string;
  status: string;
  source: string;
  created_at: string;
}
