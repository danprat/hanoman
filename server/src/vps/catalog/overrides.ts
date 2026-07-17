// SPEC-220 · metadata hanoman per item katalog. Katalog mentah (catalog.data.ts) di-generate
// dari rujukan; DI SINI kita tentukan mode/severity/probe/remediable untuk item yang hanoman
// audit atau remediasi. Default (tak tercantum) = INFO + severity dari level (lihat catalog.ts).
import type { Mode, Severity } from "./catalog";

// Seksi app-layer: item-nya sering N/A pada host tanpa stack tsb (aaPanel/web/DB/SSL).
// v1 TIDAK auto-exclude — hanya hint UI "kemungkinan N/A" (penandaan N/A tetap manual).
export const APP_LAYER_SECTIONS = new Set(["aapanel", "webserver", "database", "ssl"]);

type Ov = { mode?: Mode; severity?: Severity; probe?: boolean; remediable?: boolean };

// AUTO   = diaudit + boleh di-apply idempoten & anti-lockout (remediate.sh).
// AUDIT  = diaudit (probe), remediasi MANUAL — termasuk item berisiko-lockout (AC-16).
// remediable HANYA untuk AUTO.
export const OVERRIDES: Record<string, Ov> = {
  // --- firewall
  "fw-b1": { mode: "AUTO", severity: "critical", probe: true, remediable: true }, // enable ufw/firewalld default-deny
  "fw-b3": { mode: "AUDIT", severity: "medium", probe: true },                    // block ICMP (probe icmp_echo_ignore_all) — remediasi manual
  // --- IDS / fail2ban
  "ids-b1": { mode: "AUTO", severity: "high", probe: true, remediable: true },    // fail2ban
  // --- system updates
  "sys-b1": { mode: "AUTO", severity: "high", probe: true, remediable: true },    // auto security update
  // --- kernel sysctl (aman, idempoten, persist via /etc/sysctl.d)
  "ker-b1": { mode: "AUTO", severity: "medium", probe: true, remediable: true },  // ip_forward=0
  "ker-b2": { mode: "AUTO", severity: "medium", probe: true, remediable: true },  // tcp_syncookies=1
  "ker-b3": { mode: "AUTO", severity: "medium", probe: true, remediable: true },  // accept_source_route=0
  "ker-b4": { mode: "AUTO", severity: "medium", probe: true, remediable: true },  // accept_redirects=0
  "ker-b5": { mode: "AUTO", severity: "medium", probe: true, remediable: true },  // rp_filter=1
  "ker-i4": { mode: "AUTO", severity: "low", probe: true, remediable: true },     // randomize_va_space=2
  "ker-i6": { mode: "AUTO", severity: "low", probe: true, remediable: true },     // suid_dumpable=0
  // --- sshd aman (sshd -t guarded, TANPA lockout)
  "ssh-i2": { mode: "AUTO", severity: "medium", probe: true, remediable: true },  // idle timeout
  "ssh-i3": { mode: "AUTO", severity: "low", probe: true, remediable: true },     // disable X11/TCP forwarding
  "ssh-i5": { mode: "AUTO", severity: "medium", probe: true, remediable: true },  // MaxAuthTries
  // --- sshd berisiko-lockout: PROBE saja, remediasi manual (AC-16)
  "ssh-b1": { mode: "AUDIT", severity: "high", probe: true },                     // ganti port SSH (probe: port≠22)
  "ssh-b2": { mode: "AUDIT", severity: "critical", probe: true },                 // disable root login
  "ssh-b3": { mode: "AUDIT", severity: "critical", probe: true },                 // disable password login
  // Catatan: item user berisiko (usr-b2 hapus user, usr-b3 lock root) tak diprobe reliabel lintas
  // distro → dibiarkan default INFO (attestasi manual), bukan AUDIT-mati. Tetap non-AUTO (AC-16).
};
