# Mode goal codex memakai goal native codex — Implementation Plan (SPEC-397)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi codex ber-mode-goal memasang **goal native codex** lewat `/goal` di TUI, di samping gate sh `Stop` yang sudah ada — sehingga kondisi goal prosa benar-benar dievaluasi di codex dan statusnya terlihat operator.

**Architecture:** Tiga sentuhan. (1) `runner/src/goal.ts` mendapat fungsi murni `goalChunks()` yang memotong kondisi jadi potongan aman terhadap deteksi paste TUI codex. (2) `armGoalInTui` di `server/src/services/pty.ts` jadi sadar-agen: mengirim potongan ber-jeda, memverifikasi codex lewat penanda runtime goal-nya sendiri, dan mengirim ulang bila gagal. (3) Call site `createSession` mencabut gerbang `agent === "claude"`. Gate sh (`codexGoalScript`, `codexHookArgs`, `GOAL_MAX_BLOCKS`) **tidak disentuh**.

**Tech Stack:** TypeScript strict · Vitest (nama project = **nama paket**: `@hanoman/runner`, `@hanoman/server`) · tmux (socket test `hanoman-test`) · node-pty · pnpm workspace.

## Global Constraints

- **Batas paste TUI codex = 1024 karakter dalam satu burst PTY** (terukur di codex-cli 0.146.0: 1023 literal, 1024 → `[Pasted Content 1024 chars]`). Deteksinya **per-burst PTY, bukan per-invokasi `send-keys`** — 4×500 karakter tanpa jeda tetap kena (`[Pasted Content 1500 chars]`).
- **Ukuran potongan = 500, jeda = 50 ms.** Alasan mengikat: 2×500 = 1000 < 1024, jadi satu penggabungan burst pun masih literal. Jangan pakai 1023 — nol margin.
- **`GOAL_MAX` tetap 4000** — terverifikasi diterima utuh oleh codex 0.146.0. Jangan menambahkan batas khusus codex.
- **Verifikasi claude tidak boleh diubah** (`paneText.includes("/goal")` tetap). Tak ada bukti terukur soal penanda claude.
- **Verifikasi codex tidak boleh memakai substring `/goal`** — pane memuat `/goal …` juga saat degradasi paste, jadi assertion itu lulus palsu.
- **Gate sh tidak disentuh.** `runner/src/codex-settings.ts` tidak berubah sama sekali.
- **Tanpa skema, migration, endpoint, kontrak API, atau knob baru.**
- **Scope verifikasi sesi ini `changed`** (ADR-0080): jalankan hanya test yang tersentuh; typecheck per paket. Bukan suite penuh, bukan `pnpm -r typecheck`, bukan build penuh.
- **Prefiks env test (terukur di sesi ini, jangan disederhanakan):**

  ```
  env -u NODE_ENV \
    DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397" \
    TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397_test"
  ```

  Env shell mesin ini menunjuk **prod** (`NODE_ENV=production`, `DATABASE_URL=…/hanoman_prod`), jadi
  `NODE_ENV` wajib dibuang. Tapi `-u DATABASE_URL` **saja tidak cukup dan malah fatal**: worktree ini
  tak punya `.env`, dan `server/vitest.config.ts` **melempar saat dimuat** bila tak ada
  `DATABASE_URL`/`TEST_DATABASE_URL` — dan karena root memuat config **semua** project, runner pun
  gagal start. Basis DB spec-unik (`hanoman397`) dipakai supaya vitest sesi tetangga tak men-truncate
  DB yang sama di tengah run.
- **Nama project vitest = nama paket, bukan nama direktori:** `@hanoman/runner`, `@hanoman/server`,
  dan — tak terduga — **`@hanoman/app`** untuk direktori `src/`. `--project runner` diterima tanpa
  error tapi mengembalikan **"No test files found", exit 0** — hijau palsu yang mudah terlewat, sama
  jebakan dengan `passWithNoTests`.
- **`vitest --changed` di tingkat root WAJIB `--no-file-parallelism`.** Run root **tidak** menghormati
  `fileParallelism: false` milik `server/vitest.config.ts`, dan seluruh test server berbagi satu
  Postgres yang di-seed ulang tiap berkas. Terukur atas set yang **sama persis** (90 berkas — blast
  radius menyentuh `runner/src/goal.ts` + `server/src/services/pty.ts`): **181 gagal / 736 test**
  paralel, **736 lulus / 0 gagal** serial (191 dtk). Kegagalannya menyesatkan —
  `expected undefined to be truthy` pada baris outbox, seolah regresi sync, padahal berkasnya
  **lulus saat diisolasi**.
- Prasyarat sekali di awal (worktree baru tak punya `node_modules`): `pnpm install`,
  `pnpm --filter ./server exec prisma generate`, lalu buat & migrasikan DB test spec ini:

  ```bash
  docker exec hanoman-db-1 psql -U hanoman -d postgres -c "CREATE DATABASE hanoman397_test"
  env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397_test" \
    pnpm --filter ./server exec prisma migrate deploy
  ```

  **Sudah dijalankan di sesi ini** (27 tabel, 32 migration).

## File Structure

| Berkas | Tanggung jawab | Aksi |
| --- | --- | --- |
| `runner/src/goal.ts` | kondisi goal: default, resolusi, perataan, **pemotongan keystroke** | modifikasi — tambah `GOAL_TUI_PASTE_LIMIT`, `GOAL_CHUNK`, `goalChunks` |
| `runner/test/goal.test.ts` | kontrak fungsi murni kondisi goal | modifikasi — tambah blok `goalChunks` |
| `server/test/fixtures/fake-codex-goal.sh` | berdiri sebagai `codex` yang memancarkan penanda runtime goal saat menerima `/goal` | **buat** |
| `server/src/services/pty.ts` | mesin sesi tmux; `armGoalInTui` = jalur kedua mode goal | modifikasi — `armGoalInTui` sadar-agen + call site `createSession` |
| `server/test/pty.test.ts` | kontrak `createSession`/`armGoalInTui` | modifikasi — tambah 4 test |

Tak ada berkas baru di sisi produksi: `runner/src/index.ts` sudah `export * from "./goal"`, jadi
`goalChunks` otomatis tersedia sebagai `@hanoman/runner`.

---

### Task 1: `goalChunks()` — pemotong keystroke aman-paste

**Files:**
- Modify: `runner/src/goal.ts` (tambah di akhir berkas, sesudah `goalOneLine`)
- Test: `runner/test/goal.test.ts`

**Interfaces:**
- Consumes: `goalOneLine(cond: string): string`, `defaultGoalCondition(a: GoalArgs): string`, `GOAL_MAX: number` — ketiganya sudah ada di `runner/src/goal.ts`.
- Produces: `GOAL_TUI_PASTE_LIMIT: number` (= 1024), `GOAL_CHUNK: number` (= 500), `goalChunks(line: string, size?: number): string[]`. Task 3 memakainya lewat `@hanoman/runner`.

- [x] **Step 1: Write the failing test**

Ganti baris `import` di baris 2 `runner/test/goal.test.ts` menjadi:

```ts
import {
  GOAL_MAX, GOAL_CHUNK, GOAL_TUI_PASTE_LIMIT,
  defaultGoalCondition, resolveGoalCondition, goalOneLine, goalChunks,
} from "../src/goal";
```

lalu tambahkan di akhir berkas:

```ts
// SPEC-397 · ADR-0085 — TUI codex mengubah masukan yang datang dalam SATU burst ≥ 1024 karakter
// menjadi lampiran `[Pasted Content N chars]`, dan begitu itu terjadi slash-dispatch tak jalan:
// `/goal` terkirim sebagai pesan chat biasa, tanpa error dan tanpa goal.
describe("goalChunks", () => {
  it("merekonstruksi kondisi utuh tanpa kehilangan atau menambah karakter", () => {
    const line = goalOneLine(defaultGoalCondition(args));
    expect(goalChunks(line).join("")).toBe(line);
  });

  it("tak ada potongan yang mencapai batas paste, bahkan untuk kondisi GOAL_MAX", () => {
    const chunks = goalChunks("x".repeat(GOAL_MAX));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
  });

  it("dua potongan bersebelahan yang menyatu pun masih di bawah batas (margin sengaja)", () => {
    // Ditulis dengan kursor `prev`, bukan indeks: `chunks[i - 1]` bertipe `string | undefined` di
    // bawah TS strict, dan menutupinya dengan `?? ""` justru akan menyembunyikan potongan kosong.
    let prev: string | undefined;
    for (const cur of goalChunks("y".repeat(GOAL_MAX))) {
      if (prev !== undefined) {
        expect(prev.length + cur.length).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
      }
      prev = cur;
    }
  });

  it("kondisi pendek tetap satu potongan (tak ada invokasi send-keys sia-sia)", () => {
    expect(goalChunks("kondisi pendek")).toEqual(["kondisi pendek"]);
  });

  it("string kosong tak menghasilkan potongan", () => {
    expect(goalChunks("")).toEqual([]);
  });

  it("GOAL_CHUNK punya margin terhadap batas paste", () => {
    expect(GOAL_CHUNK * 2).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397" TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397_test" pnpm vitest run --project @hanoman/runner runner/test/goal.test.ts`
Expected: FAIL — 6 test baru gagal (`TypeError: goalChunks is not a function`, dan
`GOAL_CHUNK * 2` → `expected value must be number or bigint, received "undefined"`), 5 test lama tetap lulus.

- [x] **Step 3: Write minimal implementation**

Tambahkan di akhir `runner/src/goal.ts`:

```ts
// SPEC-397 · ADR-0085 — TUI codex mengubah masukan yang datang dalam SATU burst ≥ 1024 karakter
// menjadi lampiran `[Pasted Content N chars]`. Begitu itu terjadi isi composer bukan lagi teks yang
// dimulai `/goal`, jadi slash-dispatch TAK jalan: kondisinya terkirim sebagai pesan chat biasa —
// tanpa error, tanpa goal, tanpa jejak kegagalan. Terukur di codex-cli 0.146.0: 1023 masih literal,
// 1024 sudah paste.
export const GOAL_TUI_PASTE_LIMIT = 1024;

// Deteksi paste itu PER-BURST PTY, bukan per-invokasi `send-keys`: potongan yang dikirim tanpa jeda
// digabung ulang oleh satu `read()` dan tetap kena (terukur: 4×500 tanpa jeda → paste 1500 char).
// Karena itu 500, bukan 1023 — bila jeda gagal sekali dan dua potongan menyatu, 2×500 = 1000 MASIH
// di bawah batas. Potongan 1023 tak punya margin sama sekali.
export const GOAL_CHUNK = 500;

/** Potong kondisi satu-baris jadi potongan yang aman dikirim sebagai keystroke tmux. */
export function goalChunks(line: string, size = GOAL_CHUNK): string[] {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size));
  return out;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397" TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397_test" pnpm vitest run --project @hanoman/runner runner/test/goal.test.ts`
Expected: PASS — 6 test baru + 5 test lama hijau (11 total).

- [x] **Step 5: Typecheck paket runner**

Run: `pnpm --filter ./runner typecheck`
Expected: exit 0, tanpa output. (Script paket ini sudah `tsc --noEmit`; jangan panggil `tsc -p .` telanjang — tanpa `--noEmit` ia menulis `.js` ke `src/` dan `test/`.)

- [x] **Step 6: Commit**

```bash
git add runner/src/goal.ts runner/test/goal.test.ts
git commit -m "feat(spec-397): goalChunks memotong kondisi goal di bawah batas paste TUI codex"
```

---

### Task 2: Fixture agen palsu yang memancarkan penanda goal codex

**Files:**
- Create: `server/test/fixtures/fake-codex-goal.sh`

**Interfaces:**
- Consumes: tak ada.
- Produces: skrip sh yang mencetak `args: $*`, lalu meng-echo stdin baris demi baris, **dan** memancarkan `Goal active  Objective: diterima` + `Pursuing goal (1s)` begitu sebuah baris memuat `/goal`. Task 3 memakainya lewat `process.env.HANOMAN_CODEX_BIN`.

Fixture ini task sendiri karena ia yang membuat perbedaan claude↔codex bisa **diukur** tanpa memanggil
model. `fake-claude.sh` yang sudah ada (`exec cat`) memantulkan `/goal …` tapi **tak pernah**
memancarkan penanda goal — itulah kontrol negatif untuk jebakan lulus-palsu.

- [x] **Step 1: Buat fixture**

Isi `server/test/fixtures/fake-codex-goal.sh`:

```sh
#!/bin/sh
# Berdiri sebagai `codex` di test PTY (SPEC-397 · ADR-0085). Seperti fake-claude.sh ia mencetak
# argv-nya lalu meng-echo stdin, TAPI ia juga memancarkan penanda runtime goal codex begitu
# menerima baris `/goal …` — persis yang dilakukan codex sungguhan (`• Goal active  Objective: …`
# di transcript + `Pursuing goal (Ns)` di status line).
#
# Kenapa bukan `exec cat`: yang diuji justru bahwa hanoman TIDAK menganggap sesi ter-arm hanya
# karena pane memuat teks `/goal`. fake-claude.sh tetap dipakai sebagai kontrol negatif.
echo "args: $*"
while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    */goal*) printf 'Goal active  Objective: diterima\nPursuing goal (1s)\n' ;;
  esac
done
```

- [x] **Step 2: Jadikan executable & buktikan perilakunya tanpa tmux**

```bash
chmod +x server/test/fixtures/fake-codex-goal.sh
printf '/goal kondisi\nbaris lain\n' | server/test/fixtures/fake-codex-goal.sh --flag
```

Expected, urut: `args: --flag` · `/goal kondisi` · `Goal active  Objective: diterima` ·
`Pursuing goal (1s)` · `baris lain` — dan **tak ada** penanda goal kedua sesudah `baris lain`.

- [x] **Step 3: Commit**

```bash
git add server/test/fixtures/fake-codex-goal.sh
git commit -m "test(spec-397): fixture codex palsu yang memancarkan penanda runtime goal"
```

---

### Task 3: `armGoalInTui` sadar-agen — potongan ber-jeda, verifikasi per agen, kirim ulang

Test ditulis lebih dulu. Karena perubahan ini menambah field ke `GoalArmOpts`, kegagalan pertama
berbentuk **error TypeScript** — itu kegagalan yang sah dan memang yang diharapkan di Step 2.

**Files:**
- Test: `server/test/pty.test.ts` (konstanta di dekat baris 16; empat test sesudah `armGoalInTui menyerah diam-diam pada sesi yang tak ada`, ~baris 154)
- Modify: `server/src/services/pty.ts:7` (import), `:345-349` (call site `createSession`), `:360-400` (blok `armGoalInTui`)

**Interfaces:**
- Consumes: `goalChunks`, `GOAL_CHUNK` (Task 1) lewat `@hanoman/runner`; fixture Task 2; `goalOneLine`, `getSession`, `tmux`, `name` (sudah ada di `pty.ts`); tipe `Agent` (sudah diimpor `pty.ts:7`); di test: `createSession`, `armGoalInTui`, `attach`, `tmuxCapture`, `waitFor`, `repoDir`, `phaseFilePath`, `FAKE_CLAUDE` — semuanya sudah ada di `pty.test.ts`.
- Produces: `armGoalInTui(id: string, condition: string, o?: GoalArmOpts): Promise<boolean>`, dengan `GoalArmOpts = { pollMs?: number; readyTries?: number; settleMs?: number; verifyTries?: number; agent?: Agent; chunkMs?: number; sendTries?: number }`. Empat opsi lama tetap ada dengan default yang sama — dua test SPEC-332 memanggilnya dan harus lulus **tanpa diubah**.

- [x] **Step 1: Write the failing tests**

Tambahkan konstanta fixture sesudah baris 16 (`const FAKE_CLAUDE = …`):

```ts
// SPEC-397 · berdiri sebagai `codex`: memantulkan stdin DAN memancarkan penanda runtime goal codex
// begitu menerima `/goal …`. fake-claude.sh dipakai sebagai kontrol negatif (ia memantulkan `/goal`
// tapi tak pernah memancarkan penanda goal).
const FAKE_CODEX_GOAL = fileURLToPath(new URL("./fixtures/fake-codex-goal.sh", import.meta.url));
```

Tambahkan empat test sesudah `it("armGoalInTui menyerah diam-diam pada sesi yang tak ada", …)`:

```ts
  // SPEC-397 · ADR-0085 · sesi codex ikut memasang goal NATIVE codex lewat `/goal`.
  it("armGoalInTui memasang goal di sesi codex dan mengenalinya dari penanda runtime goal", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CODEX_GOAL;
    const s = createSession("goal-cx1", process.cwd(), { agent: "codex" });
    const ok = await armGoalInTui(s.id, "kondisi codex", {
      agent: "codex", pollMs: 40, readyTries: 30, settleMs: 40, verifyTries: 40, chunkMs: 1,
    });
    expect(ok).toBe(true);
    expect(tmuxCapture(s.id) ?? "").toContain("Pursuing goal");
  });

  // Jebakan yang dijaga: pane yang HANYA memuat teks `/goal` — persis yang terjadi saat kondisi
  // ter-degradasi jadi `[Pasted Content …]` dan slash-dispatch tak jalan — TIDAK boleh dihitung
  // sebagai goal terpasang untuk codex. Verifikasi lama `includes("/goal")` lulus palsu di sini.
  it("armGoalInTui TIDAK menganggap sesi codex ter-arm hanya karena pane memuat /goal", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CLAUDE;
    const s = createSession("goal-cx2", process.cwd(), { agent: "codex" });
    const ok = await armGoalInTui(s.id, "kondisi codex", {
      agent: "codex", pollMs: 10, readyTries: 30, settleMs: 40, verifyTries: 3, chunkMs: 1, sendTries: 1,
    });
    expect(ok).toBe(false);
    expect(tmuxCapture(s.id) ?? "").toContain("/goal kondisi codex");
  });

  // Kondisi multi-potongan dikirim sebagai BANYAK `send-keys` (ADR-0085: satu burst ≥ 1024 karakter
  // diubah TUI codex jadi `[Pasted Content N chars]` dan `/goal` mati diam). Yang dijaga di sini
  // adalah properti yang bisa diamati dari luar: pemotongan tak boleh MENGUBAH apa yang sampai —
  // tak ada potongan hilang, terduplikasi, atau tertukar urutan sepanjang jalur tmux.
  //
  // 900 karakter = 2 potongan (500 + 400), dan angkanya SENGAJA di bawah ~1,2 KB. Fixture ini adalah
  // `sh read` di tty mode KANONIKAL, dan antrean masukan tty punya batas yang bergantung timing
  // pengurasan echo: terukur di mesin ini 900–1200 selalu sampai, sementara 1300–1500 kadang sampai
  // kadang tidak (1500 lolos dengan potongan 500, gagal dengan potongan 400). Itu batasan FIXTURE,
  // bukan hanoman maupun codex — codex sungguhan membaca tty-nya di mode raw dengan buffer sendiri,
  // dan objektif 4000 karakter terbukti diterimanya. Jangan "memperbaiki" test ini dengan menaikkan
  // panjangnya: yang didapat cuma flake.
  //
  // Batas "tak ada potongan ≥ 1024" sendiri dijaga unit test `goalChunks` di runner — di sana ia
  // deterministik, di sini tidak.
  it("kondisi multi-potongan tiba utuh & berurutan di pane", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CODEX_GOAL;
    const cond = "z".repeat(900);
    const s = createSession("goal-cx3", process.cwd(), { agent: "codex" });
    const ok = await armGoalInTui(s.id, cond, {
      agent: "codex", pollMs: 40, readyTries: 30, settleMs: 40, verifyTries: 40, chunkMs: 5,
    });
    expect(ok).toBe(true);
    // capture-pane melipat baris; buang pembungkusnya sebelum mencocokkan isi.
    expect((tmuxCapture(s.id) ?? "").replace(/\s+/g, "")).toContain("/goal" + cond);
  }, 15000);

  // SPEC-397 · gerbang `agent === "claude"` di createSession dicabut: sesi codex ber-goal ikut
  // menerima keystroke, bukan hanya gate sh.
  it("createSession codex ber-goal ikut mengetik /goal ke pane", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CODEX_GOAL;
    const phaseFile = phaseFilePath(repoDir, "goal-cx4");
    const s = createSession("goal-cx4", process.cwd(), {
      agent: "codex", flow: "feature", specId: "SPEC-397", phaseFile, goal: "KONDISI-397",
    });
    await waitFor(() => (tmuxCapture(s.id) ?? "").includes("Pursuing goal"), 20000);
    expect((tmuxCapture(s.id) ?? "").replace(/\s+/g, " ")).toContain("KONDISI-397");
    // 25 dtk: arming di jalur ini memakai timing DEFAULT `armGoalInTui` (settleMs 1200 + poll 500 ms)
    // karena createSession memanggilnya tanpa opsi — di atas testTimeout bawaan vitest 5 dtk.
  }, 25000);
```

- [x] **Step 2: Run tests to verify they fail**

Run: `env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397" TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397_test" pnpm vitest run --project @hanoman/server server/test/pty.test.ts -t "codex" 2>&1 | tail -40`

Expected: **2 failed**, dan keduanya adalah inti SPEC ini:

- `armGoalInTui TIDAK menganggap sesi codex ter-arm hanya karena pane memuat /goal` →
  `AssertionError: expected true to be false`. Inilah **lulus palsu** verifikasi lama, terpampang.
- `createSession codex ber-goal ikut mengetik /goal ke pane` → `Test timed out` — gerbang
  `agent === "claude"` membuat keystroke tak pernah dikirim.

Dua catatan yang mudah menyesatkan di sini:

1. **`-t` menyaring NAMA test, bukan id sesi.** `-t "goal-cx"` mengembalikan
   `35 tests | 35 skipped` — nol test berjalan, dilaporkan **tanpa** kegagalan. Pakai `-t "codex"`.
2. **vitest tidak menjalankan typecheck**, jadi field `agent` yang belum ada di `GoalArmOpts`
   TIDAK memunculkan error TS di sini — ia diam-diam diabaikan saat runtime. Kegagalan yang
   diharapkan bersifat perilaku, dan error TS-nya baru muncul di `pnpm --filter ./server typecheck`.

- [x] **Step 3: Perbarui import runner di `server/src/services/pty.ts:7`**

Baris 7 hari ini:

```ts
import { goalOneLine, agentFlags, codexGoalScript, type Flow, type Agent } from "@hanoman/runner";
```

menjadi:

```ts
import {
  goalOneLine, goalChunks, agentFlags, codexGoalScript, type Flow, type Agent,
} from "@hanoman/runner";
```

- [x] **Step 4: Ganti seluruh blok `armGoalInTui` beserta komentar pengantarnya (baris 360–400)**

```ts
// SPEC-332 · ADR-0073 — jalur KEDUA mode goal. Hook Stop (claude: `--settings`; codex: gate sh di
// `-c hooks.Stop`) adalah JAMINANNYA; ini jalur yang memasang mekanisme goal milik agen sendiri.
//
// claude: mengetik `/goal <kondisi>` membuat Claude Code men-set `activeGoal` miliknya, jadi `/goal`
// menampilkan status dan goal ikut dipulihkan saat sesi di-resume. Keduanya tak saling menghapus:
// sumber yang dibaca `/goal` saat mencari goal lama hanya session hooks registry, sementara hook
// kita hidup di settings.
//
// SPEC-397 · ADR-0085 — codex JUGA lewat sini. codex-cli 0.146.0 punya mode goal native (feature
// `goals`, tabel `thread_goals`, status line `Pursuing goal`/`Goal achieved`) yang MELANJUTKAN
// SENDIRI sesudah turn berakhir sampai objektif tercapai. Premis ADR-0074 ("codex tak punya padanan
// terverifikasi") benar di 0.142.5, salah di 0.146.0. Gate sh tetap terpasang — ia satu-satunya yang
// benar-benar membaca berkas fase & kotak `- [ ]`; konsekuensinya satu percobaan berhenti dievaluasi
// dua kali, dan itu diterima sadar (sudah begitu di claude sejak ADR-0073).
export type GoalArmOpts = {
  pollMs?: number; readyTries?: number; settleMs?: number; verifyTries?: number;
  // SPEC-397 · agen sesi: menentukan penanda apa yang dihitung sebagai "goal terpasang".
  agent?: Agent;
  // SPEC-397 · jeda antar potongan keystroke, dan berapa kali arming diulang bila tak terverifikasi.
  chunkMs?: number; sendTries?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const paneText = (id: string): string => {
  try { return tmux("capture-pane", "-p", "-t", name(id)); } catch { return ""; }
};

// SPEC-397 · penanda "goal BENAR-BENAR terpasang", per agen.
//
// codex TIDAK boleh diverifikasi dengan substring `/goal`: saat kondisi terkirim sebagai burst
// ≥ 1024 karakter, TUI mengubahnya jadi `[Pasted Content N chars]`, slash-dispatch tak jalan, dan
// kondisinya masuk sebagai PESAN CHAT — yang pane-nya tetap menampilkan sebagai `/goal …`. Assertion
// substring karena itu lulus palsu persis untuk kegagalan yang paling mungkin terjadi. Penanda di
// bawah adalah teks yang hanya dipancarkan runtime goal codex sendiri.
//
// claude sengaja tetap memakai penanda lamanya: tak ada bukti terukur soal penanda mana yang
// dipancarkan Claude Code saat goal terpasang, dan menggantinya dengan tebakan hanya memindahkan
// risiko ke agen yang hari ini bekerja.
const GOAL_ARMED_MARKERS: Record<Agent, string[]> = {
  claude: ["/goal"],
  codex: ["Goal active", "Pursuing goal", "Goal achieved"],
};

const goalArmed = (id: string, agent: Agent): boolean => {
  const text = paneText(id);
  return GOAL_ARMED_MARKERS[agent].some((m) => text.includes(m));
};

export async function armGoalInTui(id: string, condition: string, o: GoalArmOpts = {}): Promise<boolean> {
  const pollMs = o.pollMs ?? 500, readyTries = o.readyTries ?? 20;
  const settleMs = o.settleMs ?? 1200, verifyTries = o.verifyTries ?? 12;
  const chunkMs = o.chunkMs ?? 50, sendTries = o.sendTries ?? 3;
  const agent: Agent = o.agent ?? "claude";
  const line = goalOneLine(condition);
  if (!line) return false;
  // Tunggu pane menggambar sesuatu (TUI sudah hidup). Habis percobaan → kirim saja: yang hilang
  // hanyalah jalur kedua, sementara jaminan sudah dipegang hook Stop.
  for (let i = 0; i < readyTries; i++) {
    const p = getSession(id);
    if (!p || p.exited) return false;
    if (paneText(id).trim()) break;
    await sleep(pollMs);
  }
  await sleep(settleMs);
  // SPEC-397 · kirim → verifikasi → kirim ulang. Aman JUSTRU karena verifikasinya akurat: retry
  // hanya terjadi bila tak ada goal yang terpasang, jadi ia tak pernah menimpa goal yang hidup.
  // (Larangan "SEKALI kirim" yang lama lahir dari verifikasi yang tak bisa membedakan berhasil dari
  // gagal — dengan penanda per-agen, larangan itu tak lagi diperlukan.)
  for (let attempt = 0; attempt < sendTries; attempt++) {
    const p = getSession(id);
    if (!p || p.exited) return false;
    try {
      // `-l` = literal: tmux tak menafsirkan isi kondisi sebagai nama tombol. Dikirim TERPOTONG
      // ber-jeda karena deteksi paste codex bekerja per-burst PTY (ADR-0085).
      tmux("send-keys", "-t", name(id), "-l", "/goal ");
      for (const chunk of goalChunks(line)) {
        tmux("send-keys", "-t", name(id), "-l", chunk);
        await sleep(chunkMs);
      }
      tmux("send-keys", "-t", name(id), "Enter");
    } catch { return false; }   // sesi lenyap di tengah jalan
    for (let i = 0; i < verifyTries; i++) {
      if (goalArmed(id, agent)) return true;
      await sleep(pollMs);
    }
  }
  return false;
}
```

- [x] **Step 5: Cabut gerbang `agent === "claude"` di call site (`server/src/services/pty.ts:345-349`)**

Blok hari ini:

```ts
  // SPEC-332 · fire-and-forget: respons HTTP tak boleh menunggu TUI siap. Gagal = diam, karena
  // jaminan mode goal sudah dipegang hook Stop di argv di atas.
  // SPEC-338 · khusus claude: `/goal` adalah perintah Claude Code; codex tak punya padanan
  // terverifikasi — jaminannya di sana adalah gate hook deterministik.
  if (opts.goal && !opts.command && agent === "claude") void armGoalInTui(id, opts.goal).catch(() => { /* best-effort */ });
```

menjadi:

```ts
  // SPEC-332 · fire-and-forget: respons HTTP tak boleh menunggu TUI siap. Gagal = diam, karena
  // jaminan mode goal sudah dipegang hook Stop di argv di atas.
  // SPEC-397 · ADR-0085 · kedua agen: codex-cli ≥ 0.146 punya mode goal native yang di-arm lewat
  // `/goal` yang sama. Tak ada gerbang versi CLI — pada codex lama `/goal` cuma jadi pesan chat yang
  // tak dipahami, verifikasi melaporkan gagal, dan gate sh tetap memegang jaminannya.
  if (opts.goal && !opts.command) void armGoalInTui(id, opts.goal, { agent }).catch(() => { /* best-effort */ });
```

- [x] **Step 6: Run tests to verify they pass**

Run: `env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397" TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397_test" pnpm vitest run --project @hanoman/server server/test/pty.test.ts`
Expected: PASS — seluruh berkas hijau, termasuk empat test baru dan dua test `armGoalInTui` lama yang
tak disentuh.

Bila 1–3 test gagal dengan pesan soal sesi tmux yang tak dikenali: itu **sesi bocor dari run vitest
sebelumnya** (`listSessions()` membaca tmux nyata). Jalankan `tmux -L hanoman-test kill-server` lalu
ulangi **set yang sama** sebelum menyalahkan perubahan ini.

- [x] **Step 7: Typecheck paket server**

Run: `pnpm --filter ./server typecheck`
Expected: exit 0, tanpa output.

- [x] **Step 8: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(spec-397): armGoalInTui sadar-agen — codex ikut memasang goal native"
```

---

### Task 4: Verifikasi live terhadap codex sungguhan

**Files:** tak ada yang diubah — ini gerbang bukti, bukan perubahan kode.

**Interfaces:**
- Consumes: kode hasil Task 1–3; `codex` CLI di PATH.
- Produces: tak ada.

Task ini ada karena unit test memakai agen palsu: yang dibuktikan di sana adalah **kontrak hanoman**,
bukan bahwa codex sungguhan menerima goal-nya. Tanpa langkah ini keseluruhan SPEC berdiri di atas
fixture.

> **Peringatan:** jangan menjalankan probe ini dengan `$HANOMAN_PHASE_FILE` atau env sesi hanoman lain
> masih terpasang, dan jangan pakai worktree ini sebagai cwd probe. Goal native codex mengejar
> objektifnya sampai tuntas dan akan menyentuh apa pun yang disebut env itu — dalam probe brainstorm,
> sebuah goal ber-kondisi-DoD sempat mulai mengaudit worktree yang sebenarnya.

- [x] **Step 1: Pastikan versi CLI mendukung goal native**

```bash
codex --version
codex features list | grep '^goals'
```

Expected: `codex-cli 0.146.0` atau lebih baru, dan baris `goals   stable   true`.

- [x] **Step 2: Siapkan CODEX_HOME sekali-pakai (jangan mencemari `~/.codex`)**

```bash
export SC="$(mktemp -d)"
mkdir -p "$SC/home" "$SC/probe" && (cd "$SC/probe" && git init -q)
cp ~/.codex/auth.json "$SC/home/auth.json"
# Entri trust WAJIB memakai realpath: `mktemp -d` di macOS mengembalikan /var/folders/… yang
# sebenarnya symlink ke /private/var/folders/…, dan gerbang trust codex mencocokkan REALPATH
# (alasan yang sama dengan `realpathSync` di services/codex-trust.ts). Entri ber-path mentah tak
# pernah cocok dan sesi mati di layar trust selamanya.
RP="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$SC/probe")"
printf 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "low"\n\n[projects."%s"]\ntrust_level = "trusted"\n' "$RP" > "$SC/home/config.toml"
echo "$SC → $RP"
```

Expected: mencetak path scratch dan realpath-nya; `auth.json` & `config.toml` ada di `$SC/home`, dan
blok `[projects."…"]` memakai path `/private/var/…`.

- [x] **Step 3: Lahirkan sesi codex lewat `createSession` sungguhan dengan mode goal**

`server build` membundel semuanya ke satu `dist/server.js`, jadi `services/pty.js` **tidak pernah
ada** sebagai berkas terpisah — impor sumber TS-nya lewat `tsx`. Ekstensi wajib **`.mts`**: `tsx`
memilih output CJS untuk `.ts` di sini dan menolak top-level `await`. Berkasnya juga harus berada di
dalam repo (bukan `/tmp`) supaya resolusi `./server/src/…` bekerja, dan `pnpm --filter ./server exec`
berjalan dengan cwd `server/` — karena itu argumennya `../arm-probe397.mts`.

Tulis `arm-probe397.mts` di root repo:

```ts
process.env.CODEX_HOME = process.env.SC + "/home";
process.env.HANOMAN_TMUX_SOCKET = "hanoman-spec397-live";
const { createSession } = await import("./server/src/services/pty.ts");
const s = createSession("probe397", process.env.SC + "/probe", {
  agent: "codex", model: "gpt-5.6-sol", effort: "low",
  goal: "Pastikan berkas target.txt ada di direktori kerja dan berisi tepat kata SELESAI.",
  prompt: "Tunggu instruksi. Jangan lakukan apa pun sampai diminta.",
});
console.log("session", s.id, "agent", s.agent);
// armGoalInTui itu fire-and-forget; proses harus hidup sampai ia selesai mengetik.
await new Promise((r) => setTimeout(r, 12000));
```

```bash
env -u HANOMAN_PHASE_FILE -u HANOMAN_BASE_SHA -u HANOMAN_VERIFY_SCOPE -u NODE_ENV \
  DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman397_test" SC="$SC" \
  pnpm --filter ./server exec tsx ../arm-probe397.mts
tmux -L hanoman-spec397-live capture-pane -p -t hanoman-<id-yang-dicetak> | tail -30
cat "$SC/probe/target.txt"
```

Expected (terukur di sesi ini): pane memuat `• Goal active  Objective: Pastikan berkas target.txt …`,
lalu turn prompt kerja berakhir (`Baik, saya akan menunggu instruksi.`), lalu **codex melanjutkan
sendiri** — `Added target.txt (+1 -0)` — dan status line bergerak `Pursuing goal (20s)` →
`Goal achieved (36s)`. `target.txt` berisi `SELESAI`. Id sesi diturunkan `idFor(undefined)` jadi
**acak**, bukan `probe397`; pakai id yang dicetak skrip.

- [x] **Step 4: Bereskan**

```bash
tmux -L hanoman-spec397-live kill-server 2>/dev/null
rm -f ./arm-probe397.ts && rm -rf "$SC"
git status --porcelain
```

Expected: `git status --porcelain` **kosong** — skrip probe tak boleh ikut ter-commit.

---

### Task 5: Docs & penutup

**Files:**
- Ditulis di fase Spec, tinggal dipastikan konsisten & ter-commit: `internal/docs/adr/0085-mode-goal-codex-native.md`, `internal/docs/README.md`, `internal/docs/adr/README.md`, `internal/skills/hanoman/SKILL.md`, `docs/superpowers/specs/2026-07-30-spec-397-codex-goal-mode-native-design.md`, `docs/superpowers/plans/2026-07-30-codex-goal-mode-native-spec-397.md`

**Interfaces:**
- Consumes: keputusan ADR-0085.
- Produces: tak ada.

- [x] **Step 1: Pastikan ADR ter-link di KEDUA index**

```bash
grep -c "0085-mode-goal-codex-native.md" internal/docs/README.md internal/docs/adr/README.md
```

Expected: `internal/docs/README.md:1` dan `internal/docs/adr/README.md:1`. (SPEC-386: ADR baru wajib
ditaut di keduanya — index utama satu baris, sub-index narasinya.)

- [x] **Step 2: Pastikan tak ada klaim usang yang tertinggal di skill**

```bash
grep -rn "khusus claude" internal/skills/hanoman/SKILL.md
```

Expected: satu-satunya kecocokan adalah kalimat yang menyatakan `armGoalInTui` **tak lagi** khusus
claude. Tak boleh ada lagi kalimat yang mengklaimnya sebagai perilaku sekarang. (ADR-0074 sendiri
**tidak** diedit — ADR imutable; ADR-0085 yang mengamandemennya.)

- [x] **Step 3: Jalankan test yang tersentuh, gabungan, dan pastikan bukan nol**

Tiga perintah, semuanya dengan prefiks env di Global Constraints:

1. Berkas yang tersentuh langsung, path eksplisit supaya `passWithNoTests` tak bisa menipu:
   `pnpm vitest run --project @hanoman/runner --project @hanoman/server runner/test/goal.test.ts server/test/pty.test.ts`
   → **46 lulus** (11 runner + 35 server).
2. Blast radius sesungguhnya, **serial**:
   `pnpm vitest run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`
   → **90 berkas / 736 test lulus**. Tanpa `--no-file-parallelism` set yang sama memberi 181 gagal
   palsu (lihat Global Constraints).
3. Test frontend yang tersentuh komentar `SettingsScreen.tsx`:
   `pnpm vitest run --project @hanoman/app src/test/settings-*.test.tsx`
   → **6 berkas / 25 test lulus**.

Plus typecheck kedua paket: `pnpm --filter ./runner typecheck` dan `pnpm --filter ./server typecheck`,
keduanya exit 0.

- [x] **Step 4: Commit docs**

```bash
git add internal/docs docs/superpowers
git commit -m "docs(spec-397): ADR-0085 mode goal codex native + desain, plan & skill"
```

- [x] **Step 5: Centang seluruh kotak plan ini, lalu commit pembaruannya**

hanoman menahan backlog di `executing` selama plan masih punya `- [ ]` (ADR-0029), jadi ini bagian
dari pekerjaan, bukan formalitas.

```bash
grep -c -- "- \[ \]" docs/superpowers/plans/2026-07-30-codex-goal-mode-native-spec-397.md
git add docs/superpowers/plans/2026-07-30-codex-goal-mode-native-spec-397.md
git commit -m "docs(spec-397): centang seluruh task plan"
```

Expected: `grep -c` mengembalikan `0`.

- [x] **Step 6: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-397
```

Expected: `* [new branch]` atau fast-forward yang sukses.
