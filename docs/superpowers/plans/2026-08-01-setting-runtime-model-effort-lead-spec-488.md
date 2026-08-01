# SPEC-488 — Setting runtime, model, effort hanoman-lead · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (atau
> superpowers:subagent-driven-development) untuk mengeksekusi plan ini task demi task. Langkah
> memakai checkbox (`- [ ]`).

**Goal:** Operator bisa menyetel runtime (claude/codex), model, dan effort agen hanoman-lead dari
dashboard Settings; nilainya terbukti sampai ke **argv proses lead**; belum diisi → jatuh ke default
lama; berlaku tanpa restart server.

**Architecture:** Blok `Setting.lead.engine` (`zLeadEngine`) beserta resolver
`leadAgentDefaults()` → `decide()` → `think()` → `leadArgv()` **sudah lengkap** sejak SPEC-409 ·
ADR-0091. Yang dibangun spec ini: (1) permukaan operator — kartu "Agen hanoman-lead" di
`SettingsScreen` tab **Model sesi**, cermin kartu konflik ADR-0081; (2) bukti argv ujung-ke-ujung
lewat fixture perekam argv; (3) satu baris di `LeadScreen` yang menyebutkan mesin yang dipakai.
**Skema `Setting` tidak berubah → tanpa migration, tanpa ADR baru, tanpa endpoint baru.**

**Tech Stack:** React + TypeScript (Vite) · Fastify + Prisma 6 (SQLite) · zod (`@hanoman/shared`) ·
vitest + @testing-library/react.

## Global Constraints

- **Tanpa perubahan skema `Setting`** → tanpa migration, tanpa ADR baru (constraint brief terpenuhi
  karena `zLeadEngine` sudah ada di `shared/src/entities.ts:237`).
- **Resolver ADR-0049 dihormati:** tak ada store kedua. Setelan hidup di blok `Setting.data.lead.engine`;
  biner agen tetap lewat `effectiveStr("HANOMAN_CLAUDE_BIN"/"HANOMAN_CODEX_BIN")`.
- **Katalog dari sumber yang sudah ada:** `MODELS`/`EFFORTS` (claude), `CODEX_MODELS`/`codexEfforts(model)`/
  `coerceCodexEffort` (codex). Effort codex adalah properti **per-model** (SPEC-339) — picker WAJIB
  `codexEfforts(model)`, bukan `CODEX_EFFORTS`.
- **Kartu lead menulis lewat `PUT /lead/config`**, tidak lewat `PUT /settings` (alasan lengkap di
  design §D2: blok `lead` punya penulis kedua, `LeadScreen`).
- **Scope verifikasi = yang berubah saja** (ADR-0080). Test server WAJIB
  `--no-file-parallelism` **dan** `TEST_DATABASE_URL` sendiri (SPEC-479).
- Bahasa komentar & copy UI: **Indonesia**, mengikuti berkas sekitarnya.
- Docs `internal/docs/**` yang tersentuh diperbarui **dalam commit yang sama**.

## File Structure

| Berkas | Tanggung jawab | Aksi |
|---|---|---|
| `server/test/fixtures/fake-lead-argv.sh` | agen lead palsu one-shot yang **merekam argv** ke berkas lalu mencetak putusan json sah | Create |
| `server/test/lead-engine-argv.test.ts` | mengunci rantai `Setting.lead.engine` → `leadAgentDefaults()` → argv proses | Create |
| `src/src/screens/SettingsScreen.tsx` | kartu "Agen hanoman-lead" di tab Model sesi + penulis `PUT /lead/config` | Modify |
| `src/test/settings-lead-engine.test.tsx` | kontrak kartu: warisan, katalog per runtime, koersi effort, read-modify-write bersegar | Create |
| `src/src/screens/LeadScreen.tsx` | satu baris "mesin: …" di `ControlBar` | Modify |
| `src/test/lead-screen.test.tsx` | kontrak baris mesin (hidup & mati) | Modify |
| `internal/docs/architecture/data-model.md` | bullet `lead`: permukaan operator + alasan penulis kedua | Modify |
| `internal/docs/frontend/frontend-implementation.md` | section "Settings → Model sesi → Agen hanoman-lead" | Modify |
| `internal/skills/hanoman/SKILL.md` | butir hanoman-lead: blok `engine` punya permukaan + gotcha | Modify |

---

### Task 1: Bukti argv — fixture perekam + test rantai setelan → argv

Rantai `Setting.lead.engine` → argv hari ini **tak punya satu pun test**: `lead-decide.test.ts`
menyuntik `think` sebagai stub, jadi berkas `brain.ts` tak pernah dieksekusi olehnya (kelas jebakan
SPEC-448). Task ini memasang buktinya lebih dulu, sebelum UI apa pun ditulis — UI tanpa bukti
argv hanya memindahkan asumsi.

**Files:**
- Create: `server/test/fixtures/fake-lead-argv.sh`
- Create: `server/test/lead-engine-argv.test.ts`

**Interfaces:**
- Consumes: `leadAgentDefaults()` dari `server/src/services/lead/config.ts`;
  `decide(req, deps)` + `prodDecideDeps` dari `server/src/services/lead/decide.ts`;
  `getSetting()` dari `server/src/services/settings.ts`; `setLead(next: Lead)` dari
  `server/src/services/lead/config.ts`.
- Produces: fixture `fake-lead-argv.sh` yang membaca env **`HANOMAN_LEAD_ARGV_FILE`** dan menulis
  satu argumen per baris (kecuali argumen terakhir = prompt), lalu mencetak blok ```json putusan
  sah. Dipakai lagi oleh smoke di Task 5.

- [ ] **Step 1: Tulis fixture perekam argv**

Create `server/test/fixtures/fake-lead-argv.sh`:

```sh
#!/bin/sh
# SPEC-488 · agen lead palsu yang MEREKAM ARGV-nya. Sengaja berbeda dari dua fixture yang sudah ada:
#
#   - `fake-claude.sh` diakhiri `exec cat` karena mensimulasikan TUI di pane tmux. Memakainya untuk
#     agen one-shot membuat setiap panggilan `think()` selalu "kehabisan waktu" — hijau dan merah
#     tak terbedakan (jebakan SPEC-448).
#   - `fake-lead-agent.sh` keluar sendiri, tapi mencetak `args:` ke stdout dan TAK PERNAH
#     mengeluarkan blok ```json. `decide()` karena itu berhenti di parser (`parseLeadVerdict` → null)
#     dan mencatat baris `gagal` sebelum sempat membuktikan apa pun tentang setelan.
#
# Yang ini merekam argv ke berkas LALU mencetak putusan yang SAH, sehingga rantai
# Setting.lead.engine → leadAgentDefaults() → leadArgv() → proses bisa diperiksa dari ujung ke ujung.
#
# Argumen TERAKHIR sengaja tak direkam: itu prompt lead (±10 KB, memuat baris baru) dan
# menuliskannya akan mencemari berkas rekaman yang dibaca per baris.
if [ -n "$HANOMAN_LEAD_ARGV_FILE" ]; then
  n=$#
  i=1
  for a in "$@"; do
    if [ "$i" -lt "$n" ]; then printf '%s\n' "$a" >>"$HANOMAN_LEAD_ARGV_FILE"; fi
    i=$((i + 1))
  done
fi
# Bukti stdin ditutup pemanggil (SPEC-448): tanpa `stdin.end()` di brain.ts, `cat` menggantung
# sampai timeout dan test ini akan gagal karena kehabisan waktu, bukan karena argv-nya salah.
cat >/dev/null
printf '```json\n{"decision":"lanjut","reason":"argv terekam","confidence":"tinggi"}\n```\n'
```

- [ ] **Step 2: Tulis test rantai setelan → argv**

Create `server/test/lead-engine-argv.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Setting } from "@hanoman/shared";
import { getSetting } from "../src/services/settings";
import { leadAgentDefaults } from "../src/services/lead/config";
import { decide, prodDecideDeps, type DecideDeps } from "../src/services/lead/decide";
import { __resetLeadGate } from "../src/services/lead/gate";
import { __resetDeciding } from "../src/services/lead/deciding";

// SPEC-488 · runtime/model/effort agen lead disetel operator, dan setelan itu harus benar-benar
// sampai ke ARGV proses lead — bukan sekadar tersimpan. Rantainya:
//
//   Setting.data.lead.engine → leadAgentDefaults() → decide() → brain.think() → leadArgv() → argv
//
// Sampai spec ini rantai itu tak punya satu pun test: `lead-decide.test.ts` menyuntik `think`
// sebagai stub (kelas jebakan SPEC-448), jadi `brain.ts` tak pernah dieksekusi olehnya dan
// `leadAgentDefaults()` tak pernah dipanggil sama sekali.

const FAKE = fileURLToPath(new URL("./fixtures/fake-lead-argv.sh", import.meta.url));
chmodSync(FAKE, 0o755);

let argvFile = "";

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.leadFlow.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};

beforeEach(async () => {
  await clean();
  __resetLeadGate(); __resetDeciding();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
  argvFile = join(mkdtempSync(join(tmpdir(), "lead-argv-")), "argv.txt");
  process.env.HANOMAN_LEAD_ARGV_FILE = argvFile;
  process.env.HANOMAN_CLAUDE_BIN = FAKE;
  process.env.HANOMAN_CODEX_BIN = FAKE;
});
afterEach(() => {
  delete process.env.HANOMAN_LEAD_ARGV_FILE;
  delete process.env.HANOMAN_CLAUDE_BIN;
  delete process.env.HANOMAN_CODEX_BIN;
});
afterAll(clean);

/** Tulis seluruh blok Setting sekaligus — perlu karena test ini menggeser `agent`/`codex` GLOBAL. */
async function putSetting(over: Partial<Setting>): Promise<void> {
  const data = { ...(await getSetting()), ...over } as unknown as object;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}

const leadOn = (engine: Partial<Setting["lead"]["engine"]> = {}) => ({
  ...LEAD_DEFAULTS, enabled: true,
  engine: { ...LEAD_DEFAULTS.engine, ...engine },
});

/** Argv yang benar-benar dilihat proses lead, satu argumen per baris (prompt tak direkam). */
const recordedArgv = (): string[] =>
  existsSync(argvFile) ? readFileSync(argvFile, "utf8").split("\n").filter(Boolean) : [];

/** Nilai yang mengikuti sebuah flag di argv. `undefined` bila flag-nya tak ada sama sekali. */
const after = (argv: string[], flag: string): string | undefined =>
  argv.indexOf(flag) === -1 ? undefined : argv[argv.indexOf(flag) + 1];

// `prodDecideDeps` dipakai APA ADANYA untuk `think` & `defaults` — itulah inti test ini. Hanya
// pembacaan tmux & notifikasi yang dilucuti: keduanya di luar rantai yang sedang dibuktikan, dan
// `listSessions()` menembak `tmux` sungguhan di mesin yang menjalankan test.
const argvDeps: DecideDeps = { ...prodDecideDeps, liveSessions: () => [], notify: async () => {} };
const ask = { projectId: "demo", gate: "contract", kind: "answer", question: "Lanjut?" } as const;

describe("leadAgentDefaults · setelan lead vs warisan default sesi", () => {
  it("engine mati → warisan default sesi claude (perilaku lama, tanpa kejutan)", async () => {
    await putSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh", lead: leadOn() });
    expect(await leadAgentDefaults()).toEqual({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
  });

  it("engine mati + agen global codex → lead ikut codex, bukan claude", async () => {
    await putSetting({
      agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" }, lead: leadOn(),
    });
    expect(await leadAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  it("engine hidup → triple lead menang atas default sesi", async () => {
    await putSetting({
      agent: "claude", model: "claude-opus-5", effort: "xhigh",
      lead: leadOn({ enabled: true, agent: "claude", model: "claude-sonnet-5", effort: "low" }),
    });
    expect(await leadAgentDefaults()).toEqual({ agent: "claude", model: "claude-sonnet-5", effort: "low" });
  });

  it("engine codex → effort dikoersi ke yang didukung MODEL-nya (SPEC-339)", async () => {
    // Luna tak mendukung `ultra`; menyimpannya apa adanya berarti sesi lead lahir dengan pasangan
    // yang ditolak codex.
    await putSetting({ lead: leadOn({ enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "ultra" }) });
    expect(await leadAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });
});

describe("SPEC-488 · setelan lead sampai ke ARGV proses lead", () => {
  it("engine hidup (claude) → --model/--effort persis dari setelan", async () => {
    await putSetting({
      model: "claude-opus-5", effort: "xhigh",
      lead: leadOn({ enabled: true, agent: "claude", model: "claude-sonnet-5", effort: "low" }),
    });
    const row = await decide({ ...ask }, argvDeps);
    expect(row?.status).toBe("berlaku");
    const argv = recordedArgv();
    expect(argv[0]).toBe("-p");
    expect(after(argv, "--model")).toBe("claude-sonnet-5");
    expect(after(argv, "--effort")).toBe("low");
  });

  it("engine hidup (codex) → `exec -m` + `-c model_reasoning_effort`", async () => {
    await putSetting({ lead: leadOn({ enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "medium" }) });
    const row = await decide({ ...ask }, argvDeps);
    expect(row?.status).toBe("berlaku");
    const argv = recordedArgv();
    expect(argv[0]).toBe("exec");
    expect(after(argv, "-m")).toBe("gpt-5.6-terra");
    expect(argv).toContain('model_reasoning_effort="medium"');
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("engine mati → argv memakai default sesi global (fallback ke perilaku lama)", async () => {
    await putSetting({
      agent: "claude", model: "claude-haiku-4-5", effort: "medium", lead: leadOn(),
    });
    const row = await decide({ ...ask }, argvDeps);
    expect(row?.status).toBe("berlaku");
    const argv = recordedArgv();
    expect(after(argv, "--model")).toBe("claude-haiku-4-5");
    expect(after(argv, "--effort")).toBe("medium");
  });

  // AC "ganti setting tanpa restart server": `getSetting()` membaca baris DB tiap panggilan dan
  // `leadAgentDefaults()` dipanggil DI DALAM `decide()`. Sifat itu tak boleh berubah diam-diam —
  // siapa pun yang kelak memasang cache di `getSetting()` harus melihat test ini merah.
  it("setelan diganti di tengah proses yang sama → putusan BERIKUTNYA memakai argv baru", async () => {
    await putSetting({ lead: leadOn({ enabled: true, agent: "claude", model: "claude-sonnet-5", effort: "low" }) });
    await decide({ ...ask }, argvDeps);
    await putSetting({ lead: leadOn({ enabled: true, agent: "claude", model: "claude-fable-5", effort: "high" }) });
    await decide({ ...ask }, argvDeps);

    const argv = recordedArgv();
    // Dua panggilan → dua rekaman berurutan di berkas yang sama.
    expect(argv.filter((a) => a === "claude-sonnet-5")).toHaveLength(1);
    expect(argv.filter((a) => a === "claude-fable-5")).toHaveLength(1);
    expect(argv.filter((a) => a === "high")).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Jalankan test**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/lead-engine-argv.test.ts
```

Expected: **8 test PASS**. Rantai memang sudah terpasang di server sejak ADR-0091 — test ini
mengunci, bukan menambah. Bukti bahwa ia tidak hampa: test `engine mati` dan `engine hidup`
menuntut argv yang **berbeda** dari input yang sama, jadi wiring yang putus di sisi mana pun
memerahkan salah satunya.

Bila muncul kegagalan ramai **404/P2022** → itu DB test bersama yang dihapus run tetangga
(SPEC-479), bukan regresi: ulangi dengan `TEST_DATABASE_URL` yang baru.

- [ ] **Step 4: Commit**

```bash
git add server/test/fixtures/fake-lead-argv.sh server/test/lead-engine-argv.test.ts
git commit -m "test(488): kunci rantai Setting.lead.engine → argv proses lead"
```

---

### Task 2: Kartu "Agen hanoman-lead" di Settings → tab Model sesi

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx` (blok `if (tab === "model")`, sesudah kartu
  "Konflik rebase & merge" yang berakhir di baris ~858)
- Create: `src/test/settings-lead-engine.test.tsx`

**Interfaces:**
- Consumes: `LEAD_DEFAULTS`, `MODELS`/`EFFORTS` (lewat `S_MODELS`/`S_EFFORT` yang sudah ada di
  berkas), `CODEX_MODELS`, `codexEfforts`, `coerceCodexEffort` — semuanya **sudah** diimpor di
  `SettingsScreen.tsx`; helper lokal `codexNote(model)`, `codexOptions(model)`, `inherited`,
  `AGENT_LABEL`, `SettingRow` — semuanya sudah ada di dalam blok `tab === "model"`.
  `api.getLeadConfig()` / `api.putLeadConfig(cfg: Lead)` dari `src/src/api/client.ts:406-407`.
- Produces: `data-testid="lead-engine-inherited"`; `aria-label` `"Override agen lead"`,
  `"Runtime lead"`, `"Model lead"`, `"Effort lead"`.

- [ ] **Step 1: Tulis test kontrak kartu (gagal dulu)**

Create `src/test/settings-lead-engine.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// SPEC-488 · runtime/model/effort agen hanoman-lead. Blok `Setting.lead.engine` ada sejak ADR-0091
// tapi tak pernah punya satu pun kontrol — satu-satunya jalan menyetelnya adalah curl.
vi.mock("../src/api/client", () => ({
  api: {
    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn(),
    getLeadConfig: vi.fn(), putLeadConfig: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };

const LEAD = (over: object = {}) => ({
  enabled: false, paused: false, pausedProjects: [], everyMin: 5, timeoutSec: 600,
  maxAutoAnswers: 3, maxConcurrent: 2, queueWaitSec: 120, flowTtlMin: 60,
  requireGreenBeforeIntegrate: true,
  engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  ...over,
});
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  lead: LEAD(), ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
  vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD() as any);
  vi.mocked(api.putLeadConfig).mockImplementation(async (c: any) => c);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SPEC-488 · kartu agen hanoman-lead", () => {
  it("kartu ada di tab Model sesi", async () => {
    openModel();
    expect(await screen.findByText("Agen hanoman-lead")).toBeInTheDocument();
  });

  // Opt-in: mati = warisan penuh, dan kartunya HARUS menyebut nilai warisannya — kalau tidak
  // operator ditinggal bertanya "lalu lead pakai apa?" (pelajaran SPEC-383).
  it("mati → tak ada picker, nilai warisan ditampilkan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }) as any);
    openModel();
    const inh = await screen.findByTestId("lead-engine-inherited");
    expect(inh).toHaveTextContent("Codex CLI");
    expect(inh).toHaveTextContent("gpt-5.6-terra");
    expect(inh).toHaveTextContent("high");
    expect(screen.queryByLabelText("Runtime lead")).toBeNull();
  });

  it("menyalakan override → PUT /lead/config dengan engine.enabled true", async () => {
    openModel();
    const wrap = await screen.findByLabelText("Override agen lead");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ engine: expect.objectContaining({ enabled: true }) })));
  });

  // Inti keputusan D2: blok `lead` punya penulis KEDUA (LeadScreen). Snapshot Settings dimuat
  // sekali saat mount; menulis blok lead DARI snapshot itu akan mengembalikan rem darurat yang
  // ditekan di layar Lead sesudahnya. Nilai lead non-engine WAJIB datang dari GET yang segar.
  it("field lead lain datang dari GET segar, bukan snapshot Settings", async () => {
    vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD({ paused: true, everyMin: 42 }) as any);
    openModel();
    const wrap = await screen.findByLabelText("Override agen lead");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true, everyMin: 42 })));
    expect(api.putSettings).not.toHaveBeenCalled();
  });

  it("menukar runtime ke codex → model & effort ikut bertukar ke katalog codex", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ lead: LEAD({ engine: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "xhigh" } }) }) as any);
    vi.mocked(api.getLeadConfig).mockResolvedValue(
      LEAD({ engine: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "xhigh" } }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Runtime lead"), { target: { value: "codex" } });
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" } })));
  });

  // SPEC-339 · effort adalah properti MODEL. Luna tak mendukung `ultra`; menyimpannya apa adanya
  // berarti lead lahir dengan pasangan yang ditolak codex.
  it("memilih model codex yang tak mendukung effort tersimpan → effort dikoersi", async () => {
    const eng = { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "ultra" };
    vi.mocked(api.getSettings).mockResolvedValue(settings({ lead: LEAD({ engine: eng }) }) as any);
    vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD({ engine: eng }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Model lead"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ engine: expect.objectContaining({ model: "gpt-5.6-luna", effort: "xhigh" }) })));
  });

  it("picker effort codex hanya menawarkan effort yang didukung model terpilih", async () => {
    const eng = { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" };
    vi.mocked(api.getSettings).mockResolvedValue(settings({ lead: LEAD({ engine: eng }) }) as any);
    openModel();
    const sel = await screen.findByLabelText("Effort lead");
    const values = Array.from(sel.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).not.toContain("ultra");
    expect(values).toContain("max");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/settings-lead-engine.test.tsx
```

Expected: **7 FAIL** — `Unable to find an element with the text: Agen hanoman-lead` dst.
(`env -u NODE_ENV` wajib: `NODE_ENV=production` di env sesi membuat RTL `act` gagal massal.)

- [ ] **Step 3: Tambahkan kartu di `SettingsScreen.tsx`**

Di dalam `if (tab === "model") { … }`, **sesudah** deklarasi `inherited` (yang sudah ada untuk kartu
konflik) sisipkan penulis blok lead:

```tsx
      // SPEC-488 · blok `Setting.lead.engine` — agen yang MENJALANKAN hanoman-lead. `?? LEAD_DEFAULTS`
      // sama alasannya dengan `?? CONFLICT_DEFAULTS`: respons GET /settings yang ter-cache dari
      // instance lama belum punya kuncinya, dan layar tak boleh mati `undefined.engine`.
      const lead = s.lead ?? LEAD_DEFAULTS;
      const engine = lead.engine ?? LEAD_DEFAULTS.engine;
      // Kartu ini menulis lewat PUT /lead/config, BUKAN `save()` (PUT /settings) seperti kartu
      // konflik — dan itu perbedaan sadar. `persist()` mengirim SELURUH objek Setting dari snapshot
      // yang dimuat sekali saat mount, sementara blok `lead` punya penulis KEDUA: LeadScreen
      // (rem darurat Pause, denyut, batas waktu, opt-in per project). Urutan "buka Settings →
      // tekan Pause di layar Lead → ganti model lead di Settings" akan mengembalikan `paused` ke
      // nilai snapshot, yakni rem darurat yang lepas sendiri tanpa satu pun klik yang mengatakannya.
      // Karena itu: baca blok lead SEGAR, tempel `engine`-nya, tulis balik lewat endpoint lead.
      const saveEngine = async (patch: Partial<Setting["lead"]["engine"]>, msg: string) => {
        const prev = lead;
        setS({ ...s, lead: { ...lead, engine: { ...engine, ...patch } } });   // optimistis
        try {
          const fresh = await api.getLeadConfig();
          const saved = await api.putLeadConfig({
            ...fresh, engine: { ...(fresh.engine ?? LEAD_DEFAULTS.engine), ...patch },
          });
          setS((p) => (p ? { ...p, lead: saved } : p));
          onToast?.(msg, "ok", "check-circle-2");
        } catch {
          setS((p) => (p ? { ...p, lead: prev } : p));
          onToast?.("Gagal menyimpan setelan lead", "err", "alert-triangle");
        }
      };
```

Lalu sisipkan kartunya **sesudah** `</Card>` penutup kartu "Konflik rebase & merge", sebelum
`</>`:

```tsx
      {/* SPEC-488 · agen yang MENJALANKAN hanoman-lead. Bloknya (`Setting.lead.engine`) ada sejak
          SPEC-409/ADR-0091 tapi tak pernah punya permukaan operator — satu-satunya jalan
          menyetelnya adalah `curl PUT /api/lead/config` dengan blok `Lead` utuh dirakit tangan.
          Opt-in seperti kartu konflik: mati = lead memakai default global di atas. */}
      <Card eyebrow="lead" title="Agen hanoman-lead">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Mesin yang menjalankan agen pemimpin — panggilan sekali-jalan non-interaktif yang membaca
          docs, plan, kode, dan riwayat git sebelum memutuskan. Berlaku untuk ketiga pintu lead
          (kontrak, deteksi otomatis, denyut) dan dipakai putusan berikutnya, tanpa restart. Rem
          darurat, denyut, dan opt-in per project tetap diurus di layar <b>Lead</b>.
        </div>
        <SettingRow title="Pakai setelan sendiri"
          desc="Mati = ikut default global di atas. Hidup = lead memakai pilihan di bawah.">
          <Switch aria-label="Override agen lead" checked={engine.enabled}
            onChange={(v: boolean) => saveEngine({ enabled: v },
              "Setelan lead" + (v ? " · aktif" : " · ikut default global"))} />
        </SettingRow>
        {!engine.enabled ? (
          <div data-testid="lead-engine-inherited" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0 2px", lineHeight: 1.5 }}>
            hanoman-lead memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> ·{" "}
            <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
          </div>
        ) : (
          <>
            <SettingRow title="Runtime" desc="Mesin yang menjalankan lead. Bisa beda dari agen sesi kerja.">
              <Select size="sm" aria-label="Runtime lead" value={engine.agent} style={{ width: 190 }}
                options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
                onChange={(e) => {
                  // Cermin `pickAgent`/kartu konflik: menukar runtime HARUS menukar model+effort
                  // sekalian, kalau tidak lead lahir dengan `codex -m claude-opus-5`.
                  const a = e.target.value as "claude" | "codex";
                  const d = a === "codex" ? codex : { model: s.model, effort: s.effort };
                  saveEngine({ agent: a, model: d.model,
                    effort: a === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort },
                    "Runtime lead → " + a);
                }} />
            </SettingRow>
            {engine.agent === "codex" && codexNote(engine.model)}
            <SettingRow title="Model">
              <Select size="sm" aria-label="Model lead" value={engine.model} style={{ width: 190 }}
                options={engine.agent === "codex" ? codexOptions(engine.model) : S_MODELS}
                onChange={(e) => {
                  const model = e.target.value;
                  saveEngine({ model, ...(engine.agent === "codex"
                    ? { effort: coerceCodexEffort(model, engine.effort) } : {}) },
                    "Model lead → " + model);
                }} />
            </SettingRow>
            <SettingRow title="Effort" last
              desc="Putusan lead menuntut membaca bukti — SoT, ADR, plan, kode, riwayat git. Effort rendah memangkas kedalamannya.">
              <Select size="sm" aria-label="Effort lead" value={engine.effort} style={{ width: 130 }}
                options={engine.agent === "codex"
                  ? codexEfforts(engine.model).map((v) => ({ value: v, label: v }))
                  : S_EFFORT}
                onChange={(e) => saveEngine({ effort: e.target.value }, "Effort lead → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>
```

- [ ] **Step 4: Jalankan test — pastikan HIJAU, dan test Settings lama tak retak**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src \
  src/test/settings-lead-engine.test.tsx src/test/settings-conflict.test.tsx \
  src/test/settings-model-tab.test.tsx src/test/settings-agent.test.tsx
```

Expected: semua PASS. Test Settings lama memakai mock `api` **tanpa** `getLeadConfig` — itu aman
justru karena kartu ini tak memanggilnya saat render, hanya saat operator menyimpan.

- [ ] **Step 5: Typecheck paket web**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488 && pnpm --filter ./src typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/settings-lead-engine.test.tsx
git commit -m "feat(488): kartu runtime/model/effort hanoman-lead di Settings → Model sesi"
```

---

### Task 3: `LeadScreen` menyebutkan mesin yang menjalankan lead

Layar tempat operator mengurus lead tak boleh diam soal "lead ini dijalankan siapa". Datanya sudah
ada di `state.config` yang dipoll layar itu — **nol permintaan baru, nol perubahan DTO**.

**Files:**
- Modify: `src/src/screens/LeadScreen.tsx` (`ControlBar`, di dalam blok catatan penutup ~baris 115)
- Modify: `src/test/lead-screen.test.tsx`

**Interfaces:**
- Consumes: `cfg: Lead` yang sudah menjadi prop `ControlBar`.
- Produces: `data-testid="lead-engine-line"`.

- [ ] **Step 1: Tulis test (gagal dulu)**

Tambahkan di akhir `src/test/lead-screen.test.tsx`:

```tsx
// SPEC-488 · mesin yang menjalankan lead disetel di Settings → Model sesi, tapi layar INI yang
// dilihat operator saat mengurus lead. Nilainya sudah ada di `config` yang dipoll — menampilkannya
// tak menambah satu permintaan pun.
describe("SPEC-488 · baris mesin lead", () => {
  it("engine mati → menunjuk ke Settings, bukan diam", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    render(<LeadScreen onToast={() => {}} projects={[] as any} onProjectChanged={async () => {}} />);
    const line = await screen.findByTestId("lead-engine-line");
    expect(line).toHaveTextContent("ikut default global");
    expect(line).toHaveTextContent("Settings");
  });

  it("engine hidup → runtime, model, dan effort tampil apa adanya", async () => {
    getLeadStatus.mockResolvedValue({
      ...STATUS,
      config: { ...CONFIG, engine: { enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "medium" } },
    });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    render(<LeadScreen onToast={() => {}} projects={[] as any} onProjectChanged={async () => {}} />);
    const line = await screen.findByTestId("lead-engine-line");
    expect(line).toHaveTextContent("Codex CLI");
    expect(line).toHaveTextContent("gpt-5.6-terra");
    expect(line).toHaveTextContent("medium");
  });
});
```

**Catatan pemanggilan:** samakan props `<LeadScreen …>` dengan yang sudah dipakai test-test di atas
di berkas yang sama — bila berbeda, salin bentuk pemanggilan yang ada, jangan yang di plan ini.

- [ ] **Step 2: Jalankan — pastikan MERAH**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/lead-screen.test.tsx
```

Expected: 2 FAIL (`Unable to find an element by: [data-testid="lead-engine-line"]`).

- [ ] **Step 3: Tambahkan barisnya di `ControlBar`**

Ganti blok catatan penutup `ControlBar` (`<div … marginTop: 10 }}>Lead memutuskan lalu melapor…`)
menjadi:

```tsx
      {/* SPEC-488 · mesin yang MENJALANKAN lead. Disetel di Settings → Model sesi (satu tempat,
          bersama katalog model kedua agen); ditampilkan di sini karena inilah layar tempat
          operator mengurus lead. `?.` disengaja: dashboard bisa lebih baru daripada server yang
          dilayaninya (paket npm global, ADR-0087) dan server lama tak mengirim blok `engine`. */}
      <div data-testid="lead-engine-line" style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 10 }}>
        mesin: {cfg.engine?.enabled
          ? <>{cfg.engine.agent === "codex" ? "Codex CLI" : "Claude Code"} · <code>{cfg.engine.model}</code> · <code>{cfg.engine.effort}</code></>
          : <>ikut default global · atur di Settings → Model sesi</>}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 6 }}>
        Lead memutuskan lalu melapor. Produksi/VPS dan penghapusan data terkunci secara teknis — apa pun setelannya.
      </div>
```

- [ ] **Step 4: Jalankan — pastikan HIJAU**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/lead-screen.test.tsx
```

Expected: seluruh berkas PASS (test lama + 2 test baru).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/LeadScreen.tsx src/test/lead-screen.test.tsx
git commit -m "feat(488): LeadScreen menyebutkan mesin yang menjalankan lead"
```

---

### Task 4: Docs Source of Truth

**Files:**
- Modify: `internal/docs/architecture/data-model.md` (bullet `lead`, ~baris 227-230)
- Modify: `internal/docs/frontend/frontend-implementation.md` (section baru, pola "Settings → Telegram")
- Modify: `internal/skills/hanoman/SKILL.md` (butir hanoman-lead)

- [ ] **Step 1: `data-model.md` — permukaan operator + alasan penulis kedua**

Pada bullet `lead`, ganti kalimat yang berbunyi *"…dan blok `engine` `{enabled,agent,model,effort}` =
agen yang menjalankan lead — **opt-in seperti `conflict`**: selama `engine.enabled` mati,
`leadAgentDefaults()` mendelegasikan penuh ke `sessionAgentDefaults()`."* menjadi:

```markdown
  dan blok `engine` `{enabled,agent,model,effort}` = agen yang menjalankan lead —
  **opt-in seperti `conflict`**: selama `engine.enabled` mati, `leadAgentDefaults()` mendelegasikan
  penuh ke `sessionAgentDefaults()`. **Permukaan operatornya** (SPEC-488) adalah kartu
  "Agen hanoman-lead" di **Settings → Model sesi**, katalognya sumber yang sama dengan dua kartu di
  atasnya (`MODELS`/`EFFORTS`, `CODEX_MODELS` + `codexEfforts(model)` — effort codex properti
  **per-model**, SPEC-339). Kartu itu menulis lewat **`PUT /lead/config`**, bukan `PUT /settings`
  seperti kartu konflik, dan itu perbedaan sadar: `SettingsScreen` mengirim seluruh objek `Setting`
  dari snapshot yang dimuat **sekali** saat mount, sementara blok `lead` punya **penulis kedua**
  (`LeadScreen` — Pause, denyut, batas waktu, opt-in per project). Menulisnya dari snapshot berarti
  rem darurat yang ditekan di layar Lead **lepas sendiri** saat operator mengganti model di
  Settings. Blok `conflict` tak punya penulis kedua, jadi pola `save()`-nya tetap sah di sana.
  Nilainya dibaca `getSetting()` **tiap panggilan** (tanpa cache) dari dalam `decide()` → ganti
  setelan **berlaku tanpa restart**, dikunci `server/test/lead-engine-argv.test.ts`.
```

- [ ] **Step 2: `frontend-implementation.md` — section baru**

Tambahkan section (letakkan sesudah section "Settings → Telegram …", sebelum section berikutnya):

```markdown
## Settings → Model sesi → Agen hanoman-lead (SPEC-488)

Kartu keempat di tab **Model sesi**, di bawah "Konflik rebase & merge", dengan bentuk yang persis
sama (ADR-0081): `Switch` opt-in → tiga `Select` (Runtime · Model · Effort). Mati → satu baris
`data-testid="lead-engine-inherited"` yang **menyebutkan nilai warisan yang benar-benar berlaku**
(hasil `sessionAgentDefaults()`, dihitung di klien dari `agent`/`model`/`effort`/`codex`) — tanpa
baris itu operator ditinggal bertanya "lalu lead pakai apa?".

Tiga aturan yang mengikat, ketiganya sudah berlaku untuk kartu konflik dan tak boleh menyimpang:
menukar **Runtime** menukar model+effort sekalian ke default runtime itu (kalau tidak lead lahir
`codex -m claude-opus-5`); memilih model codex **mengoersi** effort-nya (`coerceCodexEffort` —
effort properti per-model, SPEC-339); dan katalognya dibaca dari `@hanoman/shared`, sumber yang sama
dengan picker Start.

**Beda satu-satunya dari kartu konflik: jalur tulisnya.** Kartu ini melakukan read-modify-write
bersegar lewat `GET`+`PUT /lead/config`, bukan `save()` (`PUT /settings`). `SettingsScreen`
mengirim seluruh `Setting` dari snapshot yang dimuat sekali saat mount, dan blok `lead` punya
penulis kedua — `LeadScreen`. Menulisnya dari snapshot mengembalikan `paused`/`everyMin` ke nilai
lama: rem darurat yang lepas sendiri. Kegagalan menulis mengembalikan state lokal ke nilai
sebelumnya (pola "jangan pernah biarkan layar memperlihatkan nilai yang tak ada di server").

`LeadScreen` sendiri menampilkan hasilnya sebagai satu baris `data-testid="lead-engine-line"`
(`mesin: Claude Code · claude-opus-5 · xhigh`, atau "ikut default global · atur di Settings → Model
sesi"). Datanya sudah ada di `config` yang dipoll layar itu — **nol permintaan baru, nol perubahan
DTO**; `cfg.engine?.` memakai optional chaining karena dashboard bisa lebih baru daripada server
yang dilayaninya (ADR-0087).
```

- [ ] **Step 3: `SKILL.md` — butir hanoman-lead**

Tambahkan bullet baru tepat sesudah butir `- **hanoman-lead — agen pemimpin di atas agen**` (yang
berakhir dengan "…`services/lead/pane.ts` bias ke DIAM."):

```markdown
- **Runtime/model/effort lead punya permukaan operator** (SPEC-488, tanpa ADR — skema `Setting`
  tak berubah): blok `Setting.lead.engine` `{enabled,agent,model,effort}` ada sejak ADR-0091 dan
  `leadAgentDefaults()` sudah menyalurkannya ke `decide()` → `think()` → `leadArgv()`, tetapi
  sampai spec ini **tak ada satu pun kontrol UI** (`grep "engine" src/src/` → nol) dan **tak ada
  satu pun test** (`lead-decide.test.ts` menyuntik `think` sebagai stub, jadi `brain.ts` maupun
  `leadAgentDefaults()` tak pernah dieksekusi olehnya). Permukaannya kini kartu **"Agen
  hanoman-lead"** di Settings → Model sesi, cermin kartu konflik ADR-0081; `LeadScreen` menampilkan
  hasilnya sebagai satu baris tanpa permintaan baru. **Tiga gotcha:** (1) kartu itu menulis lewat
  **`PUT /lead/config`**, bukan `PUT /settings` — `SettingsScreen` mengirim seluruh `Setting` dari
  snapshot yang dimuat **sekali** saat mount, dan blok `lead` punya **penulis kedua** (`LeadScreen`:
  Pause/denyut/opt-in), jadi menulisnya dari snapshot membuat **rem darurat lepas sendiri**; blok
  `conflict` aman dengan `save()` justru karena tak punya penulis kedua; (2) bukti "setelan dipakai"
  harus dibaca dari **argv proses**, bukan bentuk respons API — fixture `fake-lead-argv.sh` merekam
  argv lalu mencetak putusan json **sah** (`fake-lead-agent.sh` tak pernah mencetak json, jadi
  `decide()` berhenti di parser sebelum membuktikan apa pun; `fake-claude.sh` `exec cat` haram untuk
  agen one-shot, SPEC-448); (3) "tanpa restart" adalah **sifat** `getSetting()` yang tak punya cache
  dan dipanggil di dalam `decide()` — dikunci test yang memanggil `decide()` dua kali dalam satu
  proses dengan baris `Setting` berbeda di antaranya, supaya cache yang kelak ditambahkan orang lain
  memerahkan sesuatu.
```

- [ ] **Step 4: Periksa index docs tetap sinkron**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488 && node cli/dist/index.js docs index --check 2>/dev/null \
  || echo "CLI belum ter-build — index diperiksa manual: tak ada berkas doc BARU di spec ini, jadi internal/docs/README.md tak perlu entri baru."
```

Expected: tak ada berkas doc baru → `internal/docs/README.md` **tidak** berubah. Ketiga berkas yang
disunting sudah ter-link di index.

- [ ] **Step 5: Commit**

```bash
git add internal/docs/architecture/data-model.md internal/docs/frontend/frontend-implementation.md internal/skills/hanoman/SKILL.md
git commit -m "docs(488): permukaan operator runtime/model/effort lead + gotcha penulis kedua"
```

---

### Task 5: Verifikasi akhir — test tersentuh, typecheck, smoke argv nyata

**Files:** tidak ada perubahan kode; hanya verifikasi + commit penutup plan.

- [ ] **Step 1: Test yang tersentuh saja**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --dir server --no-file-parallelism \
  server/test/lead-engine-argv.test.ts server/test/lead-brain.test.ts server/test/lead-decide.test.ts
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src \
  src/test/settings-lead-engine.test.tsx src/test/lead-screen.test.tsx \
  src/test/settings-conflict.test.tsx src/test/settings-model-tab.test.tsx src/test/settings-agent.test.tsx
```

Expected: semua PASS, dan **jumlah test yang berjalan bukan nol** (`--changed` menyalakan
`passWithNoTests`; di sini path disebut eksplisit justru untuk menghindari "no test files" yang
terlihat hijau).

- [ ] **Step 2: Typecheck paket tersentuh saja**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: exit 0 keduanya. **Jangan** `pnpm -r typecheck` (ADR-0080 — mesin ini menjalankan
beberapa sesi sekaligus).

- [ ] **Step 3: Smoke nyata — argv proses lead dari endpoint sungguhan**

Task ini menyentuh endpoint (`PUT /lead/config`, `POST /lead/decisions`), jadi ia diuji nyata sekali
di akhir. DB **khusus** dan `DATABASE_URL` **eksplisit**: profil shell mesin ini menyetel
`DATABASE_URL`/`HANOMAN_HOME` yang menunjuk DB nyata, dan smoke tak boleh menyentuhnya.

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
SMOKE=$(mktemp -d)
export DATABASE_URL="file:$SMOKE/smoke.db" HANOMAN_HOME="$SMOKE"
export HANOMAN_LEAD_ARGV_FILE="$SMOKE/argv.txt"
export HANOMAN_CLAUDE_BIN="$PWD/server/test/fixtures/fake-lead-argv.sh"
export PORT=8891
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server build && node server/dist/server.js &   # catat PID-nya
```

Lalu (dengan token/sesi sesuai cara auth instance lokal — lihat `server/test/*routes*.test.ts` untuk
bentuk header yang dipakai):

```bash
# 1. project opt-in lead + master switch + engine
curl -s -X PUT localhost:8891/api/lead/config -H 'content-type: application/json' \
  -d '{"enabled":true,"paused":false,"pausedProjects":[],"everyMin":5,"timeoutSec":60,
       "maxAutoAnswers":3,"maxConcurrent":2,"queueWaitSec":120,"flowTtlMin":60,
       "requireGreenBeforeIntegrate":true,
       "engine":{"enabled":true,"agent":"claude","model":"claude-sonnet-5","effort":"low"}}'
# 2. minta satu putusan
curl -s -X POST localhost:8891/api/lead/decisions -H 'content-type: application/json' \
  -d '{"projectId":"<id project opt-in>","gate":"contract","kind":"answer","question":"Lanjut?"}'
# 3. BUKTI — argv proses lead yang sungguhan
cat "$HANOMAN_LEAD_ARGV_FILE"
```

Expected pada langkah 3: baris `-p`, `--model`, `claude-sonnet-5`, `--effort`, `low`,
`--dangerously-skip-permissions`. Bila `--model` berbunyi `claude-opus-5`, setelan **tidak**
sampai — hentikan dan perbaiki sebelum melanjutkan.

Bereskan: `kill <PID server>` (per-PID; **jangan** `pkill -f node` — pola itu mencocoki agen sesi
lain di mesin ini, SPEC-402).

- [ ] **Step 4: Centang seluruh checklist plan ini**

Pastikan tak ada `- [ ]` tersisa di berkas ini (hanoman menahan backlog di `executing` selama masih
ada kotak kosong).

- [ ] **Step 5: Commit penutup + push**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-488
git add docs/superpowers/plans/2026-08-01-setting-runtime-model-effort-lead-spec-488.md
git commit -m "chore(488): centang plan + catatan pelaksanaan"
git push origin HEAD:refs/heads/hanoman/spec-488
```

---

## Self-Review

**Spec coverage:**

| Bagian design | Task |
|---|---|
| §D1 kartu di Settings → Model sesi, katalog per runtime, koersi effort | Task 2 |
| §D2 tulis lewat `PUT /lead/config` (read-modify-write bersegar) | Task 2 (test "field lead lain datang dari GET segar") |
| §D3 baris mesin di LeadScreen | Task 3 |
| §D4 bukti argv tiga lapis (resolver · argv end-to-end · smoke) | Task 1 (lapis 1-2), Task 5 Step 3 (lapis 3) |
| §D5 tanpa restart, dikunci test | Task 1, test "setelan diganti di tengah proses yang sama" |
| §6 docs tersentuh + index | Task 4 |
| §7 jebakan (`?? LEAD_DEFAULTS`, mock api lama, fixture keluar sendiri, DB smoke khusus) | Task 2 Step 3/4, Task 1 Step 1, Task 5 Step 3 |

**Placeholder scan:** tak ada TBD/TODO; setiap langkah membawa kode atau perintah lengkap.

**Type consistency:** `saveEngine(patch: Partial<Setting["lead"]["engine"]>, msg: string)` dipakai
konsisten di keempat handler kartu; `engine`/`lead`/`inherited`/`codexOptions`/`codexNote`/
`AGENT_LABEL`/`S_MODELS`/`S_EFFORT` semuanya nama yang **sudah ada** di blok `tab === "model"`
`SettingsScreen.tsx`; `data-testid` (`lead-engine-inherited`, `lead-engine-line`) dan `aria-label`
(`Override agen lead`, `Runtime lead`, `Model lead`, `Effort lead`) identik antara test dan
implementasi.
