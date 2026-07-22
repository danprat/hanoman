// SPEC-293 · status publik tiket Help Center — SATU sumber kebenaran (dipakai server routes/help
// + services/ticket, dan klien untuk badge status turunan di detail triase). Diturunkan dari
// status tiket + stage Spec tertaut (ADR-0018/0019: nilai turunan lebih baik daripada state
// kembar yang bisa basi). Tanpa istilah/stage teknis internal.
export function publicStatus(ticketStatus: string, specStage?: string | null): string {
  if (ticketStatus === "rejected") return "Ditutup";
  if (ticketStatus !== "accepted") return "Sedang ditinjau"; // new / belum ditriase
  if (specStage === "done") return "Selesai";
  if (specStage === "executing") return "Sedang dikerjakan";
  return "Diterima"; // brainstorming/objective/spec-ready/planned/null
}
