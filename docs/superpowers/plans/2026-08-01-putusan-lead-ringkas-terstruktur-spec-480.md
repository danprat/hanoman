# SPEC-480 — Putusan hanoman-lead ringkas & terstruktur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Putusan hanoman-lead memuat pilihan yang dipilih sebagai field terstruktur tervalidasi, panjangnya dibatasi saat dikirim, dan punya jalur eksplisit "konteks kurang" — sehingga sesi pemanggil membaca putusan tanpa menafsirkan prosa.

**Architecture:** `zLeadVerdict` bertambah `choice` (string bebas, divalidasi server terhadap opsi peminta) dan `missing` (string[]). Resolver, pemangkas prosa, dan perakit teks balasan semuanya **fungsi murni di `shared/src/lead.ts`** supaya server, UI, dan test bicara dari satu sumber. `decide()` tetap satu-satunya tempat yang tahu urutan wajib (bukti → putusan → saring rujukan → gerbang tindakan → tulis jejak → notifikasi); yang bertambah di sana adalah gerbang pilihan dan rekonsiliasi `action` ↔ opsi. Jejak `LeadDecision` menyimpan prosa **utuh** + empat kolom baru; yang terpangkas hanyalah yang **dikirim** (respons HTTP & ketikan ke pane), lewat saluran samping berumur pendek `lastDelivery`.

**Tech Stack:** TypeScript strict · zod (`shared`) · Fastify + Prisma 6/SQLite (`server`) · React + Vite (`src`) · vitest.

## Global Constraints

- Bahasa komentar & prosa doc: **Indonesia**. Kode, identifier, dan keluaran apa adanya.
- `LEAD_ACTIONS` tetap **konstanta modul, allowlist tertutup** — tak ada tindakan baru (ADR-0091 AC-31/32).
- `LeadDecision` **LOCAL-only** (tak disync): tak ada perubahan `FIELDS`/`DATE_FIELDS` sync; `PG_ORDER` sudah memuatnya dan tak berubah.
- Migration **ditulis tangan** lalu `prisma migrate deploy` — **jangan** `migrate dev` (worktree tetangga → drift → reset DB).
- Jejak keputusan menyimpan keluaran lead **utuh**; pemangkasan hanya di jalur pengiriman.
- `kind` **tidak pernah** ditulis ulang oleh gerbang pilihan (SPEC-432: `kind` yang berubah merusak idempotensi denyut).
- Batas panjang: `LEAD_DECISION_MAX = 240`, `LEAD_REASON_MAX = 480`.
- Test server **wajib** `--no-file-parallelism`. Jalankan vitest lewat `./node_modules/.bin/vitest` (pnpm vitest gagal lewat proxy rtk).
- Nomor ADR untuk spec ini: **0098** (0097 sudah diklaim worktree `spec-477`). Verifikasi ulang tepat sebelum push.

---

### Task 1: Primitif murni di `shared/src/lead.ts`

**Files:**
- Modify: `shared/src/lead.ts`
- Test: `shared/src/lead.test.ts`

**Interfaces:**
- Consumes: `LEAD_ACTIONS`, `leadActionAllowed` (sudah ada di berkas yang sama).
- Produces:
  - `type LeadChoice = { index: number; option: string }` (index **1-basis**)
  - `type LeadDelivery = { decision: string; reason: string; reply: string; choice: LeadChoice | null; missing: string[] }`
  - `const LEAD_DECISION_MAX = 240`, `const LEAD_REASON_MAX = 480`
  - `function resolveChoice(raw: string, options: string[]): LeadChoice | null`
  - `function clampProse(s: string, max: number): string`
  - `function optionActionHint(option: string): LeadAction | null`
  - `function leadReplyText(d: LeadDelivery): string`
  - `zLeadVerdict` bertambah `choice: string` (default `""`) & `missing: string[]` (default `[]`)
  - `zLeadChoice` (zod object `{ index, option }`)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `shared/src/lead.test.ts`, dan **ubah** dua test lama yang akan pecah karena field baru:

```ts
// --- UBAH test lama pada describe "SPEC-409 · bentuk jawaban (AC-1)" ---
  it("fills sane defaults so a terse-but-valid verdict is still usable", () => {
    const v = zLeadVerdict.parse({ decision: "pakai opsi 1", reason: "ADR-0029" });
    expect(v).toEqual({
      decision: "pakai opsi 1", reason: "ADR-0029", refs: [], confidence: "sedang",
      action: "none", reply: "", choice: "", missing: [],
    });
  });
```

```ts
// --- TAMBAH di akhir berkas ---
import {
  resolveChoice, clampProse, optionActionHint, leadReplyText,
  LEAD_DECISION_MAX, LEAD_REASON_MAX,
} from "./lead";

// SPEC-480 · ADR-0098. Opsi denyut selalu berbentuk "<action> — <penjelasan>"; opsi dialog
// `AskUserQuestion` berupa label bebas. Resolver harus melayani keduanya TANPA pernah menebak:
// SPEC-452 sudah membayar harga pencocokan yang "kelihatan benar" (lead memutuskan Node 22,
// yang terpilih Node 20, jejaknya tetap `berlaku`).
describe("SPEC-480 · resolveChoice", () => {
  const OPTS = [
    "integrate-main — merge branch sesi ini ke main",
    "stop-session — lepas panenya tanpa mengintegrasikan",
    "none — biarkan sesinya berdiri",
  ];

  it("reads a bare 1-based number", () => {
    expect(resolveChoice("2", OPTS)).toEqual({ index: 2, option: OPTS[1] });
    expect(resolveChoice("1.", OPTS)).toEqual({ index: 1, option: OPTS[0] });
    expect(resolveChoice("#3", OPTS)).toEqual({ index: 3, option: OPTS[2] });
    expect(resolveChoice("opsi 2", OPTS)).toEqual({ index: 2, option: OPTS[1] });
    expect(resolveChoice("option 2", OPTS)).toEqual({ index: 2, option: OPTS[1] });
  });

  it("refuses a number outside the list instead of clamping it", () => {
    expect(resolveChoice("0", OPTS)).toBeNull();
    expect(resolveChoice("4", OPTS)).toBeNull();
  });

  it("reads the option text verbatim, ignoring case and stray whitespace", () => {
    expect(resolveChoice("  STOP-SESSION —   lepas panenya tanpa mengintegrasikan ", OPTS))
      .toEqual({ index: 2, option: OPTS[1] });
  });

  it("reads the head of a labelled option", () => {
    expect(resolveChoice("integrate-main", OPTS)).toEqual({ index: 1, option: OPTS[0] });
    expect(resolveChoice("none", OPTS)).toEqual({ index: 3, option: OPTS[2] });
  });

  it("reads a unique prefix", () => {
    expect(resolveChoice("stop-session — lepas", OPTS)).toEqual({ index: 2, option: OPTS[1] });
  });

  it("returns null when a prefix matches more than one option", () => {
    const dua = ["Node 20 LTS", "Node 20 current"];
    expect(resolveChoice("Node 20", dua)).toBeNull();
  });

  it("accepts a number with its label, but only when they agree", () => {
    expect(resolveChoice("2. stop-session", OPTS)).toEqual({ index: 2, option: OPTS[1] });
    expect(resolveChoice("2 integrate-main", OPTS)).toBeNull();   // nomor & label bertentangan
  });

  it("returns null for an invented option, an empty string, or an empty menu", () => {
    expect(resolveChoice("rebase saja", OPTS)).toBeNull();
    expect(resolveChoice("", OPTS)).toBeNull();
    expect(resolveChoice("1", [])).toBeNull();
  });
});

describe("SPEC-480 · clampProse", () => {
  it("leaves prose that already fits untouched apart from folding whitespace", () => {
    expect(clampProse("Pilih opsi 2.", 240)).toBe("Pilih opsi 2.");
    expect(clampProse("dua\n  baris", 240)).toBe("dua baris");
  });

  it("cuts at the last sentence boundary that fits", () => {
    const s = "Satu kalimat pertama. Kalimat kedua yang panjang sekali dan tak akan muat.";
    expect(clampProse(s, 40)).toBe("Satu kalimat pertama.");
  });

  it("cuts at a word boundary with an ellipsis when there is no sentence to cut at", () => {
    const out = clampProse("kalimatpanjangtanpatitik yang terus mengalir tanpa henti", 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("mengalir");
  });

  // Baris baru yang lolos ke pane = Enter = dialog ter-submit separuh jalan (kelas SPEC-452).
  it("never lets a newline survive into the delivered text", () => {
    expect(clampProse("baris satu\nbaris dua", 240)).not.toContain("\n");
  });
});

describe("SPEC-480 · optionActionHint", () => {
  it("reads the action name a caller put at the head of its option label", () => {
    expect(optionActionHint("integrate-main — merge branch sesi ini ke main")).toBe("integrate-main");
    expect(optionActionHint("hold-work: tunda salah satu")).toBe("hold-work");
    expect(optionActionHint("none — biarkan")).toBe("none");
  });
  it("stays null for a plain label and for anything outside the allowlist", () => {
    expect(optionActionHint("Node 22")).toBeNull();
    expect(optionActionHint("deploy — dorong ke produksi")).toBeNull();
    expect(optionActionHint("")).toBeNull();
  });
});

describe("SPEC-480 · leadReplyText", () => {
  const base = { decision: "d", reason: "karena begitu.", reply: "", choice: null, missing: [] };

  it("names the chosen option verbatim so the model on the other side cannot mis-read it", () => {
    const out = leadReplyText({ ...base, choice: { index: 2, option: "Node 22" } });
    expect(out).toBe("Pilih: Node 22. karena begitu.");
  });

  it("says what is missing when lead declares the context insufficient", () => {
    const out = leadReplyText({ ...base, missing: ["versi Node yang dipakai produksi", "isi ADR-0086"] });
    expect(out).toContain("Belum bisa kuputuskan");
    expect(out).toContain("versi Node yang dipakai produksi");
    expect(out).toContain("isi ADR-0086");
  });

  it("falls back to reply, then to the decision text", () => {
    expect(leadReplyText({ ...base, reply: "ketik ini" })).toBe("ketik ini");
    expect(leadReplyText(base)).toBe("d");
  });

  it("keeps the delivered text within the shared budget", () => {
    const long = "kata ".repeat(500);
    expect(leadReplyText({ ...base, decision: long }).length)
      .toBeLessThanOrEqual(LEAD_DECISION_MAX + LEAD_REASON_MAX + 1);
  });
});

describe("SPEC-480 · verdict terstruktur", () => {
  it("defaults choice and missing so an older-shaped verdict still parses", () => {
    const v = zLeadVerdict.parse({ decision: "d", reason: "r" });
    expect(v.choice).toBe("");
    expect(v.missing).toEqual([]);
  });
  // Alasan yang sama dengan `action`: pilihan karangan harus BISA MASUK supaya server menolaknya
  // secara sadar dan mencatatnya — bukan lenyap sebagai "keluaran rusak".
  it("lets an invented choice through parsing so the server can refuse it on the record", () => {
    expect(zLeadVerdict.parse({ decision: "d", reason: "r", choice: "opsi kelima" }).choice)
      .toBe("opsi kelima");
  });
  it("caps how many missing items a verdict may carry", () => {
    expect(zLeadVerdict.safeParse({
      decision: "d", reason: "r", missing: Array.from({ length: 11 }, (_, i) => `x${i}`),
    }).success).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir shared shared/src/lead.test.ts
```
Expected: FAIL — `resolveChoice is not a function` / `clampProse is not exported` dan test default verdict pecah pada `choice`/`missing`.

- [x] **Step 3: Implementasi minimal**

Tambahkan di `shared/src/lead.ts`, di bawah `isWeightyDecision` (sebelum `zLeadVerdict`):

```ts
// ── SPEC-480 · ADR-0098 · putusan yang bisa dipakai mesin ────────────────────────────────────
//
// Sampai spec ini, satu-satunya jembatan antara "opsi yang dipilih lead" dan "apa yang dijalankan
// server" adalah HARAPAN bahwa prosa `decision` dan field `action` sepakat. Modul ini menggantinya
// dengan pilihan sebagai DATA — divalidasi terhadap daftar opsi yang benar-benar dikirim peminta.

/** Opsi yang terpilih. `index` 1-BASIS: itu nomor yang dilihat manusia & agen di layar. */
export type LeadChoice = { index: number; option: string };
export const zLeadChoice = z.object({ index: z.number().int().positive(), option: z.string() });

/** Putusan "sebagaimana dikirim": terpangkas, siap diketik ke pane / dikembalikan ke peminta. */
export type LeadDelivery = {
  decision: string;
  reason: string;
  reply: string;
  choice: LeadChoice | null;
  missing: string[];
};

/**
 * Batas panjang putusan. Bukan sopan santun: `reply` masuk ke pane lewat `goalChunks` (potongan
 * 500 char berjeda 50 ms, ADR-0085), dan seluruh prosa ditulis agen DI DALAM anggaran `timeoutSec`
 * yang sama yang SPEC-432 buktikan sebagai pembatas nyata.
 */
export const LEAD_DECISION_MAX = 240;   // ±1 kalimat
export const LEAD_REASON_MAX = 480;     // ±3 kalimat

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
/** Kepala label: potongan sebelum pemisah pertama — opsi denyut berbentuk "<action> — <uraian>". */
const headOf = (s: string): string => norm(s.split(/\s+[—–-]\s+|:/)[0] ?? s);

/**
 * Petakan `choice` mentah ke salah satu opsi peminta. `null` = TIDAK terpilih, dan itu selalu
 * jawaban yang sah: ambigu tak pernah ditebak. SPEC-452 mengukur ongkos tebakan yang kelihatan
 * benar — lead memutuskan Node 22, yang terpilih Node 20, dan jejaknya tetap berstatus `berlaku`.
 */
export function resolveChoice(raw: string, options: string[]): LeadChoice | null {
  const t = (raw ?? "").trim();
  if (!t || !options.length) return null;
  const pick = (i: number): LeadChoice | null =>
    i >= 0 && i < options.length ? { index: i + 1, option: options[i]! } : null;

  // 1 · nomor, dengan atau tanpa label di belakangnya. Label yang IKUT disebut harus sepakat
  //     dengan nomornya — bertentangan berarti lead sendiri tak konsisten, dan menebak mana yang
  //     ia maksud persis kesalahan yang spec ini ada untuk menghapusnya.
  const num = t.match(/^(?:opsi|option|pilihan|#)?\s*(\d{1,2})\s*[.):-]?\s*(.*)$/i);
  if (num) {
    const hit = pick(Number(num[1]) - 1);
    if (!hit) return null;
    const rest = norm(num[2] ?? "");
    if (!rest) return hit;
    const target = norm(hit.option);
    return target.startsWith(rest) || headOf(hit.option) === rest || target.includes(rest) ? hit : null;
  }

  const n = norm(t);
  const exact = options.findIndex((o) => norm(o) === n);
  if (exact >= 0) return pick(exact);

  const byHead = options.flatMap((o, i) => (headOf(o) === n ? [i] : []));
  if (byHead.length === 1) return pick(byHead[0]!);

  const byPrefix = options.flatMap((o, i) => (norm(o).startsWith(n) ? [i] : []));
  if (byPrefix.length === 1) return pick(byPrefix[0]!);

  return null;
}

/**
 * Pangkas prosa untuk PENGIRIMAN — jejak menyimpan yang utuh. Memotong di batas kalimat lebih dulu
 * supaya yang sampai tetap kalimat, bukan penggalan. Spasi dilipat sekalian: satu baris baru yang
 * lolos ke pane adalah `Enter`, dan `Enter` di tengah dialog mengirim jawaban separuh jadi.
 */
export function clampProse(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (stop >= Math.floor(max / 2)) return head.slice(0, stop + 1);
  const word = head.lastIndexOf(" ");
  return `${(word > 0 ? head.slice(0, word) : head).trimEnd()}…`;
}

/**
 * Nama tindakan yang DIRAKIT PEMINTA di kepala label opsinya ("integrate-main — merge …").
 * Karena label itu milik pemanggil, bukan lead, hint ini bukan tebakan atas maksud agen.
 */
export function optionActionHint(option: string): LeadAction | null {
  const tok = ((option ?? "").trim().split(/[\s—–:]/)[0] ?? "").toLowerCase();
  return leadActionAllowed(tok) ? tok : null;
}

/**
 * Teks yang benar-benar diketik ke pane. Dirakit deterministik, bukan dipungut dari prosa: kolom
 * jawaban bebas dialog `AskUserQuestion` adalah kolom TEKS (SPEC-452), dan menyebut label opsi
 * verbatim adalah cara paling tak ambigu memberitahu model di seberang mana yang dipilih.
 */
export function leadReplyText(d: LeadDelivery): string {
  const budget = LEAD_DECISION_MAX + LEAD_REASON_MAX;
  if (d.missing.length)
    return clampProse(`Belum bisa kuputuskan. Yang kurang: ${d.missing.join("; ")}.`, budget);
  if (d.choice) return clampProse(`Pilih: ${d.choice.option}. ${d.reason}`, budget);
  return clampProse(d.reply || d.decision, budget);
}
```

Lalu tambahkan dua field di `zLeadVerdict` (sesudah `action`, sebelum `reply`):

```ts
  /**
   * SPEC-480 · opsi yang dipilih — nomor ATAU label. Sengaja `string`, bukan enum/number: pilihan
   * di luar daftar harus BISA MASUK supaya server menolaknya secara sadar & mencatatnya, alasan
   * yang sama persis dengan `action` di atas.
   */
  choice: z.string().default(""),
  /**
   * SPEC-480 · apa yang KURANG bila konteksnya memang tak cukup untuk memutuskan. Bukan pengganti
   * `confidence: "ragu"` (bukti tipis, jawabannya tetap ada) melainkan untuk fakta konkret yang
   * tak ada di repo maupun konteks. Terisi ⇒ server memaksa `ragu` ⇒ operator dinotifikasi.
   */
  missing: z.array(z.string().max(200)).max(10).default([]),
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

```bash
./node_modules/.bin/vitest run --dir shared shared/src/lead.test.ts
```
Expected: PASS, seluruh `describe` SPEC-480 hijau dan test SPEC-409 lama tetap hijau.

- [x] **Step 5: Typecheck paket shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar tanpa error.

- [x] **Step 6: Commit**

```bash
git add shared/src/lead.ts shared/src/lead.test.ts
git commit -m "feat(480): primitif putusan lead terstruktur di shared

resolveChoice fail-closed, clampProse, optionActionHint, leadReplyText,
plus field choice & missing di zLeadVerdict.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Empat kolom aditif di `LeadDecision`

**Files:**
- Modify: `server/prisma/schema.prisma:382-405`
- Create: `server/prisma/migrations/20260801190000_lead_choice/migration.sql`
- Modify: `server/src/services/lead/trail.ts` (`TrailInput` + `recordDecision`)
- Test: `server/test/lead-trail-choice.test.ts` (baru)

**Interfaces:**
- Consumes: —
- Produces: kolom `LeadDecision.choice: String?`, `choiceIndex: Int?`, `options: Json?`, `missing: Json?`; `TrailInput` menerima keempatnya sebagai field opsional.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/lead-trail-choice.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { recordDecision } from "../src/services/lead/trail";

// SPEC-480 · ADR-0098 · jejak keputusan menyimpan PILIHAN sebagai data, bukan hanya prosa.
// `options` ikut disimpan karena tanpa itu jejaknya tak bisa dibaca ulang: `question` tersimpan,
// menunya tidak, jadi "lead memilih opsi 2" tak bisa diverifikasi enam jam kemudian.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web" } });
});
afterAll(clean);

const base = {
  projectId: "demo", gate: "contract", kind: "answer",
  question: "q?", answer: "a", reason: "r",
  refs: [], confidence: "tinggi", action: "none",
} as const;

describe("recordDecision · kolom pilihan (SPEC-480)", () => {
  it("stores the chosen option, its 1-based index, the menu, and the missing list", async () => {
    const row = await recordDecision({
      ...base,
      choice: "stop-session — lepas panenya",
      choiceIndex: 2,
      options: ["integrate-main — merge", "stop-session — lepas panenya"],
      missing: ["versi Node produksi"],
    });
    const read = await prisma.leadDecision.findUniqueOrThrow({ where: { id: row.id } });
    expect(read.choice).toBe("stop-session — lepas panenya");
    expect(read.choiceIndex).toBe(2);
    expect(read.options).toEqual(["integrate-main — merge", "stop-session — lepas panenya"]);
    expect(read.missing).toEqual(["versi Node produksi"]);
  });

  // Baris lama (dan baris tanpa opsi) tetap sah: keempat kolom nullable, tanpa default.
  it("leaves all four columns null when the caller offered no options", async () => {
    const row = await recordDecision({ ...base });
    const read = await prisma.leadDecision.findUniqueOrThrow({ where: { id: row.id } });
    expect(read.choice).toBeNull();
    expect(read.choiceIndex).toBeNull();
    expect(read.options).toBeNull();
    expect(read.missing).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-trail-choice.test.ts
```
Expected: FAIL — TypeScript menolak `choice` di `TrailInput` / Prisma tak mengenal kolomnya.

- [x] **Step 3: Tambahkan kolom di schema**

`server/prisma/schema.prisma`, di dalam `model LeadDecision`, sesudah baris `actor`:

```prisma
  // SPEC-480 · ADR-0098 · pilihan sebagai DATA. Keempatnya nullable tanpa default: baris yang lahir
  // sebelum spec ini sah apa adanya, dan "tak ada opsi" beda dari "opsi kosong".
  choice         String?   // label opsi terpilih, verbatim; null = tak ada opsi / pilihan ditolak
  choiceIndex    Int?      // 1-basis, sepasang dengan `choice`
  options        Json?     // string[] — daftar opsi yang DIKIRIM peminta, supaya jejak bisa diaudit
  missing        Json?     // string[] — apa yang kurang bila lead menyatakan konteksnya tak cukup
```

- [x] **Step 4: Tulis migration tangan**

Buat `server/prisma/migrations/20260801190000_lead_choice/migration.sql`:

```sql
-- SPEC-480 · ADR-0098 · putusan lead yang bisa dipakai mesin: pilihan tersimpan sebagai data.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — empat kolom NULLABLE tanpa default, tak ada tabel diredefinisi, tak
-- ada baris disentuh. Larangan SQLite atas `ADD COLUMN … DEFAULT <non-konstan>` (lihat migration
-- SPEC-408) tak berlaku di sini karena tak ada default sama sekali.
ALTER TABLE "LeadDecision" ADD COLUMN "choice" TEXT;
ALTER TABLE "LeadDecision" ADD COLUMN "choiceIndex" INTEGER;
ALTER TABLE "LeadDecision" ADD COLUMN "options" JSONB;
ALTER TABLE "LeadDecision" ADD COLUMN "missing" JSONB;
```

- [x] **Step 5: Terapkan migration & regenerate client**

```bash
cd server && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma generate && cd ..
```
Expected: `1 migration applied` (atau "No pending migrations" bila DB dev belum ada) dan `Generated Prisma Client`.

> Bila `prisma migrate deploy` mengeluh soal drift dari worktree tetangga, terapkan hanya berkas ini:
> `sqlite3 "$(node -e 'console.log(require("./runner/dist/paths.js")?.dbFilePath?.()||"")')" < server/prisma/migrations/20260801190000_lead_choice/migration.sql` — atau jalankan `migrate deploy` sekali lagi setelah `prisma migrate resolve --applied <nama-migration-tetangga>`.

- [x] **Step 6: Teruskan kolom baru lewat `TrailInput`**

`server/src/services/lead/trail.ts` — tambahkan di `TrailInput` (sesudah `action`):

```ts
  /** SPEC-480 · pilihan yang terselesaikan terhadap `options`; null bila tak ada / ditolak. */
  choice?: string | null;
  choiceIndex?: number | null;
  /** Daftar opsi yang dikirim peminta — disimpan supaya jejak bisa dibaca ulang tanpa peminta. */
  options?: string[] | null;
  /** Apa yang kurang bila lead menyatakan konteksnya tak cukup. */
  missing?: string[] | null;
```

dan di `recordDecision`, di dalam `data:` sesudah `action: i.action,`:

```ts
      choice: i.choice ?? null,
      choiceIndex: i.choiceIndex ?? null,
      options: i.options?.length ? i.options : null,
      missing: i.missing?.length ? i.missing : null,
```

- [x] **Step 7: Jalankan test — pastikan LULUS**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-trail-choice.test.ts
```
Expected: PASS 2 test.

- [x] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260801190000_lead_choice server/src/services/lead/trail.ts server/test/lead-trail-choice.test.ts
git commit -m "feat(480): kolom choice/choiceIndex/options/missing di LeadDecision

Migration tulis tangan, empat kolom nullable aditif; TrailInput meneruskannya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Gerbang pilihan di `decide()` + saluran pengiriman terpangkas

**Files:**
- Modify: `server/src/services/lead/decide.ts`
- Test: `server/test/lead-decide.test.ts`

**Interfaces:**
- Consumes: `resolveChoice`, `clampProse`, `optionActionHint`, `LEAD_DECISION_MAX`, `LEAD_REASON_MAX`, `type LeadDelivery`, `type LeadChoice` (Task 1); `TrailInput.choice/choiceIndex/options/missing` (Task 2).
- Produces: `export function takeDelivery(decisionId: string): LeadDelivery | null` — **menggantikan** `takeReply`. Pemanggil: `routes/lead.ts` (Task 5) dan `services/lead/detect.ts` (Task 6).

- [x] **Step 1: Tulis test yang gagal**

Di `server/test/lead-decide.test.ts`: ganti import baris 5 dan **ganti seluruh** `describe("decide · balasan untuk pane", …)` (baris 194-207) dengan blok di bawah, lalu tambahkan blok SPEC-480 di akhir berkas.

```ts
// --- GANTI baris import ---
import { decide, takeDelivery, type DecideDeps } from "../src/services/lead/decide";
```

```ts
// --- GANTI describe "decide · balasan untuk pane" ---
describe("decide · balasan untuk pane", () => {
  beforeEach(() => setLead(cfg()));
  it("hands over the delivery once and then forgets it", async () => {
    const row = await decide({ ...ask, sessionId: "s1" }, deps(block({
      decision: "opsi 1", reason: "b", reply: "1",
    })));
    expect(takeDelivery(row!.id)?.reply).toBe("1");
    expect(takeDelivery(row!.id)).toBeNull();
  });
  it("carries the decision text so a consumer always has something to type", async () => {
    const row = await decide({ ...ask, sessionId: "s1" }, deps(block({ decision: "opsi 1", reason: "b" })));
    expect(takeDelivery(row!.id)?.decision).toBe("opsi 1");
  });
});
```

```ts
// --- TAMBAH di akhir berkas ---

// SPEC-480 · ADR-0098 · pilihan sebagai data. Sampai spec ini, satu-satunya jembatan antara "opsi
// yang dipilih" dan "apa yang dijalankan" adalah harapan bahwa prosa & `action` sepakat.
describe("decide · pilihan terstruktur (SPEC-480)", () => {
  beforeEach(() => setLead(cfg()));
  const OPTS = [
    "integrate-main — merge branch sesi ini ke main",
    "stop-session — lepas panenya tanpa mengintegrasikan",
    "none — biarkan sesinya berdiri",
  ];
  const withOpts = { ...ask, options: OPTS };

  it("resolves the chosen option and records it with the menu it came from", async () => {
    const row = await decide({ ...withOpts }, deps(block({
      decision: "lepas panenya", reason: "plan tuntas", choice: "2", action: "stop-session",
    })));
    expect(row!.choice).toBe(OPTS[1]);
    expect(row!.choiceIndex).toBe(2);
    expect(row!.options).toEqual(OPTS);
    expect(row!.status).toBe("berlaku");
  });

  it("refuses a choice outside the menu, keeps the row, and notifies", async () => {
    const notes: Notif[] = [];
    const row = await decide({ ...withOpts }, deps(block({
      decision: "rebase saja", reason: "lebih rapi", choice: "rebase",
    }), notes));
    expect(row!.choice).toBeNull();
    expect(row!.choiceIndex).toBeNull();
    expect(row!.reason).toContain("DITOLAK");
    expect(row!.reason).toContain("rebase");
    expect(row!.weighty).toBe(true);
    expect(notes).toHaveLength(1);
    // SPEC-432 · `kind` TAK BOLEH ditulis ulang: gerbang idempotensi denyut berkunci padanya.
    expect(row!.kind).toBe("answer");
  });

  it("leaves the choice columns null when the caller offered no options at all", async () => {
    const row = await decide({ ...ask }, deps(block({ decision: "a", reason: "b", choice: "2" })));
    expect(row!.choice).toBeNull();
    expect(row!.reason).not.toContain("DITOLAK");
  });

  it("adopts the action a caller encoded in the chosen option when lead named none", async () => {
    const row = await decide({ ...withOpts }, deps(block({
      decision: "integrasikan", reason: "plan tuntas", choice: "1",
    })));
    expect(row!.action).toBe("integrate-main");
    expect(row!.reason).toContain("diturunkan dari opsi");
  });

  it("never guesses when the stated action contradicts the chosen option", async () => {
    const notes: Notif[] = [];
    const row = await decide({ ...withOpts }, deps(block({
      decision: "hentikan saja", reason: "x", choice: "1", action: "stop-session",
    }), notes));
    expect(row!.action).toBe("none");
    expect(row!.reason).toContain("KONFLIK");
    expect(row!.weighty).toBe(true);
    expect(notes).toHaveLength(1);
  });

  it("keeps a locked action locked even when the chosen option looks harmless", async () => {
    const row = await decide({ ...withOpts }, deps(block({
      decision: "deploy dulu", reason: "biar cepat", choice: "1", action: "deploy",
    })));
    expect(row!.kind).toBe("refusal");
    expect(row!.action).toBe("none");
  });

  it("hands the resolved choice to the delivery channel", async () => {
    const row = await decide({ ...withOpts }, deps(block({
      decision: "lepas panenya", reason: "plan tuntas", choice: "stop-session",
    })));
    expect(takeDelivery(row!.id)?.choice).toEqual({ index: 2, option: OPTS[1] });
  });
});

describe("decide · konteks kurang (SPEC-480)", () => {
  beforeEach(() => setLead(cfg()));
  it("forces `ragu`, notifies, and records what is missing", async () => {
    const notes: Notif[] = [];
    const row = await decide({ ...ask }, deps(block({
      decision: "belum bisa diputuskan sampai versi Node produksi diketahui",
      reason: "tak ada di repo", confidence: "tinggi",
      missing: ["versi Node yang dipakai produksi"],
    }), notes));
    expect(row!.confidence).toBe("ragu");
    expect(row!.weighty).toBe(true);
    expect(row!.missing).toEqual(["versi Node yang dipakai produksi"]);
    expect(row!.reason).toContain("KONTEKS KURANG");
    expect(notes).toHaveLength(1);
    // Kompatibilitas mundur: pemanggil yang hanya membaca teks tetap dapat kalimat bermakna.
    expect(row!.answer).toContain("belum bisa diputuskan");
  });
});

describe("decide · ringkas saat dikirim, penuh di jejak (SPEC-480)", () => {
  beforeEach(() => setLead(cfg()));
  it("stores the full prose but delivers a clamped copy", async () => {
    const panjang = "Kalimat pembuka yang bertele-tele. ".repeat(40);
    const row = await decide({ ...ask }, deps(block({ decision: "pakai opsi 1", reason: panjang })));
    expect(row!.reason.length).toBeGreaterThan(600);        // jejak PENUH
    const d = takeDelivery(row!.id)!;
    expect(d.reason.length).toBeLessThanOrEqual(481);       // yang dikirim terpangkas
  });
  it("appends the refusal note AFTER clamping so it can never be cut off", async () => {
    const panjang = "alasan panjang sekali. ".repeat(40);
    const row = await decide({ ...ask, options: ["a", "b"] },
      deps(block({ decision: "d", reason: panjang, choice: "z" })));
    expect(takeDelivery(row!.id)!.reason).toContain("DITOLAK");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-decide.test.ts
```
Expected: FAIL — `takeDelivery` belum diekspor.

- [x] **Step 3: Implementasi di `decide.ts`**

Ganti import baris 2-5 menjadi:

```ts
import {
  isWeightyDecision, leadActionAllowed, leadRefusalReason,
  resolveChoice, clampProse, optionActionHint, LEAD_DECISION_MAX, LEAD_REASON_MAX,
  type Agent, type LeadAction, type LeadDelivery, type LeadGate, type LeadKind,
} from "@hanoman/shared";
```

Ganti blok dari `const refs = keepExistingRefs(...)` sampai `return row;` (baris 122-143) dengan:

```ts
  const refs = keepExistingRefs(verdict.refs, repoDir);
  const allowed = leadActionAllowed(verdict.action);
  const kind: LeadKind = allowed ? req.kind : "refusal";

  // SPEC-480 · pilihan sebagai DATA. `options` kosong = peminta memang tak menyodorkan menu; di
  // situ `choice` tak punya arti dan tak pernah ditolak.
  const options = req.options ?? [];
  const choice = resolveChoice(verdict.choice, options);
  const choiceRejected = options.length > 0 && verdict.choice.trim() !== "" && !choice;
  const missing = verdict.missing.map((m) => m.trim()).filter(Boolean);

  // SPEC-480 · tindakan boleh DITURUNKAN dari opsi terpilih, tapi hanya saat lead diam. Label opsi
  // dirakit PEMINTA ("integrate-main — …"), jadi hint-nya bukan tebakan atas maksud agen; yang tak
  // pernah ditebak adalah pertentangan — di sana tindakan dibatalkan dan operator diberi tahu.
  let action: LeadAction = allowed ? (verdict.action as LeadAction) : "none";
  let actionNote = "";
  let conflict = false;
  if (allowed && choice) {
    const hint = optionActionHint(choice.option);
    if (hint && action === "none" && hint !== "none") {
      action = hint;
      actionNote = `Tindakan diturunkan dari opsi terpilih ("${hint}") karena lead tak menyebutnya sendiri (SPEC-480).`;
    } else if (hint && action !== "none" && action !== hint) {
      conflict = true;
      actionNote = `KONFLIK: lead memilih opsi "${choice.option}" tetapi menyetel action "${action}" — tindakan dibatalkan (SPEC-480).`;
      action = "none";
    }
  }

  // `missing` terisi ⇒ ragu, apa pun yang ditulis lead. Menyatakan konteksnya kurang DAN mengaku
  // yakin adalah dua hal yang tak bisa benar bersamaan.
  const confidence = missing.length ? "ragu" : verdict.confidence;

  const notes: string[] = [];
  if (!allowed) notes.push(`DITOLAK: ${leadRefusalReason(verdict.action)} berada di luar permukaan tindakan lead (ADR-0091 · AC-31/32).`);
  if (choiceRejected) notes.push(`DITOLAK: pilihan "${verdict.choice.trim().slice(0, 120)}" tidak ada di daftar opsi yang dikirim peminta (SPEC-480 · ADR-0098).`);
  if (actionNote) notes.push(actionNote);
  if (missing.length) notes.push(`KONTEKS KURANG: ${missing.join("; ")}`);
  const tail = notes.length ? `\n\n${notes.join("\n\n")}` : "";

  const weighty = isWeightyDecision({ kind, action, confidence }) || choiceRejected || conflict;

  const row = await recordDecision({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    // Jejak menyimpan prosa lead UTUH: yang dipangkas hanya yang dikirim (SPEC-480).
    gate: req.gate, kind, question: req.question, answer: verdict.decision,
    reason: `${verdict.reason}${tail}`,
    refs, confidence, action, weighty,
    choice: choice?.option ?? null, choiceIndex: choice?.index ?? null,
    options, missing,
  });
  if (weighty) {
    await deps.notify(row.id, notifTitle(kind, req.question, verdict.decision, confidence),
      req.projectId, req.specId ?? null, req.sessionId ?? null);
  }
  // Putusan "sebagaimana dikirim": terpangkas di batas kalimat, catatan penolakan ditempelkan
  // SESUDAH pemangkasan supaya ia tak pernah ikut terpotong. Saluran ini berumur satu ketikan —
  // yang perlu bertahan adalah barisnya, dan itu sudah ditulis di atas.
  lastDelivery.set(row.id, {
    decision: clampProse(verdict.decision, LEAD_DECISION_MAX),
    reason: `${clampProse(verdict.reason, LEAD_REASON_MAX)}${tail}`,
    reply: verdict.reply,
    choice, missing,
  });
  return row;
}
```

Ganti blok `lastReply` (baris 146-153) dengan:

```ts
// Putusan sebagaimana dikirim, berumur pendek: dipakai route (pintu #1) & detect.ts (pintu #2)
// sesaat setelah decide() kembali. Map, bukan kolom DB — isinya turunan dari baris yang sudah
// tersimpan dan tak punya nilai historis.
const lastDelivery = new Map<string, LeadDelivery>();
export function takeDelivery(decisionId: string): LeadDelivery | null {
  const v = lastDelivery.get(decisionId) ?? null;
  lastDelivery.delete(decisionId);
  return v;
}
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-decide.test.ts
```
Expected: PASS seluruh berkas (test SPEC-409/432 lama ikut hijau).

- [x] **Step 5: Commit**

```bash
git add server/src/services/lead/decide.ts server/test/lead-decide.test.ts
git commit -m "feat(480): gerbang pilihan + pengiriman terpangkas di decide()

Pilihan divalidasi terhadap opsi peminta, di luar daftar ditolak-dan-dicatat
tanpa mengubah kind, action diturunkan dari opsi hanya saat lead diam, missing
memaksa ragu. Jejak menyimpan prosa penuh; takeDelivery memberi salinan pendek.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Prompt lead — batas panjang, `choice`, `missing`

**Files:**
- Modify: `server/src/services/lead/prompt.ts`
- Test: `server/test/lead-prompt.test.ts`

**Interfaces:**
- Consumes: `LEAD_DECISION_MAX`, `LEAD_REASON_MAX` (Task 1).
- Produces: bentuk blok ```json yang diminta prompt kini memuat `choice` & `missing`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/lead-prompt.test.ts`:

```ts
import { LEAD_DECISION_MAX, LEAD_REASON_MAX } from "@hanoman/shared";
import { leadPrompt as _lp } from "../src/services/lead/prompt";

// SPEC-480 · ADR-0098 · putusan yang panjang bukan cuma mahal, ia tak terpakai: peminta harus
// menebak opsi mana yang sebenarnya dipilih.
describe("leadPrompt · putusan ringkas & terstruktur (SPEC-480)", () => {
  const OPTS = ["Node 20 LTS", "Node 22"];

  it("names the length budget in numbers, not adjectives", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toContain(String(LEAD_DECISION_MAX));
    expect(p).toContain(String(LEAD_REASON_MAX));
  });

  it("forbids the three things that made past decisions unusable", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toMatch(/ringkasan ulang konteks/i);
    expect(p).toMatch(/latar belakang/i);
    expect(p).toMatch(/alternatif yang tak diminta/i);
  });

  it("demands a structured choice whenever options are on the table", () => {
    const p = leadPrompt({ ...q, options: OPTS }, ctx());
    expect(p).toContain("1. Node 20 LTS");
    expect(p).toContain("2. Node 22");
    expect(p).toMatch(/"choice"/);
    expect(p).toMatch(/salah satu opsi di atas/i);
  });

  it("keeps the json shape example carrying both new fields", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toContain('"choice"');
    expect(p).toContain('"missing"');
  });

  // ADR-0098 mengamandemen AC-22 ADR-0091: larangan "tidak tahu" tetap, tapi kini punya SATU
  // pengecualian bernama — dan pengecualian itu wajib menyebut apa yang kurang.
  it("still forbids a bare `tidak tahu` while naming the one narrow exception", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toContain("tidak tahu");
    expect(p).toMatch(/missing/);
    expect(p).toMatch(/bisa disediakan seseorang|hal konkret/i);
  });

  // Yang lama tak boleh hilang: anggaran waktu SPEC-432 adalah alasan lead bisa memutuskan sama sekali.
  it("keeps the SPEC-432 time budget intact", () => {
    expect(leadPrompt(q, ctx({ timeoutSec: 300 }))).toContain("300 detik");
  });
});
void _lp;
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-prompt.test.ts
```
Expected: FAIL — prompt belum menyebut `choice`/`missing`/angka batas.

- [x] **Step 3: Ubah `prompt.ts`**

Ganti import baris 1:

```ts
import { LEAD_ACTIONS, LEAD_DECISION_MAX, LEAD_REASON_MAX, type LeadKind } from "@hanoman/shared";
```

Di blok opsi (sesudah loop `q.options.entries()`), tambahkan satu baris:

```ts
    lines.push(`Salah satu dari daftar itu WAJIB kamu pilih lewat field \`choice\` — isi nomornya ("2") atau labelnya persis. Pilihan di luar daftar ditolak server, dicatat sebagai penolakan, dan peminta kembali menunggu manusia.`);
```

Ganti butir 2 pada "Cara kerja" dengan:

```ts
  lines.push("2. Putuskan. Kalau setelah membaca kamu masih ragu, TETAP putuskan: pilih opsi yang PALING MUDAH DIBATALKAN, lalu tandai `confidence: \"ragu\"`. \"Tidak tahu\" bukan jawaban, dan meminta manusia memutuskan adalah persis keadaan yang kamu ada untuk menghapusnya. SATU pengecualian: bila jawabannya menuntut fakta konkret yang memang TIDAK ADA di repo maupun di konteks ini, isi `missing` dengan daftar pendek hal yang kurang — hal yang bisa disediakan seseorang, bukan keluhan — dan tetap tulis `decision` sebagai langkah paling aman sementara.");
```

Tambahkan blok baru tepat sebelum "## Bentuk jawaban (WAJIB)":

```ts
  lines.push("## Sepanjang apa (WAJIB)");
  lines.push(`Peminta jawabanmu adalah MESIN yang sedang menunggu, bukan pembaca laporan. \`decision\` paling banyak ${LEAD_DECISION_MAX} karakter (satu kalimat) dan \`reason\` paling banyak ${LEAD_REASON_MAX} karakter (dua-tiga kalimat). Yang lebih panjang dipangkas server sebelum sampai ke peminta.`);
  lines.push("JANGAN menuliskan: ringkasan ulang konteks yang sudah kamu terima di atas, latar belakang atau sejarah masalahnya, daftar alternatif yang tak diminta, maupun rencana kerja bertahap. Langsung putusannya dan alasannya.");
```

Ganti contoh blok json (`JSON.stringify({...})`) dengan:

```ts
  lines.push(JSON.stringify({
    decision: "keputusan yang dipilih, satu kalimat",
    choice: "nomor atau label opsi yang kamu pilih; kosongkan bila tak ada daftar opsi",
    reason: "alasannya, dua-tiga kalimat, menyebut bukti",
    refs: ["internal/docs/…", "ADR-00xx"],
    confidence: "tinggi | sedang | ragu",
    action: "none",
    missing: [],
    reply: "teks yang akan diketikkan ke terminal agen peminta (kosongkan bila tak relevan)",
  }, null, 2));
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-prompt.test.ts
```
Expected: PASS seluruh berkas.

- [x] **Step 5: Commit**

```bash
git add server/src/services/lead/prompt.ts server/test/lead-prompt.test.ts
git commit -m "feat(480): prompt lead menuntut choice, missing, dan batas panjang

Angka batas disebut eksplisit; tiga hal yang membuat putusan tak terpakai
dilarang; AC-22 diberi satu pengecualian bernama (missing).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Permukaan wire — `LeadAnswer`, `LeadDecisionView`, route

**Files:**
- Modify: `shared/src/dto.ts:142-163`
- Modify: `server/src/routes/lead.ts:7`, `:95-106`
- Modify: `server/src/services/lead/trail.ts` (`toDecisionView`)
- Test: `server/test/lead-routes.test.ts`

**Interfaces:**
- Consumes: `takeDelivery` (Task 3), `zLeadChoice` (Task 1), kolom baru (Task 2).
- Produces: `LeadAnswer` bertambah `choice: LeadChoice | null` & `missing: string[]`; `LeadDecisionView` bertambah `choice: string | null`, `choiceIndex: number | null`, `options: string[]`, `missing: string[]`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/lead-routes.test.ts` (pakai helper `app`/`token` yang sudah ada di berkas itu — bila namanya berbeda, ikuti berkasnya):

```ts
// SPEC-480 · ADR-0098 · pintu #1 harus bisa dibaca mesin: peminta tak boleh menafsirkan prosa.
describe("POST /lead/decisions · balasan terstruktur (SPEC-480)", () => {
  it("returns the resolved choice, the missing list, and clamped prose", async () => {
    const res = await post("/api/lead/decisions", {
      projectId: "demo",
      question: "Node berapa untuk runtime baru?",
      options: ["Node 20 LTS", "Node 22"],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.choice).toEqual({ index: 2, option: "Node 22" });
    expect(body.missing).toEqual([]);
    expect(body.decision.length).toBeLessThanOrEqual(241);
    expect(body.reason.length).toBeLessThanOrEqual(481);
  });
});
```

> Agen lead di test ini disuntik lewat mekanisme yang sudah dipakai berkas tersebut (stub `think`).
> Keluaran yang distub: `{"decision":"Node 22","choice":"2","reason":"LTS berikutnya sudah dekat."}`.
> Bila `lead-routes.test.ts` belum punya jalur stub `think`, tambahkan `vi.mock` atas
> `../src/services/lead/brain` yang mengembalikan blok json itu — pola yang sama dipakai
> `lead-decide.test.ts` lewat `DecideDeps.think`.

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-routes.test.ts
```
Expected: FAIL — `body.choice` `undefined`.

- [x] **Step 3: Perluas DTO**

`shared/src/dto.ts`, di `zLeadDecisionView` sesudah `action: zLeadAction,`:

```ts
  // SPEC-480 · ADR-0098 · pilihan sebagai data. `options` adalah menu yang DIKIRIM peminta, jadi
  // jejaknya bisa dibaca ulang tanpa peminta ("opsi 2 dari 3").
  choice: z.string().nullable().default(null),
  choiceIndex: z.number().nullable().default(null),
  options: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
```

dan di `zLeadAnswer` sesudah `action: zLeadAction,`:

```ts
  choice: zLeadChoice.nullable().default(null),
  missing: z.array(z.string()).default([]),
```

Pastikan `zLeadChoice` ikut diimpor/di-reekspor di `shared/src/index.ts` bila berkas itu mengekspor nama satu per satu (`grep -n "zLeadVerdict" shared/src/index.ts` untuk memastikan polanya).

- [x] **Step 4: Perluas `toDecisionView`**

`server/src/services/lead/trail.ts`, di dalam objek yang dikembalikan `toDecisionView`, sesudah `action: …`:

```ts
    choice: r.choice, choiceIndex: r.choiceIndex,
    options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [],
    missing: Array.isArray(r.missing) ? (r.missing as unknown[]).map(String) : [],
```

- [x] **Step 5: Perluas route**

`server/src/routes/lead.ts` — ganti import baris 7:

```ts
import { decide, takeDelivery } from "../services/lead/decide";
```

dan ganti baris 95-106 dengan:

```ts
    // Kontrak eksplisit tak mengetik ke pane; yang diambil dari saluran pengiriman adalah salinan
    // TERPANGKAS-nya — jejak DB tetap memegang prosa lead yang utuh (SPEC-480).
    const sent = takeDelivery(row.id);
    if (row.status === "gagal") return reply.code(504).send({ error: row.reason, id: row.id });
    // Lead memutuskan LALU melapor: tindakan yang menyusul dijalankan sebelum balasan dikirim,
    // supaya peminta tak menerima keputusan yang belum berlaku di dunia nyata.
    if (row.action !== "none") { try { await applyAction(row); } catch { /* jejak tetap ada */ } }
    const answer: LeadAnswer = {
      id: row.id,
      decision: sent?.decision ?? row.answer,
      reason: sent?.reason ?? row.reason,
      refs: Array.isArray(row.refs) ? (row.refs as unknown[]).map(String) : [],
      confidence: row.confidence as LeadAnswer["confidence"],
      action: row.action as LeadAnswer["action"],
      choice: sent?.choice ?? (row.choice ? { index: row.choiceIndex ?? 1, option: row.choice } : null),
      missing: sent?.missing ?? (Array.isArray(row.missing) ? (row.missing as unknown[]).map(String) : []),
    };
    return reply.code(201).send(answer);
```

- [x] **Step 6: Jalankan test — pastikan LULUS**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-routes.test.ts
./node_modules/.bin/vitest run --dir shared shared/src/lead.test.ts
```
Expected: PASS keduanya.

- [x] **Step 7: Typecheck**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```
Expected: keluar tanpa error.

- [x] **Step 8: Commit**

```bash
git add shared/src/dto.ts shared/src/index.ts server/src/routes/lead.ts server/src/services/lead/trail.ts server/test/lead-routes.test.ts
git commit -m "feat(480): choice & missing menyeberang di LeadAnswer dan jejak

Balasan pintu #1 memuat pilihan terstruktur + prosa terpangkas; jejak
mengekspos choice/choiceIndex/options/missing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Pintu deteksi mengetik teks yang dirakit, bukan prosa yang dipungut

**Files:**
- Modify: `server/src/services/lead/detect.ts:8`, `:252-292`
- Test: `server/test/lead-detect.test.ts`

**Interfaces:**
- Consumes: `takeDelivery` (Task 3), `leadReplyText` (Task 1).
- Produces: tak ada API baru; `runChain` tetap seperti SPEC-474.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/lead-detect.test.ts` (ikuti helper `deps`/`makeDeps` yang sudah ada di berkas itu; yang penting: `decide` distub mengembalikan baris ber-`choice`, dan `send` merekam teks yang diketik):

```ts
// SPEC-480 · ADR-0098 · yang diketik ke kolom jawaban bebas menyebut LABEL opsi verbatim. Prosa
// lead tak lagi jadi satu-satunya jembatan: SPEC-452 mengukur apa yang terjadi saat kolom itu
// menerima kalimat yang harus ditafsirkan ulang di seberang.
describe("scanAndAnswer · teks jawaban dirakit dari pilihan (SPEC-480)", () => {
  it("types the chosen option verbatim instead of the raw prose", async () => {
    const typed: string[] = [];
    const d = detectDeps({
      pane: () => DIALOG_SCREEN,           // layar dialog dua opsi dari fixture berkas ini
      send: async (_id, text) => { typed.push(text); return true; },
      decide: async () => rowWith({ choice: "Node 22", choiceIndex: 2, answer: "Node 22 saja" }),
    });
    await scanAndAnswer(d);
    expect(typed[0]).toContain("Pilih: Node 22");
  });

  it("says what is missing when lead declared the context insufficient", async () => {
    const typed: string[] = [];
    const d = detectDeps({
      pane: () => DIALOG_SCREEN,
      send: async (_id, text) => { typed.push(text); return true; },
      decide: async () => rowWith({ missing: ["versi Node produksi"] }),
    });
    await scanAndAnswer(d);
    expect(typed[0]).toContain("Belum bisa kuputuskan");
    expect(typed[0]).toContain("versi Node produksi");
  });
});
```

> `rowWith` = helper kecil di berkas test yang mengembalikan objek `LeadDecision` palsu **dan**
> menaruh `LeadDelivery` padanannya ke saluran pengiriman. Karena `takeDelivery` adalah state modul,
> cara paling bersih di test ini: panggil `decide` asli yang distub lewat `decideDeps.think`
> (pola `lead-decide.test.ts`) alih-alih memalsukan barisnya. Bila berkas test yang ada memang
> memalsukan `decide`, tambahkan `deps.delivery` opsional — **jangan** memakai `takeDelivery` dari
> dua tempat.

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-detect.test.ts
```
Expected: FAIL — yang diketik masih `row.answer` mentah.

- [x] **Step 3: Ubah `detect.ts`**

Ganti import baris 8:

```ts
import { decide, prodDecideDeps, takeDelivery, type DecideDeps } from "./decide";
```

dan tambahkan `leadReplyText` ke import `@hanoman/shared` di baris 2:

```ts
import { leadReplyText, type Agent, type Lead } from "@hanoman/shared";
```

Ganti baris 284-288 (`// `reply` adalah penghalusan…` sampai `const reply = …`) dengan:

```ts
    // SPEC-480 · teks yang diketik DIRAKIT dari putusan terstruktur, bukan dipungut dari prosa:
    // pilihan yang terselesaikan disebut dengan LABEL VERBATIM, konteks yang kurang disebut apa
    // adanya, dan panjangnya dipagari sebelum menyentuh `goalChunks`. Saluran `takeDelivery` bisa
    // meleset (baris lahir dari jalur lain) — yang selalu ada adalah `answer`, dan mengetik string
    // kosong ke pane tak pernah boleh terjadi.
    const sent = takeDelivery(row.id);
    const reply = (sent ? leadReplyText(sent) : "") || row.answer;
```

Perbarui juga blok `notes` di atasnya (baris 255-258) supaya menyebut kontrak baru:

```ts
    const notes = [`Sesi ini menunggu di terminal; teks di bawah adalah layar terakhirnya. Jawablah sebagai masukan yang bisa langsung diketik ke terminal itu (isi \`reply\`).`];
    if (read.choices.length) {
      notes.push("Layarnya adalah dialog pilihan. Isi `choice` dengan nomor atau label opsi yang kamu pilih — server yang merangkai kalimat jawabannya, jadi `reply` tak perlu mengulanginya.");
    }
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

```bash
./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-detect.test.ts
```
Expected: PASS seluruh berkas — termasuk test rantai SPEC-474 yang tak boleh berubah perilakunya.

- [x] **Step 5: Commit**

```bash
git add server/src/services/lead/detect.ts server/test/lead-detect.test.ts
git commit -m "feat(480): jawaban ke pane dirakit dari putusan terstruktur

leadReplyText menyebut label opsi verbatim / apa yang kurang; rantai dialog
SPEC-474 tak berubah.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Panel lead menampilkan pilihan & kekurangan konteks

**Files:**
- Modify: `src/src/screens/LeadScreen.tsx:113-150`
- Test: `src/test/lead-screen.test.tsx`

**Interfaces:**
- Consumes: `LeadDecisionView.choice/choiceIndex/options/missing` (Task 5).
- Produces: —

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/lead-screen.test.tsx` (dan tambahkan keempat field baru ke fixture `DECISIONS` yang sudah ada — `choice: null, choiceIndex: null, options: [], missing: []` untuk `d1`/`d2`):

```ts
describe("LeadScreen · pilihan terstruktur (SPEC-480)", () => {
  it("shows which option was chosen, out of how many", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [{
      ...DECISIONS.items[0], id: "d9",
      choice: "Node 22", choiceIndex: 2, options: ["Node 20 LTS", "Node 22"], missing: [],
    }] });
    render(<LeadScreen projects={[]} onProjectChanged={() => {}} />);
    expect(await screen.findByText("opsi 2/2")).toBeTruthy();
    expect(await screen.findByText(/Node 22/)).toBeTruthy();
  });

  it("shows what lead said was missing", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [{
      ...DECISIONS.items[0], id: "d8",
      choice: null, choiceIndex: null, options: [], missing: ["versi Node produksi"],
    }] });
    render(<LeadScreen projects={[]} onProjectChanged={() => {}} />);
    expect(await screen.findByText("kurang konteks")).toBeTruthy();
    expect(await screen.findByText(/versi Node produksi/)).toBeTruthy();
  });
});
```

> Props `LeadScreen` diambil dari pemakaian yang sudah ada di berkas test ini — pakai persis
> bentuk `render(...)` yang dipakai test lain di berkas tersebut.

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/lead-screen.test.tsx
```
Expected: FAIL — teks "opsi 2/2" tak ada.

- [x] **Step 3: Render badge di `DecisionRow`**

`src/src/screens/LeadScreen.tsx` — sisipkan sesudah badge `{d.weighty && …}` (baris 129):

```tsx
        {d.choiceIndex !== null && d.options.length > 0 &&
          <Badge tone="accent" size="sm">{`opsi ${d.choiceIndex}/${d.options.length}`}</Badge>}
        {d.missing.length > 0 && <Badge tone="warn" size="sm">kurang konteks</Badge>}
```

dan sesudah blok `{d.refs.length > 0 && (…)}` (baris 150):

```tsx
      {d.missing.length > 0 && (
        <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          Yang kurang: {d.missing.join(" · ")}
        </div>
      )}
```

Lalu, di baris jawaban (baris 136-138), sebutkan label opsi terpilih saat ada:

```tsx
      <div style={{ marginTop: 4, color: "var(--text-strong)", fontWeight: 500, whiteSpace: "pre-wrap" }}>
        {d.choice ?? d.answer || <em style={{ fontWeight: 400, color: "var(--text-muted)" }}>tak ada jawaban</em>}
      </div>
```

> Bila `tone="accent"` bukan tone yang sah di `Badge` design system, pakai `"neutral"` —
> cek `src/src/ds/Badge.tsx` untuk daftar tone yang ada.

- [x] **Step 4: Jalankan test — pastikan LULUS**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/lead-screen.test.tsx
```
Expected: PASS seluruh berkas (test SPEC-409 lama ikut hijau).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/LeadScreen.tsx src/test/lead-screen.test.tsx
git commit -m "feat(480): panel lead menampilkan opsi terpilih & kekurangan konteks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs Source of Truth + ADR-0098

**Files:**
- Create: `internal/docs/adr/0098-putusan-lead-ringkas-terstruktur.md`
- Modify: `internal/docs/README.md` (daftar ADR)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/data-model.md` (empat kolom `LeadDecision`)
- Modify: `internal/docs/architecture/api-contract.md` (`LeadAnswer`/`LeadDecisionView`)
- Modify: `internal/skills/hanoman/SKILL.md` (butir hanoman-lead)

**Interfaces:**
- Consumes: keputusan Task 1-7.
- Produces: —

- [ ] **Step 1: Verifikasi nomor ADR masih bebas**

```bash
ls internal/docs/adr | tail -3
for w in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do ls "$w/internal/docs/adr" 2>/dev/null | grep -E '^009[7-9]'; done
git branch -a --format='%(refname:short)' | while read b; do git ls-tree --name-only "$b" internal/docs/adr/ 2>/dev/null | grep -E '009[7-9]'; done | sort -u
```
Expected: `0097-kredensial-telegram-…` muncul (milik worktree `spec-477`), `0098` **tidak** muncul di mana pun. Bila 0098 ternyata terpakai, naikkan ke nomor bebas berikutnya dan perbarui seluruh rujukan `ADR-0098` di kode & doc.

- [ ] **Step 2: Tulis ADR-0098**

Buat `internal/docs/adr/0098-putusan-lead-ringkas-terstruktur.md` dengan bentuk ADR repo ini (lihat `0093-dependency-antar-backlog.md` sebagai contoh: Status · Konteks · Keputusan · Konsekuensi · Alternatif ditolak · Gotcha). Isi yang **wajib** ada:

- **Status:** Diterima · 2026-08-01 · SPEC-480 · **mengamandemen ADR-0091 (AC-1 & AC-22)**.
- **Konteks:** `options` sudah dikirim empat pemanggil (`detect.ts` + tiga pintu `pulse.ts`) tapi verdict tak punya field yang menjawab "opsi mana"; jembatan satu-satunya adalah harapan bahwa prosa `decision` dan `action` sepakat, dan `orderReadyWork` bahkan mem-`split` prosa dengan regex. Tak ada batas panjang, sementara `reply` masuk ke pane lewat `goalChunks` dan seluruh prosa ditulis di dalam anggaran `timeoutSec` yang SPEC-432 buktikan sebagai pembatas nyata.
- **Keputusan:** (1) `choice` + `missing` di `zLeadVerdict`, keduanya longgar saat parsing; (2) `resolveChoice` fail-closed — ambigu tak pernah ditebak; (3) pilihan di luar daftar **ditolak-dan-dicatat**, `kind` **tidak** ditulis ulang; (4) `action` boleh diturunkan dari opsi **hanya saat lead diam**, pertentangan → `none` + notifikasi; (5) batas `240`/`480` ditegakkan di prompt & dipangkas **saat pengiriman** — jejak menyimpan yang utuh; (6) `missing` memaksa `ragu` ⇒ notifikasi; (7) empat kolom aditif nullable.
- **Konsekuensi:** peminta membaca `choice` alih-alih menafsirkan prosa; jejak jadi bisa diaudit sendiri (`options` tersimpan); larangan "tidak tahu" AC-22 kini punya satu pengecualian bernama, dan pengecualian itu **berujung pada operator** (weighty), bukan pada diam.
- **Alternatif ditolak:** `choice` sebagai enum/number di zod (pilihan karangan lenyap jadi "keluaran rusak" — persis peristiwa yang paling layak dilaporkan); batas panjang sebagai `.max()` zod (keluaran sedikit meleset jadi `gagal` total); `kind: "refusal"` untuk pilihan yang ditolak (SPEC-432: `kind` yang berubah merusak idempotensi denyut); field urutan terstruktur untuk `orderReadyWork` (pertanyaannya "urutkan N", bukan "pilih satu" — layak spec sendiri).
- **Gotcha:** (a) `clampProse` melipat spasi, dan itu **bukan** kosmetik — satu baris baru yang lolos ke pane adalah `Enter` yang mengirim jawaban dialog separuh jadi (kelas SPEC-452); (b) catatan `DITOLAK`/`KONFLIK` ditempel **sesudah** pemangkasan, kalau tidak justru bagian yang paling perlu dibaca yang terpotong; (c) adopsi `action` dari opsi hanya sah karena label opsi dirakit **pemanggil**, bukan lead — untuk label bebas (dialog `AskUserQuestion`) `optionActionHint` mengembalikan `null` dan tak ada yang diadopsi.

- [ ] **Step 3: Taut ADR di KEDUA index**

`internal/docs/README.md` — sisipkan di puncak daftar `## adr`:

```markdown
- [0098 — Putusan lead ringkas & terstruktur: `choice` tervalidasi, `missing`, batas panjang saat pengiriman](adr/0098-putusan-lead-ringkas-terstruktur.md)
```

`internal/docs/adr/README.md` — tambahkan narasinya di posisi yang sama dengan ADR terbaru lain (satu paragraf: apa yang diamandemen, kenapa, gotcha-nya).

- [ ] **Step 4: Perbarui data-model & api-contract**

`internal/docs/architecture/data-model.md` — pada bagian `LeadDecision`, tambahkan keempat kolom + satu kalimat kenapa `options` ikut disimpan (jejak tak bisa dibaca ulang tanpa menunya).

`internal/docs/architecture/api-contract.md` — pada `POST /api/lead/decisions`, tambahkan `choice` & `missing` di bentuk balasan, dan sebutkan bahwa `decision`/`reason` yang dikembalikan **terpangkas** sementara `GET /lead/decisions` memberi prosa penuh.

- [ ] **Step 5: Perbarui SKILL.md**

`internal/skills/hanoman/SKILL.md` — tambahkan satu butir di rangkaian butir hanoman-lead (sesudah butir SPEC-474), memuat: `choice` tervalidasi terhadap opsi peminta · out-of-list ditolak-dan-dicatat tanpa mengubah `kind` · `action` diturunkan dari opsi hanya saat lead diam · batas 240/480 dipangkas saat pengiriman & jejak tetap penuh · `missing` memaksa `ragu` · ADR-0098 mengamandemen AC-22.

- [ ] **Step 6: Verifikasi integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || ./node_modules/.bin/tsx cli/src/index.ts docs index --check
```
Expected: laporan tanpa berkas yatim. Bila CLI belum ter-build, cukup pastikan tautan ADR ada di kedua README secara manual.

- [ ] **Step 7: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(480): ADR-0098 putusan lead ringkas & terstruktur

Tertaut di README index + adr/README; data-model & api-contract menyusul
kolom dan field baru; SKILL.md dapat butir permanennya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Verifikasi akhir ber-skop perubahan

**Files:** —

**Interfaces:**
- Consumes: seluruh task di atas.
- Produces: bukti hijau sebelum push.

- [ ] **Step 1: Jalankan test yang tersentuh perubahan**

```bash
./node_modules/.bin/vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: PASS. **Jebakan:** `--changed` menyalakan `passWithNoTests` — baca jumlah berkas & test yang benar-benar berjalan; "no test files" **bukan** bukti.

- [ ] **Step 2: Typecheck paket yang tersentuh saja**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```
Expected: ketiganya keluar tanpa error. (`pnpm -r typecheck` **dilarang** — satu tsc per paket sekaligus di mesin yang menjalankan beberapa sesi.)

- [ ] **Step 3: Uji endpoint sungguhan sekali di akhir**

Task ini menyentuh `POST /api/lead/decisions`, jadi endpointnya diuji nyata sekali:

```bash
export HANOMAN_HOME="$(mktemp -d)"
cd server && ./node_modules/.bin/prisma migrate deploy && cd ..
node server/dist/server.js &   # atau: pnpm dev --filter ./server
# lalu, dengan project ber-leadOptIn dan lead.enabled=false (jalur 409 yang tak memanggil agen):
curl -s -X POST localhost:8787/api/lead/decisions -H 'content-type: application/json' \
  -d '{"projectId":"demo","question":"q?","options":["a","b"]}' | head -c 400
kill %1
```
Expected: server boot tanpa error migrasi (kolom baru terpasang) dan endpoint menjawab `409 lead tidak aktif` — membuktikan rute & skema hidup tanpa membakar giliran agen. Bila lead dinyalakan, balasan `201` memuat `choice`.

- [ ] **Step 4: Pastikan plan ini tak menyisakan kotak**

```bash
grep -c '^- \[ \]' docs/superpowers/plans/2026-08-01-putusan-lead-ringkas-terstruktur-spec-480.md
```
Expected: `0`.

- [ ] **Step 5: Commit sisa & push**

```bash
git status --porcelain
git add -A && git commit -m "chore(480): centang plan SPEC-480

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin HEAD:refs/heads/hanoman/spec-480
```
Expected: push sukses (fast-forward).
