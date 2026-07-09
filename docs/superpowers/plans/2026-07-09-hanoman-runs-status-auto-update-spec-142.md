# SPEC-142 — Status run auto-update dari `queued` · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daftar run mencerminkan transisi `queued → running` tanpa refresh manual, karena seluruh frontend menentukan "run sedang berjalan" dari satu predikat bersama `isRunActive`.

**Architecture:** Poll 3 detik di `App.tsx` adalah satu-satunya mekanisme yang me-refresh daftar run, dan gate-nya (`anyRunActive`) lupa menghitung `queued` — padahal setiap run lahir `queued`. Perbaikannya bukan transport realtime baru, melainkan satu fungsi murni `isRunActive(status)` di `@hanoman/shared` (di sebelah `zRunStatus` yang mendefinisikan kosakatanya), dipakai di empat lokasi yang hari ini menjawab pertanyaan sama dengan tiga definisi berbeda. Tidak ada perubahan server, skema, maupun interval poll.

**Tech Stack:** TypeScript strict, pnpm workspace, vitest + @testing-library/react (jsdom), React + Vite, zod.

**Spec:** [`internal/docs/operations/spec-142-runs-status-auto-update-spec.md`](../../../internal/docs/operations/spec-142-runs-status-auto-update-spec.md)
**Audit:** [`internal/docs/operations/spec-142-runs-status-auto-update-audit.md`](../../../internal/docs/operations/spec-142-runs-status-auto-update-audit.md)

## Global Constraints

- **Tanpa dependency runtime baru.** Tidak ada paket baru di `package.json` mana pun.
- **Tanpa perubahan server, skema, atau migration.** Karena tak ada migration, **tidak ada ADR** (`AGENTS.md` hanya menuntut ADR untuk perubahan skema). Jangan membuat ADR baru.
- **Guardrail freshness akan memblokir commit yang menyentuh `src/` tanpa menyentuh `internal/docs/**`.** `IMPL_PREFIXES = ["src/"]` dan `DOC_PREFIXES = ["internal/docs/", "internal/skills/", "AGENTS.md", "CLAUDE.md"]` (`cli/src/git.ts:2-3`, dipakai `freshnessViolation` di `:16-19`). `docs/superpowers/**` **tidak** dihitung sebagai doc. Karena itu Step 5 wajib memperbarui `internal/docs/frontend/frontend-implementation.md` **di commit yang sama** — ini juga aturan `CLAUDE.md`.
- **`coverageThreshold` default `100`** (`shared/src/config.ts:6`). Jangan membuat file baru di `internal/docs/**`; yang ada sudah ter-link di `internal/docs/README.md`. Menambah file tanpa link → coverage turun → plan diblok.
- **Param `isRunActive` bertipe `string`, bukan union status.** `zRunSummary.status` adalah `z.string()` (`shared/src/dto.ts:14-15`), jadi `ProjectsScreen` mengoper `string` lebar. Menyempitkan tipenya ke `z.infer<typeof zRunStatus>` akan menggagalkan `pnpm --filter ./src typecheck`. Status tak dikenal mengembalikan `false`.
- **Barrel `shared/src/index.ts` bebas `node:*`.** `./enums` sudah ter-export dari barrel; tidak perlu menyentuh barrel.
- **Jangan sentuh predikat yang menjawab pertanyaan berbeda:**
  - `src/src/screens/RunsScreen.tsx:176`, `:205`, `:271` — `running | paused` = "punya proses hidup untuk di-steer/pause/stop". Run `queued` belum punya proses. Biarkan inline.
  - `server/src/queue.ts:39` — `queued | running` = "boleh di-enqueue" (dedupe). Biarkan.
  - Menyatukan ketiganya menukar satu bug dengan tiga.
- Perintah test: satu file `pnpm --filter ./src exec vitest run test/run-poll.test.tsx`; per paket `pnpm --filter ./src test`; seluruh workspace `pnpm test`. Typecheck: `pnpm typecheck`.

---

## File Structure

| File | Tanggung jawab | Task |
|---|---|---|
| `shared/src/enums.ts` | `isRunActive(status)` — satu-satunya definisi "run sedang berjalan" | 1 |
| `src/src/App.tsx:297` | `activeRunSpecs` — spec mana yang punya run berjalan (kartu backlog) | 1 |
| `src/src/App.tsx:303` | `anyRunActive` — gate poll 3 dtk **(bug tiket ini)** | 1 |
| `src/src/screens/ProjectsScreen.tsx:71` | `running` — tampilkan label fase di `StatusPill` baris project | 1 |
| `src/src/screens/RunsScreen.tsx:127` | `busy` — sembunyikan aksi hapus baris run | 1 |
| `src/test/run-poll.test.tsx` | Tes regresi: poll menyala untuk run `queued`; kartu backlog "Buka run"; panel detail ikut `Running` | 1 |
| `src/src/screens/RunsScreen.tsx:284` | Overlay `live` di-seed ulang saat status berubah, bukan hanya id | 1 |
| `internal/docs/frontend/frontend-implementation.md` | Catat: daftar run poll-based, `isRunActive`, `queued` wajib ikut | 1 |

`server/**`, `shared/src/dto.ts`, `shared/src/index.ts`, dan `src/src/screens/run-reduce.ts` **tidak berubah**.

**Kenapa satu task:** predikat tanpa pemakainya bukan deliverable yang bisa dites, dan keempat lokasi diperbaiki oleh akar yang sama. Memecahnya menghasilkan task yang tak bisa ditolak/diterima secara terpisah oleh reviewer.

---

## Task 1: `isRunActive` bersama, dipakai empat lokasi

Gate poll (`App.tsx:303`) melewatkan `queued`; run lahir `queued` (`server/src/queue.ts:43,46`), jadi poll tak pernah menyala dan baris membeku sampai refresh manual. Akar yang sama membuat kartu backlog membiarkan tombol **Mulai** aktif untuk run `queued` (klik kedua → `409` dari `enqueueRun` → toast error), dan membuat baris project kehilangan label fase saat run `paused`.

**Files:**
- Modify: `shared/src/enums.ts` (tambah `isRunActive` di akhir file)
- Modify: `src/src/App.tsx:6-7` (import), `:296-299` (`activeRunSpecs`), `:303` (`anyRunActive`)
- Modify: `src/src/screens/ProjectsScreen.tsx:4-5` (import), `:71` (`running`)
- Modify: `src/src/screens/RunsScreen.tsx:5-8` (import), `:127` (`busy`)
- Modify: `internal/docs/frontend/frontend-implementation.md:31-36` (§ Live run view)
- Create: `src/test/run-poll.test.tsx`

**Interfaces:**
- Produces: `isRunActive(status: string): boolean` — di-export dari `shared/src/enums.ts`, ikut ter-export lewat barrel `@hanoman/shared` (`shared/src/index.ts:3` sudah `export * from "./enums"`). Benar untuk `"queued" | "running" | "paused"`; salah untuk `"stopped" | "failed" | "done"` dan string tak dikenal.
- Consumes: tidak ada dari task lain. `zRunStatus` (`shared/src/enums.ts:4`) hanya tetangga tekstual, tidak diimpor.

---

- [x] **Step 1: Tulis tes yang gagal**

Berkas baru `src/test/run-poll.test.tsx`. Berkas terpisah dari `app-flows.test.tsx` karena satu berkas hanya boleh punya satu `vi.mock` per modul, dan `app-flows.test.tsx` sudah mengunci `listRuns` ke `[]` untuk tes lain.

Pola mock meniru `src/test/app-states.test.tsx`: `vi.mock` di-hoist ke atas berkas, jadi factory-nya hanya boleh **merujuk** `runsFn`/`specsFn` di dalam arrow yang dipanggil belakangan — bukan membacanya saat factory dieksekusi.

```tsx
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const QUEUED_RUN = {
  id: "RUN-1", projectId: "arta", specId: "SPEC-142", kind: "qa", status: "queued",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
  worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
  model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0,
  createdAt: "2026-07-09T00:00:00.000Z", finishedAt: null,
};
const QA_SPEC = {
  id: "SPEC-142", projectId: "arta", title: "Runs", source: "qa", stage: "spec-ready",
  priority: "tinggi", author: "qa", objective: "runs status auto update", payload: null,
};

const runsFn = vi.fn(async () => [QUEUED_RUN]);
const specsFn = vi.fn(async () => [QA_SPEC]);

vi.mock("../src/api/client", () => ({
  api: {
    listProjects: vi.fn(async () => []),
    listSpecs: (...a: unknown[]) => specsFn(...(a as [])),
    listRuns: (...a: unknown[]) => runsFn(...(a as [])),
    listTriggers: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    startRun: vi.fn(), deleteSpec: vi.fn(), createSpec: vi.fn(),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("daftar run auto-update (SPEC-142)", () => {
  beforeEach(() => { runsFn.mockClear(); specsFn.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it("me-refetch daftar run selama run masih queued", async () => {
    // shouldAdvanceTime: true — waitFor milik RTL butuh timer yang tetap maju.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App />);
    await waitFor(() => expect(runsFn).toHaveBeenCalledTimes(1)); // muat awal
    await act(async () => { vi.advanceTimersByTime(3100); });     // satu tick poll
    expect(runsFn.mock.calls.length).toBeGreaterThan(1);
  });

  it("kartu backlog run queued menampilkan 'Buka run', bukan 'Mulai'", async () => {
    render(<App />);
    await waitFor(() => expect(runsFn).toHaveBeenCalledTimes(1));
    // Sidebar dirender sebelum konten, jadi [0] adalah item nav "Backlog".
    fireEvent.click(screen.getAllByText("Backlog")[0]!);
    expect(await screen.findByText("Buka run")).toBeInTheDocument();
    expect(screen.queryByText("Mulai")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan tes, pastikan gagal karena alasan yang benar**

Run: `pnpm --filter ./src exec vitest run test/run-poll.test.tsx`

Expected: **2 failed.**
- Tes 1 gagal di `expect(runsFn.mock.calls.length).toBeGreaterThan(1)` — dapat `1`. `anyRunActive` `false` untuk run `queued`, jadi `setInterval` tak pernah dipasang.
- Tes 2 gagal di `findByText("Buka run")` — "Unable to find an element with the text: Buka run". `activeRunSpecs` kosong, kartu masih menampilkan **Mulai**.

Kalau tes 1 justru lolos, hentikan: berarti ada run lain yang aktif di fixture, dan tes tidak menguji apa pun.

- [x] **Step 3: Tambahkan `isRunActive` ke shared**

Tambahkan di **akhir** `shared/src/enums.ts` (di bawah `zSeverity`):

```ts
// Satu-satunya definisi "run sedang berjalan" (SPEC-142). `queued` wajib ikut: setiap
// run lahir queued, dan gate poll yang melewatkannya membuat daftar run membeku sampai
// operator refresh manual. Param `string` (bukan z.infer<typeof zRunStatus>) karena
// zRunSummary.status di dto.ts adalah z.string(); status tak dikenal → false.
// Beda dari "punya proses hidup" (running|paused, untuk steer/pause/stop) dan dari
// "boleh di-enqueue" (queued|running, dedupe di server/src/queue.ts).
export const isRunActive = (status: string): boolean =>
  status === "queued" || status === "running" || status === "paused";
```

- [x] **Step 4: Pakai di empat lokasi**

`src/src/App.tsx` — tambahkan import nilai di bawah baris `import { api, ApiError } from "./api/client";` (baris 6). Import `type` yang ada di baris 7 tetap:

```tsx
import { isRunActive } from "@hanoman/shared";
```

Ganti `activeRunSpecs` (baris 296-299):

```tsx
  const activeRunSpecs = React.useMemo(
    () => new Set(runs.filter((r) => r.specId && isRunActive(r.status))
      .map((r) => r.specId as string)),
    [runs]);
```

Ganti `anyRunActive` (baris 303):

```tsx
  const anyRunActive = runs.some((r) => isRunActive(r.status));
```

`src/src/screens/ProjectsScreen.tsx` — tambahkan import di bawah `import type { ProjectVM, RunVM } from "./types";`:

```tsx
import { isRunActive } from "@hanoman/shared";
```

Ganti baris 71 (ini juga memulihkan label fase untuk run `paused`):

```tsx
  const running = isRunActive(p.run.status);
```

`src/src/screens/RunsScreen.tsx` — tambahkan import di bawah `import { reduceRunEvent, runDurationMs, fmtDuration } from "./run-reduce";`:

```tsx
import { isRunActive } from "@hanoman/shared";
```

Ganti baris 127:

```tsx
  const busy = isRunActive(run.status);
```

Jangan sentuh baris 176, 205, dan 271 di berkas yang sama — lihat Global Constraints.

- [x] **Step 5: Perbarui doc yang tersentuh (wajib, di commit yang sama)**

`internal/docs/frontend/frontend-implementation.md` — tambahkan paragraf di akhir § **Live run view (SPEC-008)** (setelah baris 36):

```markdown
Daftar run **tidak** berlangganan SSE — SSE hanya mengisi overlay panel detail lewat
`reduceRunEvent`, tak pernah menyentuh array `runs`. Yang menyegarkan daftar adalah poll
3 dtk di `App` (`listSpecs` + `listRuns`) selama ada run **aktif**, dan "aktif" berarti
`isRunActive(status)` — satu predikat di `@hanoman/shared` yang mencakup `queued`,
`running`, dan `paused` (SPEC-142). `queued` wajib ikut: setiap run lahir `queued`, jadi
gate yang melewatkannya membuat daftar membeku sampai refresh manual. Predikat yang sama
menentukan kartu backlog menampilkan **Buka run** alih-alih **Mulai**, baris run
menyembunyikan aksi hapus, dan baris project menampilkan label fase. Predikat "punya
proses hidup" (`running | paused`, untuk steer/pause/stop) sengaja berbeda dan tetap inline.
```

- [x] **Step 6: Jalankan tes, pastikan hijau**

Run: `pnpm --filter ./src exec vitest run test/run-poll.test.tsx`
Expected: **2 passed.**

Run: `pnpm typecheck`
Expected: keluar `0`. Bila `ProjectsScreen.tsx:71` mengeluh `string` tidak assignable, param `isRunActive` telanjur disempitkan — kembalikan ke `string` (Global Constraints).

Run: `pnpm test`
Expected: seluruh workspace hijau. `src/test/app-flows.test.tsx` dan `app-states.test.tsx` tetap lolos (keduanya mengembalikan `listRuns: []`, jadi poll tetap mati di sana).

Catatan bila `queue-durability` di paket `server` gagal: tes itu **order-dependent** dan gagal bila dijalankan terisolasi; jalankan `pnpm --filter ./server test` utuh sebelum menyimpulkan ada regresi. Perubahan di plan ini tak menyentuh `server/**`.

- [x] **Step 7: Verifikasi nyata di aplikasi (aturan `CLAUDE.md`)**

Tes unit tidak membuktikan gate poll menyala di browser. Boot aplikasi dan amati satu run nyata berpindah `queued → running` tanpa refresh:

```bash
pnpm dev            # api + worker + web
```

Buka Backlog → **Mulai** pada satu spec → pindah ke Runs. Baris run harus muncul `queued`
lalu berubah `running` sendiri dalam ≤ 3 dtk, tanpa reload. Kartu backlog spec itu harus
berganti menjadi **Buka run**.

**Peringatan:** `POST /runs` dengan worker hidup mengeksekusi run **nyata** di latar
belakang, dan repo ini tak punya `origin` sehingga run akan gagal di `commitAndPush`.
Itu wajar dan tidak membatalkan verifikasi — yang diamati adalah transisi
`queued → running`, bukan run yang sukses. Hentikan run lewat dashboard setelah terlihat.

- [x] **Step 8: Centang checklist plan ini lalu commit**

Ubah setiap `- [ ]` yang selesai di berkas plan ini menjadi `- [x]` (aturan `CLAUDE.md`).

```bash
git add shared/src/enums.ts \
        src/src/App.tsx \
        src/src/screens/ProjectsScreen.tsx \
        src/src/screens/RunsScreen.tsx \
        src/test/run-poll.test.tsx \
        internal/docs/frontend/frontend-implementation.md \
        docs/superpowers/plans/2026-07-09-hanoman-runs-status-auto-update-spec-142.md
git commit -m "fix(web): daftar run auto-update dari queued lewat predikat isRunActive bersama"
```

Jangan `git add -A` dan jangan `git stash` — worktree ini dipakai bersama sesi lain.

---

## Kriteria selesai

Dipetakan dari kriteria EARS di spec:

| Kriteria EARS (spec) | Dijaga oleh |
|---|---|
| `isRunActive` benar untuk `queued`/`running`/`paused`, salah untuk sisanya | Step 3 + typecheck |
| **Mulai** → baris `queued` + poll menyala | Tes 1, Step 7 |
| `queued → running` terlihat ≤ 3 dtk tanpa refresh | Tes 1, Step 7 |
| Poll me-refetch tiap 3 dtk selama ada run aktif | Tes 1 |
| Poll berhenti bila tak ada run aktif | `anyRunActive` `false` → efek `App.tsx:304-312` cleanup; `app-flows`/`app-states` (listRuns `[]`) tetap hijau di Step 6 |
| Kartu backlog menampilkan **Buka run** | Tes 2, Step 7 |
| Baris run `queued` menyembunyikan aksi hapus | `RunsScreen.tsx:127` (Step 4) |
| Baris project menampilkan label fase saat aktif | `ProjectsScreen.tsx:71` (Step 4) |

---

## Temuan saat Execute (di luar rencana awal)

Step 7 (verifikasi di browser nyata) menangkap apa yang lolos dari tes unit: **baris daftar
berubah `Running`, tapi panel detail tetap `Queued`.** Overlay `live` di `RunsScreen.tsx:284`
di-seed sekali per **id** run (`[picked?.id]`), jadi status baru yang dibawa poll tak pernah
masuk ke panel detail.

Pada run nyata akibatnya lebih buruk daripada di rig verifikasi: worker menerbitkan
`status: running` (`runner/src/run.ts:34`) **sebelum** klien sempat membuka langganan SSE, dan
Redis pub/sub tak punya replay — jadi pill detail bertahan `Queued` **sepanjang run**, sampai
event `done`/`failed` tiba.

Perbaikan: tambahkan `picked?.status` ke deps efek seed. Satu baris, dijaga tes ketiga
(`panel detail ikut jadi Running`). Server tidak disentuh, jadi ini **bukan** pelanggaran batas
scope "frame `status` pada snapshot SSE" — yang diperbaiki overlay klien, bukan transport.

Pelajaran: tanpa Step 7 perbaikan ini akan lolos dengan tes hijau dan UI yang saling
bertentangan — baris bilang `Running`, detail bilang `Queued`.
