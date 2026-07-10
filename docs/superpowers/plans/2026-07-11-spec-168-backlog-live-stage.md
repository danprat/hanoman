# SPEC-168 — Backlog Live Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Board backlog memantulkan kemajuan fase sesi terminal real time (≤3 detik) tanpa kanal realtime baru dan tanpa mengubah frontend.

**Architecture:** `GET /specs` menurunkan `stage` dari `$HANOMAN_PHASE_FILE` sesi yang hidup (forward-only, ADR-0008) saat dibaca — pola "simpan seminimalnya, turunkan saat dibaca" (ADR-0018/0019). Tak ada penulisan DB baru; `advanceStage` di DELETE tetap sebagai finalisasi durabel. Poll 3 detik frontend yang sudah ada (`App.tsx:304-312`) memunculkan hasilnya.

**Tech Stack:** Node + TypeScript (Fastify, Prisma), tmux via `node-pty`, Vitest. Test butuh `tmux` di PATH (sesi nyata + `fake-claude.sh`, seperti `terminal.route.test.ts`).

## Global Constraints

- TypeScript strict. Test untuk logika orchestrasi.
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama** (sudah: audit + spec + index).
- Stage **hanya maju** (ADR-0008): turunan tak pernah menyeret `spec.stage` mundur dari nilai persist.
- Jangan ubah bentuk respons `GET /specs` (tetap `Spec[]`), jangan menambah dependency, jangan sentuh frontend.
- Test repo = `env -u NODE_ENV -u DATABASE_URL pnpm test` di dalam `server/` (shell sesi menunjuk prod; lihat catatan memory). Worktree ini butuh `pnpm install` + `prisma generate` + `prisma migrate deploy` untuk `hanoman_test` sebelum test jalan.

---

### Task 1: Turunkan stage live di `GET /specs`

Satu deliverable: `GET /specs` melaporkan stage turunan untuk spec yang punya sesi hidup, forward-only, tanpa mempersist. Butuh helper batch di `pty.ts` (satu `list-panes`) + wiring di route. Diuji end-to-end lewat route test yang sudah punya harness sesi nyata.

**Files:**
- Modify: `server/src/services/pty.ts` (tambah `sessionPhasesBySpec`, dekat `sessionPhases` ~baris 157-161)
- Modify: `server/src/routes/specs.ts:13-16` (handler `GET /specs`)
- Test: `server/test/terminal.route.test.ts` (tambah `describe` baru di akhir file)

**Interfaces:**
- Produces: `sessionPhasesBySpec(): Map<string, Phase[]>` di `pty.ts` — kunci = `specId` (nilai asli `@hanoman_spec`, mis. `"SPEC-906"`, bukan slug sesi), nilai = `readPhases(phaseFile, flow)`.
- Consumes (sudah ada): `stageFor(phases): Stage | null` dari `services/session-phases`, `STAGES` dari `services/stage-machine`, `type Stage` dari `@hanoman/shared`, `readPhases`/`Phase`/`listPanes` di dalam `pty.ts`.

- [x] **Step 1: Tulis test yang gagal**

Tambah blok ini di **akhir** `server/test/terminal.route.test.ts` (setelah `describe("terminal routes · sesi reverse", …)`). Reuse `start`, `repoDir`, `phaseFilePath`, `prisma`, `FAKE_CLAUDE`, `makeSpec` yang sudah ada di file. `start` didefinisikan di dalam `describe("terminal routes · sesi backlog")` — jadi definisikan ulang di blok baru:

```ts
// SPEC-168: backlog menurunkan stage sesi yang hidup — real time, tanpa menunggu DELETE.
describe("GET /specs · stage live dari sesi", () => {
  const start = (spec: string, flow = "feature") =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec, flow } });
  const stageOf = async (id: string) => {
    const res = await app.inject({ url: "/api/specs" });
    return (res.json() as { id: string; stage: string }[]).find((s) => s.id === id)?.stage;
  };

  it("melaporkan stage turunan dari berkas fase selama sesi hidup, tanpa mempersist", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-906", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-906");
    appendFileSync(phaseFilePath(repoDir, "spec-906"), "Brainstorm done\nObjective done\n");

    expect(await stageOf("SPEC-906")).toBe("objective");
    // DB belum ditulis: turunan hidup di read, bukan di kolom.
    const row = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-906" } });
    expect(row.stage).toBe("brainstorming");

    // DELETE memfinalkan ke DB, dan read tetap konsisten sesudahnya.
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-906" });
    expect(await stageOf("SPEC-906")).toBe("objective");
  });

  it("tak menyeret stage mundur: fase lebih awal dari nilai persist diabaikan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-907", projectId: "p1", stage: "planned" });
    await start("SPEC-907");
    appendFileSync(phaseFilePath(repoDir, "spec-907"), "Objective done\n"); // → "objective" < "planned"
    expect(await stageOf("SPEC-907")).toBe("planned");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-907" });
  });

  it("spec tanpa sesi: stage = nilai DB apa adanya", async () => {
    await makeSpec({ id: "SPEC-908", projectId: "p1", stage: "objective" });
    expect(await stageOf("SPEC-908")).toBe("objective");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/terminal.route.test.ts -t "stage live"`
Expected: FAIL — test pertama `expect(await stageOf("SPEC-906")).toBe("objective")` menerima `"brainstorming"` (stage belum diturunkan). (Test ke-2 dan ke-3 mungkin sudah lulus karena keduanya menegaskan nilai persist yang tak berubah — yang menentukan adalah test pertama merah.)

- [x] **Step 3: Tambah helper `sessionPhasesBySpec` di `pty.ts`**

Sisipkan tepat setelah fungsi `sessionPhases` (setelah baris ~161, sebelum `function broadcast`):

```ts
// Fase per spec untuk semua sesi tmux, dalam satu `list-panes` — dipakai GET /specs untuk
// menurunkan stage live tanpa satu tmux call per spec (SPEC-168). Tak difilter `exited`:
// berkas fase pane mati (belum di-DELETE) tetap kebenaran terakhirnya; forward-only di
// pemanggil (stageFor + guard STAGES.indexOf) menjaga tak ada stage yang mundur.
export function sessionPhasesBySpec(): Map<string, Phase[]> {
  const out = new Map<string, Phase[]>();
  for (const p of listPanes()) {
    if (!p.specId || !p.flow || !p.phaseFile) continue;
    out.set(p.specId, readPhases(p.phaseFile, p.flow));
  }
  return out;
}
```

`listPanes`, `readPhases`, dan `Phase` sudah tersedia di modul — nol import baru.

- [x] **Step 4: Turunkan stage di `GET /specs` (`server/src/routes/specs.ts`)**

Tambah import di kepala file (setelah baris 5, `import { listRepoBranches } from "../services/branches";`):

```ts
import { sessionPhasesBySpec } from "../services/pty";
import { stageFor } from "../services/session-phases";
import { STAGES } from "../services/stage-machine";
import type { Stage } from "@hanoman/shared";
```

Ganti handler `GET /specs` (baris 13-16) menjadi:

```ts
  app.get("/specs", async (req) => {
    const { project, source } = req.query as { project?: string; source?: string };
    const specs = await prisma.spec.findMany({ where: { projectId: project, source }, orderBy: { id: "desc" } });
    // Stage live: selama sesi hidup, stage diturunkan dari berkas fase (ADR-0018/0019), tidak
    // dipersist tiap transisi. DELETE tetap memajukan Spec.stage ke keadaan finalnya. Hanya
    // maju (ADR-0008). (SPEC-168)
    const live = sessionPhasesBySpec();
    if (live.size === 0) return specs;
    return specs.map((s) => {
      const phases = live.get(s.id);
      if (!phases) return s;
      const next = stageFor(phases);
      if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
      return { ...s, stage: next };
    });
  });
```

- [x] **Step 5: Jalankan test — pastikan LULUS**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/terminal.route.test.ts -t "stage live"`
Expected: PASS (3 test).

- [x] **Step 6: Regресi — seluruh suite server + typecheck**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`
Expected: semua hijau (khususnya `specs routes` dan `terminal routes` lama tak berubah).
Run: `pnpm -w typecheck` (atau `tsc -p server` sesuai skrip repo)
Expected: 0 error.

- [x] **Step 7: Verifikasi nyata di local (CLAUDE.md — jangan hanya unit test)**

Boot server, buat spec + sesi, tulis fase, curl `GET /api/specs`, amati `stage` maju tanpa DELETE. Bunuh sesi setelahnya. Perintah pastinya di bawah ("Manual verification"). Kalau tak hijau, fix dulu sebelum commit.

- [x] **Step 8: Commit**

```bash
git add server/src/services/pty.ts server/src/routes/specs.ts server/test/terminal.route.test.ts \
        internal/docs/operations/spec-168-backlog-realtime-audit.md \
        internal/docs/operations/spec-168-backlog-realtime-spec.md \
        internal/docs/README.md \
        docs/superpowers/plans/2026-07-11-spec-168-backlog-live-stage.md
git commit -m "fix(server): backlog turunkan stage live dari sesi hidup (SPEC-168)"
```

---

## Manual verification (Step 7, perintah pasti)

Boot terpisah dari dev (port lain, DB test-scratch supaya tak menyentuh DB dev — lihat memory "Worktree butuh install+generate" & "port 8787 sudah dipakai"). Contoh alur:

```bash
# di worktree ini, sesudah pnpm install + prisma generate + migrate deploy ke hanoman_test
cd server
env -u NODE_ENV -u DATABASE_URL PORT=8790 node dist/server.js &   # atau pnpm dev dgn PORT
# siapkan project+repo, buat spec via API, POST /api/terminal/sessions {spec,flow},
# echo "Objective done" >> <repoDir>/.worktrees/<slug>/../.phases/<slug>
curl -s localhost:8790/api/specs | jq '.[] | select(.id=="SPEC-xxx") | .stage'   # → "objective"
curl -s -XDELETE localhost:8790/api/terminal/sessions/<slug>                       # bersihkan sesi+worktree
```

Sukses = `stage` sudah `objective` **sebelum** DELETE. (Reproduksi butuh spawn `claude`/tmux nyata; pakai `HANOMAN_CLAUDE_BIN` fake bila tak mau claude sungguhan berjalan.)

## Self-review

- **Spec coverage:** helper batch (§1 spec) → Step 3; derivasi forward-only di `GET /specs` (§2) → Step 4; kontrak bentuk respons tetap → tak ada perubahan bentuk; test 3 skenario (§Test) → Step 1. Non-tujuan (no SSE, no frontend, no pty→DB write) dihormati.
- **Placeholder scan:** semua step berisi kode/perintah nyata, tanpa TBD.
- **Type consistency:** `sessionPhasesBySpec` dipakai di Step 4 persis seperti didefinisikan Step 3; `stageFor`/`STAGES`/`Stage` sesuai sumber yang sudah ada.
