import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// SPEC-409 · ADR-0091 · panel hanoman-lead. Layar ini adalah SATU-SATUNYA tempat operator melihat
// apa yang diputuskan mesin atas namanya — jadi yang diuji di sini: jejaknya terbaca (pertanyaan →
// jawaban → alasan → rujukan), rem daruratnya benar-benar menulis knob, dan Timpa memanggil
// endpoint override (bukan sekadar menutup formulirnya).

const {
  getLeadStatus, getLeadDecisions, putLeadConfig, overrideLeadDecision, cancelLeadDecision, updateProject,
  getLeadFlows, submitLeadFlow, cancelLeadFlow,
} = vi.hoisted(() => ({
  getLeadStatus: vi.fn(), getLeadDecisions: vi.fn(), putLeadConfig: vi.fn(),
  overrideLeadDecision: vi.fn(), cancelLeadDecision: vi.fn(), updateProject: vi.fn(),
  // SPEC-485 · ADR-0102 · rantai keputusan; `mockResolvedValue` default supaya test lama tak perlu
  // tahu apa-apa tentangnya.
  getLeadFlows: vi.fn().mockResolvedValue({ items: [] }),
  submitLeadFlow: vi.fn(), cancelLeadFlow: vi.fn(),
}));
vi.mock("../src/api/client", () => ({
  api: {
    getLeadStatus, getLeadDecisions, putLeadConfig, overrideLeadDecision, cancelLeadDecision, updateProject,
    getLeadFlows, submitLeadFlow, cancelLeadFlow,
  },
  ApiError: class extends Error {},
}));

import { LeadScreen } from "../src/screens/LeadScreen";

const CONFIG = {
  enabled: true, paused: false, pausedProjects: [], everyMin: 5, timeoutSec: 120,
  maxAutoAnswers: 3, requireGreenBeforeIntegrate: true,
  engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
};
const STATUS = {
  config: CONFIG,
  projects: [{ projectId: "a", name: "Alpha", optIn: true, paused: false, decisions24h: 4, openSessions: 1 }],
  queue: [], deciding: ["spec-9"], waiting: ["spec-9", "spec-8"],
  lastPulseAt: "2026-07-31T00:00:00.000Z",
};
const DECISIONS = {
  items: [
    { id: "d1", projectId: "a", specId: "SPEC-1", sessionId: "spec-1",
      gate: "detected", kind: "answer", question: "Pakai kolom baru atau turunkan dari updatedAt?",
      answer: "Kolom baru.", reason: "Waktu lahir sebuah baris tak bisa dihitung ulang.",
      refs: ["ADR-0090", "internal/docs/architecture/data-model.md"],
      confidence: "tinggi", action: "none", status: "berlaku", weighty: false,
      choice: null, choiceIndex: null, options: [], missing: [],
      supersededById: null, createdAt: "2026-07-31T00:00:00.000Z" },
    // SPEC-480 · `d2` sengaja DIBIARKAN tanpa keempat field baru: dashboard bisa lebih baru
    // daripada server yang dilayaninya (paket npm global, ADR-0087), dan baris berbentuk lama
    // tak boleh meruntuhkan panelnya.
    { id: "d2", projectId: "a", specId: null, sessionId: null,
      gate: "pulse", kind: "refusal", question: "Deploy sekarang?", answer: "Tidak.",
      reason: "DITOLAK: deploy ke produksi berada di luar permukaan tindakan lead.",
      refs: [], confidence: "ragu", action: "none", status: "berlaku", weighty: true,
      supersededById: null, createdAt: "2026-07-31T00:00:00.000Z" },
  ],
};
const projects = [{ id: "a", name: "Alpha", leadOptIn: true }] as unknown as Parameters<typeof LeadScreen>[0]["projects"];

function renderScreen(over: Partial<Parameters<typeof LeadScreen>[0]> = {}) {
  return render(<LeadScreen projects={projects} onProjectChanged={vi.fn()}
    onToast={vi.fn()} onGotoTerminal={vi.fn()} {...over} />);
}

describe("LeadScreen · jejak keputusan (AC-23/24, US-2)", () => {
  it("shows question, answer, reason and the refs lead actually used", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText(/Pakai kolom baru atau turunkan/)).toBeInTheDocument();
    expect(screen.getByText("Kolom baru.")).toBeInTheDocument();
    expect(screen.getByText(/tak bisa dihitung ulang/)).toBeInTheDocument();
    expect(screen.getByText("ADR-0090")).toBeInTheDocument();
    expect(screen.getByText("internal/docs/architecture/data-model.md")).toBeInTheDocument();
  });
  it("marks a doubtful, weighty refusal so it stands out", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText("berbobot")).toBeInTheDocument();
    expect(screen.getByText("ragu")).toBeInTheDocument();
    expect(screen.getByText("tindakan ditolak")).toBeInTheDocument();
  });
  // AC-3 · sesi yang sedang DISUSUN keputusannya tak boleh terbaca sebagai sesi mandek.
  it("separates 'sedang diputuskan' from plain 'menunggu'", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText("sedang diputuskan")).toBeInTheDocument();
    expect(screen.getByText("menunggu")).toBeInTheDocument();
  });

  // SPEC-479 (QA) · keadaan KETIGA. Di pane, "menunggu manusia", "sedang diputuskan", dan
  // "menunggu giliran" terlihat persis sama — marker terisi, agen diam — tapi hanya yang pertama
  // butuh manusia. Batas konkurensi yang tak terlihat terbaca sebagai "lead diam", dan salah baca
  // itulah yang melahirkan tiket ini.
  it("membedakan sesi yang mengantre slot dari sesi yang menunggu manusia", async () => {
    getLeadStatus.mockResolvedValue({
      ...STATUS,
      deciding: ["spec-9"], queued: ["spec-8"], waiting: ["spec-9", "spec-8"],
      gate: { inFlight: 1, queued: 1, capacity: 2 },
    });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText("sedang diputuskan")).toBeInTheDocument();
    expect(screen.getByText("antre")).toBeInTheDocument();
    expect(screen.queryByText("menunggu")).not.toBeInTheDocument();
  });

  it("menyebut batas konkurensi saat gerbangnya sedang mengikat", async () => {
    getLeadStatus.mockResolvedValue({
      ...STATUS, deciding: ["spec-9"], queued: ["spec-8"],
      gate: { inFlight: 2, queued: 3, capacity: 2 },
    });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText(/2\/2 diputuskan · 3 antre/)).toBeInTheDocument();
  });
});

describe("LeadScreen · kendali manusia (AC-27/28, US-3/4)", () => {
  it("Pause writes paused:true through the config endpoint", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    putLeadConfig.mockResolvedValue(CONFIG);
    renderScreen();
    // Ada DUA tombol "Pause" di layar ini — rem global (paling atas) dan rem per project.
    // Yang pertama adalah rem global; keduanya sengaja diuji terpisah.
    const btn = (await screen.findAllByRole("button", { name: /^pause$/i }))[0]!;
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(putLeadConfig).toHaveBeenCalledWith(expect.objectContaining({ paused: true })));
  });
  it("overriding a decision sends the operator answer to the server", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    overrideLeadDecision.mockResolvedValue({ old: DECISIONS.items[0], next: DECISIONS.items[0], delivered: true });
    renderScreen();
    const btn = (await screen.findAllByRole("button", { name: /timpa/i }))[0]!;
    await act(async () => { fireEvent.click(btn); });
    const input = screen.getByLabelText("jawaban operator untuk d1");
    await act(async () => { fireEvent.change(input, { target: { value: "turunkan saja" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /simpan/i })); });
    // SPEC-485 · tanda tangannya kini `(id, answer, reason, choices)` — centang operator adalah DATA.
    await waitFor(() => expect(overrideLeadDecision).toHaveBeenCalledWith("d1", "turunkan saja", "", []));
  });
  it("cancelling a decision calls the cancel endpoint", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    cancelLeadDecision.mockResolvedValue(DECISIONS.items[0]);
    renderScreen();
    const btn = (await screen.findAllByRole("button", { name: /batalkan/i }))[0]!;
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(cancelLeadDecision).toHaveBeenCalledWith("d1"));
  });
  it("per-project pause writes the project into pausedProjects (AC-15)", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    putLeadConfig.mockResolvedValue(CONFIG);
    renderScreen();
    const buttons = await screen.findAllByRole("button", { name: /^pause$/i });
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]!); });
    await waitFor(() => expect(putLeadConfig).toHaveBeenCalledWith(expect.objectContaining({ pausedProjects: ["a"] })));
  });
  it("opting a project out goes through PATCH /projects/:id", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    updateProject.mockResolvedValue({});
    renderScreen();
    const btn = await screen.findByRole("button", { name: /lepas/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("a", { leadOptIn: false }));
  });
});

describe("LeadScreen · keadaan kosong", () => {
  it("says so plainly when lead has not decided anything yet", async () => {
    getLeadStatus.mockResolvedValue({ ...STATUS, deciding: [], waiting: [] });
    getLeadDecisions.mockResolvedValue({ items: [] });
    renderScreen();
    expect(await screen.findByText(/Belum ada keputusan/)).toBeInTheDocument();
    expect(screen.getByText(/Tak ada sesi yang menunggu keputusan/)).toBeInTheDocument();
  });
});

// SPEC-480 · ADR-0098 · operator harus bisa membaca "opsi mana yang dipilih" tanpa mengurai prosa
// — persis kemampuan yang dituntut peminta mesin, di permukaan yang dilihat manusia.
describe("LeadScreen · pilihan terstruktur (SPEC-480)", () => {
  const row = (over: Record<string, unknown>) => ({
    ...DECISIONS.items[0], id: "d9",
    choice: null, choiceIndex: null, options: [], missing: [], ...over,
  });

  it("shows which option was chosen, out of how many", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [row({
      choice: "Node 22", choiceIndex: 2, options: ["Node 20 LTS", "Node 22"],
    })] });
    renderScreen();
    expect(await screen.findByText("opsi 2/2")).toBeInTheDocument();
    expect(screen.getByText("Node 22")).toBeInTheDocument();
  });

  it("shows what lead said was missing", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [row({ missing: ["versi Node produksi"] })] });
    renderScreen();
    expect(await screen.findByText("kurang konteks")).toBeInTheDocument();
    expect(screen.getByText(/versi Node produksi/)).toBeInTheDocument();
  });

  // Baris tanpa opsi (jawaban bebas, denyut tanpa menu) tak boleh menumbuhkan badge kosong.
  it("stays quiet when there was no menu at all", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [row({})] });
    renderScreen();
    expect(await screen.findByText("Kolom baru.")).toBeInTheDocument();
    expect(screen.queryByText(/^opsi \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("kurang konteks")).not.toBeInTheDocument();
  });
});

// SPEC-485 · ADR-0102 · pilihan jamak & rantai di dashboard.
const OPT_ROW = {
  id: "d3", projectId: "a", specId: null, sessionId: "spec-3",
  gate: "contract", kind: "answer", question: "Paket mana?", answer: "beta & gamma",
  reason: "keduanya dipakai.", refs: [], confidence: "tinggi", action: "none",
  status: "berlaku", weighty: false, supersededById: null,
  choice: "beta", choiceIndex: 2, options: ["alpha", "beta", "gamma"], missing: [],
  choices: [{ index: 2, option: "beta" }, { index: 3, option: "gamma" }],
  select: { mode: "multi", min: 1, max: 3 }, flowId: "f1", step: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
};
const flow = (over: Record<string, unknown> = {}) => ({
  id: "f1", projectId: "a", specId: null, sessionId: null, gate: "contract",
  status: "sebagian", title: "Paket mana?", steps: 2, closeReason: null,
  openedAt: "2026-08-01T00:00:00.000Z", closedAt: null, expiresAt: "2026-08-01T01:00:00.000Z",
  ...over,
});

describe("LeadScreen · pilihan jamak & rantai (SPEC-485)", () => {
  const boot = (rows: unknown[], flows: unknown[] = []) => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: rows });
    getLeadFlows.mockResolvedValue({ items: flows });
  };

  it("menampilkan SEMUA label terpilih, bukan hanya yang pertama", async () => {
    boot([OPT_ROW]);
    renderScreen();
    expect(await screen.findByText(/beta · gamma/)).toBeInTheDocument();
    expect(screen.getByText("2 dari 3 opsi")).toBeInTheDocument();
  });

  it("Timpa menampilkan CHECKBOX saat pilihannya jamak, dan mengirim semua yang dicentang", async () => {
    boot([OPT_ROW]);
    overrideLeadDecision.mockResolvedValue({ old: OPT_ROW, next: OPT_ROW, delivered: true });
    renderScreen();
    const timpa = (await screen.findAllByRole("button", { name: /timpa/i }))[0]!;
    await act(async () => { fireEvent.click(timpa); });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await act(async () => { fireEvent.click(boxes[0]!); });
    await act(async () => { fireEvent.click(boxes[2]!); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /simpan/i })); });
    await waitFor(() => expect(overrideLeadDecision)
      .toHaveBeenCalledWith("d3", expect.any(String), "", ["alpha", "gamma"]));
  });

  it("Timpa menampilkan RADIO saat pilihannya tunggal, dan hanya satu yang bertahan", async () => {
    boot([{ ...OPT_ROW, select: { mode: "single", min: 0, max: 1 },
      choices: [{ index: 2, option: "beta" }] }]);
    overrideLeadDecision.mockResolvedValue({ old: OPT_ROW, next: OPT_ROW, delivered: true });
    renderScreen();
    const timpa = (await screen.findAllByRole("button", { name: /timpa/i }))[0]!;
    await act(async () => { fireEvent.click(timpa); });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    await act(async () => { fireEvent.click(radios[0]!); });
    await act(async () => { fireEvent.click(radios[2]!); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /simpan/i })); });
    await waitFor(() => expect(overrideLeadDecision)
      .toHaveBeenCalledWith("d3", expect.any(String), "", ["gamma"]));
  });

  it("kartu rantai merender status & tombol hanya untuk alur yang masih terbuka", async () => {
    boot([], [flow(), flow({ id: "f2", status: "selesai", title: "Versi mana?", closeReason: "submit" })]);
    renderScreen();
    expect(await screen.findByText("sebagian")).toBeInTheDocument();
    expect(screen.getByText("selesai")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^submit$/i })).toHaveLength(1);
  });

  it("Submit rantai memanggil endpointnya", async () => {
    boot([], [flow()]);
    submitLeadFlow.mockResolvedValue(flow({ status: "selesai" }));
    renderScreen();
    const btn = await screen.findByRole("button", { name: /^submit$/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(submitLeadFlow).toHaveBeenCalledWith("f1"));
  });

  // Dashboard bisa lebih baru daripada server yang dilayaninya (paket npm global, ADR-0087).
  it("respons server lama (tanpa `choices`/`select`/`flows`) tak meruntuhkan panel", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    getLeadFlows.mockResolvedValue({});
    renderScreen();
    expect(await screen.findByText(/Pakai kolom baru atau turunkan/)).toBeInTheDocument();
  });
});

// SPEC-488 · mesin yang menjalankan lead disetel di Settings → Model sesi, tapi layar INI yang
// dilihat operator saat mengurus lead. Nilainya sudah ada di `config` yang dipoll — menampilkannya
// tak menambah satu permintaan pun.
describe("SPEC-488 · baris mesin lead", () => {
  it("engine mati → menunjuk ke Settings, bukan diam", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
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
    renderScreen();
    const line = await screen.findByTestId("lead-engine-line");
    expect(line).toHaveTextContent("Codex CLI");
    expect(line).toHaveTextContent("gpt-5.6-terra");
    expect(line).toHaveTextContent("medium");
  });

  // Server lama tak mengirim blok `engine` sama sekali — barisnya harus tetap terbaca, bukan
  // meruntuhkan panel dengan `undefined.enabled` (ADR-0087).
  it("config tanpa blok engine → jatuh ke kalimat warisan", async () => {
    const { engine: _drop, ...noEngine } = CONFIG as Record<string, unknown>;
    getLeadStatus.mockResolvedValue({ ...STATUS, config: noEngine });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByTestId("lead-engine-line")).toHaveTextContent("ikut default global");
  });
});
