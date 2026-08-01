import { writeFileSync } from "node:fs";
import type { Agent, Lead } from "@hanoman/shared";
import { capturePane, getSession, liveDecisions, markerFilled, sendToPane } from "../pty";
import { recordLeadDecision } from "../notifications";
import { getLead, leadActive, leadProjects } from "./config";
import { readPaneQuestion } from "./pane";
import { decide, prodDecideDeps, takeReply, type DecideDeps } from "./decide";
import { recordDecision } from "./trail";

// SPEC-409 · ADR-0091 · PINTU KEPUTUSAN #2 — deteksi otomatis.
//
// Melayani sesi APA ADANYA: tak ada prompt baru, tak ada kontrak baru, tak ada perubahan pada
// mekanisme fase. Lead melihat sesi hidup ber-marker keputusan terisi (mekanisme SPEC-184/196 yang
// sudah ada — pintu ini MEMBANGUN DI ATASNYA, bukan membuat deteksi baru), membaca layarnya,
// memutuskan, lalu mengetik jawabannya ke pane. Sesi melanjutkan pekerjaannya tanpa tahu siapa yang
// menjawab (US-6).

/**
 * AC-11 / OQ-10 · berapa jawaban otomatis BERTURUT-TURUT sudah diberikan untuk satu sesi.
 *
 * Sengaja TIDAK di-reset saat marker kosong: marker memang kosong sesaat setelah lead mengetik
 * (hook `UserPromptSubmit` menjalankan `: > <marker>`), jadi reset di sana akan membuat pagarnya
 * tak pernah tercapai — persis loop tak berujung yang ingin dicegah AC-11. Yang mereset hanyalah
 * sesi yang benar-benar berakhir (`sweep`) dan campur tangan manusia (`resetSession`, dipanggil
 * route saat operator menimpa keputusan).
 */
const answers = new Map<string, number>();
const capped = new Set<string>();

/**
 * SPEC-472 (QA) · berapa keputusan BERTURUT-TURUT gagal disusun untuk satu sesi.
 *
 * Penghitung KEDUA, sengaja terpisah dari `answers`: pagar AC-11 mengukur "sudah dijawab berapa
 * kali" dan karena itu tak pernah bergerak untuk sesi yang keputusannya tak pernah jadi. Tanpa
 * pagar sendiri, satu penyebab yang tak kunjung hilang (kunci API ditolak, kuota habis, agen tak
 * terpasang) membuat denyut 5 detik men-spawn agen lead baru untuk sesi yang sama tanpa ujung —
 * terukur 152 percobaan dalam ±13 menit, masing-masing satu proses agen dan satu baris jejak yang
 * sama. Ambangnya ikut `maxAutoAnswers`: knob itu sudah berarti "berapa kali lead boleh mencoba
 * sendiri sebelum menyerah ke operator", dan kegagalan adalah percobaan juga.
 *
 * Dikosongkan oleh keputusan yang BERHASIL (lead terbukti sanggup lagi), oleh campur tangan
 * operator (`resetSession`), dan oleh sesi yang berakhir (`sweep`) — sama seperti `answers`.
 */
const failures = new Map<string, number>();
const failCapped = new Set<string>();

export function resetSession(sessionId: string): void {
  answers.delete(sessionId); capped.delete(sessionId);
  failures.delete(sessionId); failCapped.delete(sessionId);
}
export function __resetDetect(): void {
  answers.clear(); capped.clear(); failures.clear(); failCapped.clear();
}
export function answerCount(sessionId: string): number { return answers.get(sessionId) ?? 0; }
export function failureCount(sessionId: string): number { return failures.get(sessionId) ?? 0; }

export type DetectDeps = {
  live: () => { id: string; specId?: string; projectId: string; decisionFile: string }[];
  filled: (file: string) => boolean;
  pane: (id: string) => string;
  agentOf: (id: string) => Agent | null;
  exited: (id: string) => boolean;
  send: (id: string, text: string) => Promise<boolean>;
  /**
   * SPEC-452 · kosongkan marker keputusan sesudah jawaban mendarat.
   *
   * Menjawab sebuah DIALOG bukan `UserPromptSubmit`, jadi hook pengosong (`: > <marker>`,
   * SPEC-184) tak menembak dan markernya tetap terisi meski sesi sudah kembali bekerja. Terukur:
   * 8 byte sebelum jawaban, 8 byte sesudahnya. Tanpa langkah ini denyut berikutnya membaca sesi
   * itu masih "menunggu", membakar satu giliran agen, lalu mengetik prosanya ke kolom chat yang
   * sudah normal — pesan liar yang membelokkan sesi yang sedang bekerja — sampai `maxAutoAnswers`.
   * Berbeda dari berkas fase (ADR-0084, tak pernah ditulis server), marker keputusan memang berkas
   * yang ditulis & dikosongkan dari luar agen sejak SPEC-184.
   */
  clearMarker: (file: string) => void;
  decide: typeof decide;
  decideDeps: DecideDeps;
  optIn: () => Promise<string[]>;
  notify: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
  cfg: () => Promise<Lead>;
};

export const prodDetectDeps: DetectDeps = {
  live: () => { try { return liveDecisions(); } catch { return []; } },
  filled: markerFilled,
  pane: (id) => capturePane(id),
  agentOf: (id) => { try { return getSession(id)?.agent ?? null; } catch { return null; } },
  // SPEC-402 · tmux tak terbaca ≠ pane mati. Ragu → perlakukan sebagai mati: yang hilang cuma satu
  // jawaban otomatis (sesi jatuh ke perilaku hari ini), sementara salah arah membuat lead mengetik
  // ke pane yang sudah tak ada.
  exited: (id) => { try { return getSession(id)?.exited ?? true; } catch { return true; } },
  send: (id, text) => sendToPane(id, text),
  clearMarker: (file) => { try { writeFileSync(file, ""); } catch { /* marker lenyap = sudah kosong */ } },
  decide,
  decideDeps: prodDecideDeps,
  optIn: leadProjects,
  notify: recordLeadDecision,
  cfg: getLead,
};

export type DetectResult = { answered: string[]; skipped: { id: string; reason: string }[] };

/** Satu putaran pintu deteksi. Dipanggil denyut (engine.ts); tak pernah melempar ke pemanggil. */
export async function scanAndAnswer(deps: DetectDeps = prodDetectDeps): Promise<DetectResult> {
  const out: DetectResult = { answered: [], skipped: [] };
  const cfg = await deps.cfg();
  if (!cfg.enabled || cfg.paused) return out;
  const optIn = new Set(await deps.optIn());

  const sessions = deps.live();
  sweep(sessions.map((s) => s.id));

  for (const s of sessions) {
    const skip = (reason: string) => out.skipped.push({ id: s.id, reason });
    if (!optIn.has(s.projectId)) { skip("project tak opt-in lead"); continue; }
    if (!leadActive(cfg, s.projectId)) { skip("lead dijeda untuk project ini"); continue; }
    if (!deps.filled(s.decisionFile)) continue;      // tak menunggu apa-apa
    if (deps.exited(s.id)) { skip("pane mati"); continue; }   // AC-10

    if ((answers.get(s.id) ?? 0) >= cfg.maxAutoAnswers) {     // AC-11
      if (!capped.has(s.id)) {
        capped.add(s.id);
        const row = await recordDecision({
          projectId: s.projectId, specId: s.specId, sessionId: s.id,
          gate: "detected", kind: "quality",
          question: `Sesi ${s.id} sudah dijawab otomatis ${cfg.maxAutoAnswers}× berturut-turut.`,
          answer: "Berhenti menjawab sesi ini; serahkan ke operator.",
          reason: "Batas jawaban otomatis per sesi tercapai — pengulangan menandakan lead tak benar-benar membuka jalan buntunya (AC-11).",
          refs: [], confidence: "tinggi", action: "none", weighty: true,
        });
        await deps.notify(row.id, `Lead berhenti menjawab sesi ${s.id} (batas ${cfg.maxAutoAnswers}× tercapai)`,
          s.projectId, s.specId ?? null, s.id);
      }
      skip("batas jawaban otomatis tercapai");
      continue;
    }

    // SPEC-472 · pagar kedua: menyerah sesudah sederet kegagalan. Ditempatkan SEBELUM `decide()`
    // karena yang mahal justru panggilannya — satu proses agen per percobaan.
    if ((failures.get(s.id) ?? 0) >= cfg.maxAutoAnswers) {
      if (!failCapped.has(s.id)) {
        failCapped.add(s.id);
        const row = await recordDecision({
          projectId: s.projectId, specId: s.specId, sessionId: s.id,
          gate: "detected", kind: "quality",
          question: `Keputusan untuk sesi ${s.id} gagal disusun ${cfg.maxAutoAnswers}× berturut-turut.`,
          answer: "Berhenti mencoba; serahkan ke operator.",
          reason: "Kegagalan beruntun menandakan sebab yang tak hilang dengan mengulang (kunci/kuota agen, biner tak terpasang) — mencoba lagi tiap denyut hanya membakar kuota. Alasan percobaan terakhir ada di baris jejak `gagal` tepat di atas ini.",
          refs: [], confidence: "tinggi", action: "none", weighty: true,
        });
        await deps.notify(row.id, `Lead berhenti mencoba sesi ${s.id} (${cfg.maxAutoAnswers}× gagal berturut-turut)`,
          s.projectId, s.specId ?? null, s.id);
      }
      skip("batas kegagalan beruntun tercapai");
      continue;
    }

    const agent = deps.agentOf(s.id) ?? "claude";
    const read = readPaneQuestion(deps.pane(s.id), agent);
    if (!read.asking) { skip(read.reason); continue; }        // AC-9

    // SPEC-452 · saat layarnya dialog pilihan, jawaban lead dimasukkan lewat KOLOM JAWABAN BEBAS
    // dialog itu ("Type something.") — bukan dengan menekan nomor opsi. Jadi lead diminta menulis
    // jawaban yang berdiri sendiri (boleh menyebut opsi yang dipilihnya), bukan nomor telanjang.
    const notes = [`Sesi ini menunggu di terminal; teks di bawah adalah layar terakhirnya. Jawablah sebagai masukan yang bisa langsung diketik ke terminal itu (isi \`reply\`).`];
    if (read.choices.length) {
      notes.push("Layarnya adalah dialog pilihan. `reply` akan dimasukkan sebagai JAWABAN BEBAS ke dialog itu, jadi tulislah jawaban yang berdiri sendiri — sebut opsi yang kamu pilih beserta alasan singkatnya, bukan nomornya saja.");
    }
    const row = await deps.decide({
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "detected", kind: "answer",
      question: read.question,
      options: read.choices.length ? read.choices : undefined,
      notes,
    }, deps.decideDeps);
    // `null` = lead baru saja dijeda/dimatikan di tengah panggilan — bukan kegagalan lead, jadi tak
    // dihitung. Baris ber-status `gagal` ADALAH kegagalan: ia yang harus punya ujung (SPEC-472).
    if (!row) { skip("lead tak menghasilkan keputusan yang berlaku"); continue; }
    if (row.status !== "berlaku") {
      failures.set(s.id, (failures.get(s.id) ?? 0) + 1);
      skip("lead tak menghasilkan keputusan yang berlaku");
      continue;
    }

    // `reply` adalah penghalusan opsional dari jawaban — teks yang enak diketik ke TUI ("1")
    // dibanding kalimat keputusannya. Ia hidup di saluran samping berumur pendek (bukan kolom DB),
    // jadi ia bisa saja tak ada: yang selalu ada adalah `answer`. Jangan pernah mengetik string
    // kosong ke pane hanya karena saluran itu meleset.
    const reply = takeReply(row.id) || row.answer;
    const sent = await deps.send(s.id, reply);
    if (!sent) { skip("gagal mengetik ke pane"); continue; }
    // SPEC-452 · sesi ini sudah tak menunggu — dan lead-lah yang barusan membuatnya begitu.
    // Hanya sesudah jawabannya TERBUKTI mendarat: marker yang dikosongkan terlalu dini menyembunyikan
    // sesi yang sebenarnya masih menunggu manusia.
    deps.clearMarker(s.decisionFile);
    answers.set(s.id, (answers.get(s.id) ?? 0) + 1);
    failures.delete(s.id);   // SPEC-472 · "beruntun" — satu keberhasilan memutus rantainya
    out.answered.push(s.id);
  }
  return out;
}

/** Buang penghitung sesi yang sudah tak ada — id sesi spec deterministik dan bisa lahir lagi. */
function sweep(liveIds: string[]): void {
  const live = new Set(liveIds);
  for (const id of [...answers.keys()]) if (!live.has(id)) answers.delete(id);
  for (const id of [...capped]) if (!live.has(id)) capped.delete(id);
  for (const id of [...failures.keys()]) if (!live.has(id)) failures.delete(id);
  for (const id of [...failCapped]) if (!live.has(id)) failCapped.delete(id);
}
