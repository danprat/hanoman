# SPEC-172 Reopen Session Backlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah tombol "Buka sesi lagi" di detail backlog untuk spec yang stage-nya `done`, yang membuka sesi Claude yang **lanjut di fase Execute** (bukan restart pipeline).

**Architecture:** Tiga perubahan kecil, tanpa endpoint/skema baru. (1) Runner: prompt varian `continuePrompt` yang fokus Execute. (2) Server: `POST /terminal/sessions` memilih `continuePrompt` saat `spec.stage === "done"` (deteksi otomatis dari stage — tak ada field baru di request). (3) Frontend: tombol reopen hanya di `SpecDetail`; `SpecActions` (list/grid/board) tak disentuh.

**Tech Stack:** TypeScript strict, Node + Fastify (server), React + Vite (frontend), Vitest, tmux + git worktree (sesi), Prisma/Postgres.

> **Status: SELESAI & terverifikasi nyata.** `pnpm -r typecheck` bersih; test runner 33 / src 110 / server 175 hijau. Smoke API nyata: boot server terisolasi (DB throwaway), `POST /terminal/sessions {spec:done, flow}` → 201, worktree lahir, prompt sesi = `continuePrompt` (header `MELANJUTKAN`, "Lanjut di fase Execute", baca `docs/superpowers/plans/**`), **bukan** pipeline penuh ("Kerjakan fase berurutan" tak ada).

## Global Constraints

- TypeScript strict — semua kode baru wajib lolos `tsc`.
- Reopen **tetap di fase Execute**; jangan mengulang Brainstorm/Objective/Spec/Plan.
- Stage **tetap `done`** — tidak di-revert.
- Tombol reopen **hanya** di `SpecDetail`; jangan ubah `SpecActions` (dipakai list/grid/board).
- Tanpa endpoint/route/DTO/field-request baru. Tanpa perubahan skema. Tanpa ADR.
- Tanpa mengubah pemilihan worktree (tetap `branchFrom ?? "main"`).
- Update `internal/docs` yang tersentuh **dalam commit yang sama** (SoT konvensi).
- Test API secara nyata di local sebelum menyatakan selesai (boot server + curl), bukan hanya unit test.

---

### Task 1: Runner — `continuePrompt`

**Files:**
- Modify: `runner/src/prompt.ts` (tambah fungsi `continuePrompt`; ia sudah ter-export lewat `runner/src/index.ts` `export * from "./prompt"`)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `Flow`, `SpecBrief` (dari `./types`), helper `skillInstruction` (sudah ada di `prompt.ts`).
- Produces: `continuePrompt(flow: Flow, spec: SpecBrief, branchTo: string): string`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan blok ini di `runner/test/prompt.test.ts`. Ubah baris import teratas jadi:

```ts
import { PIPELINES, startPrompt, startProjectPrompt, continuePrompt } from "../src/prompt";
```

Lalu tambahkan describe baru (setelah describe `startPrompt`):

```ts
// SPEC-172 · reopen: lanjut di Execute untuk spec yang keburu `done`, tanpa mengulang pipeline.
describe("continuePrompt", () => {
  const branch = "hanoman/spec-162";

  it("identitas & objective backlog item ikut", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("SPEC-162");
    expect(p).toContain("Ganti runOne dengan tmux");
  });

  it("lanjut di Execute, tak mengulang pipeline dari awal", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("Execute");
    expect(p).toContain("docs/superpowers/plans");
    expect(p).not.toContain("Brainstorm");
    expect(p).not.toContain("Kerjakan fase berurutan"); // phaseInstruction absen
    expect(p).not.toContain("$HANOMAN_PHASE_FILE");
  });

  it("hanya skill fase Execute yang di-invoke", () => {
    const p = continuePrompt("feature", spec, branch);
    for (const s of ["superpowers:executing-plans", "superpowers:test-driven-development",
      "superpowers:verification-before-completion"]) expect(p).toContain(s);
    expect(p).not.toContain("superpowers:brainstorming");
    expect(p).not.toContain("superpowers:writing-plans");
  });

  it("tetap menyuruh commit + push ke branch-nya", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("git push");
    expect(p).toContain("hanoman/spec-162");
  });

  it("memuat marker MELANJUTKAN di awal (dipakai server untuk verifikasi pilihan prompt)", () => {
    expect(continuePrompt("feature", spec, branch)).toContain("MELANJUTKAN");
  });

  it("payload ikut saat ada, tanpa 'undefined' saat tidak", () => {
    expect(continuePrompt("qa", { ...spec, payload: { severity: "major" } }, "b")).toContain("severity");
    expect(continuePrompt("feature", spec, "b")).not.toContain("undefined");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test -- prompt`
Expected: FAIL — `continuePrompt is not a function` / import error.

- [x] **Step 3: Implementasi `continuePrompt`**

Tambahkan tepat setelah fungsi `startPrompt` di `runner/src/prompt.ts` (sebelum `REVERSE_PHASE_GUIDE`):

```ts
// SPEC-172 · reopen sesi backlog item yang keburu ditandai `done` padahal kerjanya belum
// tuntas (mis. spec ber-banyak-PR, baru sebagian beres). Beda dari startPrompt: TIDAK
// menggiring pipeline dari awal — spec & plan sudah ada, jadi sesi lanjut langsung di
// Execute. Kontinuitas: plan di docs/superpowers/plans/** menandai task `[x]`/`[ ]`, dan
// kerja yang selesai umumnya sudah ter-merge ke branchFrom (worktree lahir dari sana).
export function continuePrompt(flow: Flow, spec: SpecBrief, branchTo: string): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow} — MELANJUTKAN backlog item yang sebelumnya ditandai selesai padahal `
      + `pekerjaannya belum tuntas. Ikuti internal/docs sebagai Source of Truth; perbarui `
      + `docs yang tersentuh dan link-nya di index, dalam commit yang sama.`,
    `JANGAN mengulang fase awal — spec & plan sudah ada. Lanjut di fase Execute: baca plan `
      + `di docs/superpowers/plans/** untuk backlog item ini, periksa task yang sudah \`[x]\` `
      + `dan selesaikan yang masih \`[ ]\`. Verifikasi nyata sebelum klaim selesai.`,
    skillInstruction(["Execute"]),
    `Setelah selesai: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Worktree `
      + `ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

- [x] **Step 4: Jalankan test, pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test -- prompt`
Expected: PASS — semua test `startPrompt` lama + `continuePrompt` baru hijau.

- [x] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(runner): continuePrompt — reopen sesi lanjut di Execute (SPEC-172)"
```

---

### Task 2: Server — pilih prompt berdasar stage

**Files:**
- Modify: `server/src/routes/terminal.ts` (import + cabang `"spec" in parsed.data`, ~baris 4 & 55-62)
- Test: `server/test/terminal.route.test.ts`
- Docs: `internal/docs/architecture/api-contract.md`

**Interfaces:**
- Consumes: `continuePrompt` (Task 1), `startPrompt` (sudah dipakai).
- Produces: perilaku `POST /terminal/sessions` — untuk spec `done`, sesi baru memakai `continuePrompt`; selain itu tetap `startPrompt`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/terminal.route.test.ts`, di dalam `describe("terminal routes · sesi backlog", ...)` (setelah test terakhirnya). Butuh `connect`/`waitFor` yang sudah ada di file:

```ts
  // SPEC-172 · reopen: spec `done` memakai continuePrompt (lanjut Execute), bukan startPrompt.
  it("spec done → sesi baru memakai continuePrompt (marker MELANJUTKAN)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE; // fake-claude cetak `args: $*`
    await makeSpec({ id: "SPEC-920", projectId: "p1", stage: "done", objective: "selesaikan 3 PR sisa" });
    const res = await start("SPEC-920");
    expect(res.statusCode).toBe(201);
    expect(existsSync(join(repoDir, ".worktrees", "spec-920"))).toBe(true);
    const c = connect("spec-920");
    await c.opened;
    await waitFor(() => c.data().includes("MELANJUTKAN"));
    expect(c.data()).not.toContain("Kerjakan fase berurutan"); // pipeline penuh tak dipakai
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-920" });
  });

  it("spec non-done → tetap startPrompt (tanpa marker MELANJUTKAN)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-921", projectId: "p1", stage: "planned", objective: "kerja biasa" });
    const res = await start("SPEC-921");
    expect(res.statusCode).toBe(201);
    const c = connect("spec-921");
    await c.opened;
    await waitFor(() => c.data().includes("Kerjakan fase berurutan"));
    expect(c.data()).not.toContain("MELANJUTKAN");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-921" });
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- terminal.route`
Expected: FAIL — spec `done` masih memakai `startPrompt`, `MELANJUTKAN` tak ada di data.

- [x] **Step 3: Implementasi pemilihan prompt**

Di `server/src/routes/terminal.ts`, ubah import baris 4 menambahkan `continuePrompt`:

```ts
import { realGit, startPrompt, continuePrompt, startProjectPrompt, type Flow } from "@hanoman/runner";
```

Lalu di cabang `if ("spec" in parsed.data)`, ganti pemanggilan `startPrompt(...)` di dalam `createSession(...)` (baris ~58-61) dengan pemilihan berdasar stage:

```ts
      const { model, effort } = await sessionModel();
      // Worktree lahir `--detach` di commit branchFrom: sesi tak pernah berjalan di working
      // tree utama, dan `main` boleh tetap ter-checkout di sana (ADR-0002).
      realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "main");
      // SPEC-172 · spec yang keburu `done` di-reopen untuk melanjutkan (lanjut di Execute,
      // tak mengulang pipeline). Deteksi dari stage — satu-satunya jalur yang men-start spec
      // `done` adalah tombol "Buka sesi lagi" di detail; list/grid/board menyembunyikan start.
      const mkPrompt = spec.stage === "done" ? continuePrompt : startPrompt;
      const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
        specId: spec.id, flow: parsed.data.flow, model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        prompt: mkPrompt(parsed.data.flow, {
          id: spec.id, title: spec.title, source: spec.source,
          priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
        }, `hanoman/${id}`),
      });
      return reply.code(201).send({ id: s.id });
```

- [x] **Step 4: Jalankan test, pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- terminal.route`
Expected: PASS — dua test SPEC-172 hijau, test lama tetap hijau.

- [x] **Step 5: Update docs api-contract**

Di `internal/docs/architecture/api-contract.md`, di blok `POST /terminal/sessions` (bagian sesi backlog `{ spec, flow }`), tambahkan satu kalimat:

```markdown
- SPEC-172: bila `Spec.stage === "done"`, sesi baru dibuka dengan prompt **lanjutan**
  (fase Execute saja) alih-alih prompt pipeline penuh — untuk melanjutkan backlog item
  yang keburu ditandai selesai. Tak ada field baru di request; dipilih otomatis dari stage.
```

- [x] **Step 6: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts internal/docs/architecture/api-contract.md
git commit -m "feat(server): reopen spec done pakai continuePrompt (SPEC-172)"
```

---

### Task 3: Frontend — tombol "Buka sesi lagi" di `SpecDetail`

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (props `SpecDetail`, render tombol, wiring di `BacklogScreen`)
- Test: `src/test/reopen-session.test.tsx` (baru)
- Docs: `internal/docs/frontend/frontend-implementation.md`

**Interfaces:**
- Consumes: prop `onStart?: (s: Spec) => void` yang sudah masuk ke `BacklogScreen` dari `App.tsx`.
- Produces: `SpecDetail` merender tombol reopen saat `spec.stage === "done"`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/reopen-session.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
// SpecDetail memuat branches lewat api.listBranches di useEffect — mock supaya tak fetch nyata.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const doneSpec: Spec = {
  id: "SPEC-162", projectId: "p1", title: "Reopenable", source: "brief", stage: "done",
  priority: "sedang", author: "Rangga", objective: "obj", payload: {}, branchFrom: null,
} as Spec;

function renderScreen(spec: Spec, onStart: any) {
  return render(
    <BacklogScreen backlog={[spec]} projects={[{ id: "p1", name: "p1" } as any]}
      projectFilter="all" onProjectFilter={() => {}} onStart={onStart} />,
  );
}

describe("reopen session (SPEC-172)", () => {
  it("detail spec done: tombol 'Buka sesi lagi' memanggil onStart", async () => {
    const onStart = vi.fn();
    renderScreen(doneSpec, onStart);
    fireEvent.click(screen.getByText("Reopenable")); // buka detail modal (title = TitleButton)
    const btn = await screen.findByText("Buka sesi lagi");
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledWith(doneSpec);
  });

  it("grid tidak menampilkan reopen untuk spec done — hanya badge 'selesai'", () => {
    renderScreen(doneSpec, vi.fn());
    expect(screen.getByText("selesai")).toBeTruthy();          // SpecActions cabang done
    expect(screen.queryByText("Buka sesi lagi")).toBeNull();   // tak bocor ke grid
  });

  it("detail spec non-done: tak ada tombol reopen", () => {
    renderScreen({ ...doneSpec, stage: "planned" }, vi.fn());
    fireEvent.click(screen.getByText("Reopenable"));
    expect(screen.queryByText("Buka sesi lagi")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test -- reopen-session`
Expected: FAIL — `Buka sesi lagi` belum ada.

- [x] **Step 3: Implementasi tombol + wiring**

Di `src/src/screens/BacklogScreen.tsx`:

**(a)** Perluas props `SpecDetail` (baris 70-72) menambahkan `onStart`:

```tsx
function SpecDetail({ spec, onClose, onEditBranch, onRevertStage, onStart }:
  { spec: Spec | null; onClose: () => void; onEditBranch?: (s: Spec, b: string | null) => void;
    onRevertStage?: (s: Spec, target: string, confirmDelete?: boolean) => Promise<any>;
    onStart?: (s: Spec) => void }) {
```

**(b)** Di dalam `<div style={{ marginBottom: 18 }}>` (yang memuat `<StageBar />`), tepat setelah `<StageBar stage={spec.stage} />` (baris 112) dan sebelum blok `onRevertStage && ...`, tambahkan:

```tsx
        {spec.stage === "done" && onStart && (
          <div style={{ marginTop: 12 }}>
            <Button size="sm" variant="primary" leftIcon="play" onClick={() => onStart(spec)}>
              Buka sesi lagi
            </Button>
          </div>
        )}
```

**(c)** Teruskan `onStart` saat merender `SpecDetail` di `BacklogScreen` (baris 448-449):

```tsx
      <SpecDetail spec={backlog.find((s) => s.id === detailId) || null} onClose={() => setDetailId(null)}
        onEditBranch={onEditBranch} onRevertStage={onRevertStage} onStart={onStart} />
```

(`Button` sudah diimport di baris 4. `SpecActions` tidak diubah sama sekali.)

- [x] **Step 4: Jalankan test, pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test -- reopen-session`
Expected: PASS — ketiga test hijau.

- [x] **Step 5: Pastikan tak ada regresi frontend**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test -- backlog revert-stage`
Expected: PASS — board & revert-stage lama tetap hijau (SpecActions tak berubah).

- [x] **Step 6: Update docs frontend**

Di `internal/docs/frontend/frontend-implementation.md`, di bagian yang membahas `BacklogScreen`/`SpecDetail`, tambahkan:

```markdown
- SPEC-172: `SpecDetail` menampilkan tombol **"Buka sesi lagi"** saat `spec.stage === "done"`,
  memanggil `onStart(spec)` (flow start yang sama → `POST /terminal/sessions`). Sengaja hanya
  di detail — `SpecActions` (list/grid/board) tak diubah, jadi aksi ini tak muncul di tiga view itu.
```

- [x] **Step 7: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/test/reopen-session.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(web): tombol 'Buka sesi lagi' di detail backlog untuk spec done (SPEC-172)"
```

---

### Task 4: Verifikasi nyata (typecheck + smoke API)

**Files:** tidak ada perubahan kode — hanya verifikasi.

- [x] **Step 1: Typecheck seluruh workspace**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck` (atau `pnpm -r build` bila tak ada script typecheck)
Expected: 0 error TypeScript.

- [x] **Step 2: Test tiga paket yang tersentuh**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner --filter ./server --filter ./src test`
Expected: semua hijau (server pakai `--no-file-parallelism` bila diatur repo).

- [x] **Step 3: Smoke API nyata (wajib per CLAUDE.md)**

Boot server di port aman (bukan 8787 — ada sesi dev lain), lalu buka sesi untuk spec `done` sungguhan dan pastikan sesi terpakai `continuePrompt`.

```bash
# repo target sementara berisi commit + branch main
REPO=$(mktemp -d); git -C "$REPO" init -q -b main
git -C "$REPO" -c user.email=t@t -c user.name=t commit -qm init --allow-empty

# boot server (worktree ini butuh install+generate lebih dulu bila belum)
env -u NODE_ENV -u DATABASE_URL HANOMAN_CLAUDE_BIN=/bin/echo PORT=8799 node server/dist/server.js &
sleep 2
# buat project + spec done via API (sesuaikan payload dgn kontrak /projects & /specs)
# lalu:
curl -s -X POST localhost:8799/api/terminal/sessions -H 'content-type: application/json' \
  -d '{"spec":"SPEC-XXX","flow":"feature"}' | tee /dev/stderr
# harap: 201 { id }, dan worktree .worktrees/spec-xxx lahir; log sesi memuat prompt "MELANJUTKAN".
```

Expected: `201 { id }`; worktree spec-nya lahir; prompt sesi memuat marker `MELANJUTKAN` (lanjut Execute), bukan pipeline penuh. Kalau ada issue, fix sampai hijau sebelum menyatakan selesai.

- [x] **Step 4: Centang plan & catat fase**

Centang semua `- [ ]` yang selesai di file plan ini, lalu `echo "Execute done" >> "$HANOMAN_PHASE_FILE"`.

---

## Self-Review

**Spec coverage:**
- "reopen untuk spec done" → Task 1 (prompt) + Task 2 (server pilih prompt) + Task 3 (tombol).
- "tampilkan di detail saja, bukan list/grid/board" → Task 3 (di `SpecDetail`; `SpecActions` tak disentuh) + test grid.
- "keep di Execute, jangan balik ke Objective" → Task 1 `continuePrompt` (tanpa phaseInstruction/Brainstorm) + test.
- "stage tetap done" → tak ada perubahan stage di mana pun; test grid memverifikasi badge "selesai" tetap.
- "tanpa endpoint/skema/ADR baru" → Task 2 deteksi via stage, tanpa field baru.
- Docs SoT → api-contract (Task 2), frontend-implementation (Task 3).

**Placeholder scan:** tak ada TBD/TODO; semua step memuat kode/perintah nyata.

**Type consistency:** `continuePrompt(flow, spec, branchTo)` identik signature `startPrompt`; dipanggil via `mkPrompt` di server dengan `SpecBrief` yang sama; `onStart?: (s: Spec) => void` konsisten dengan prop `BacklogScreen` yang sudah ada.
