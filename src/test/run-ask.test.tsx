import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const runAnswer = vi.fn(async (_id: string, _value: string) => ({ accepted: true }));

vi.mock("../src/api/client", () => ({
  api: {
    runAnswer: (id: string, value: string) => runAnswer(id, value),
    runControl: vi.fn(async () => ({ accepted: true })),
    runCommand: vi.fn(async () => ({ lines: [] })),
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import { RunsScreen } from "../src/screens/RunsScreen";

const ASK = {
  question: '"Orang" di sini siapa?',
  options: [
    { value: "pasien", label: "Pasien", detail: "Satu item katalog dibeli untuk >1 pasien." },
    { value: "pembayar", label: "Pembayar" },
  ],
  default: "pasien",
};
const RUN = {
  id: "RUN-1", projectId: "arta", specId: "SPEC-156", kind: "feature", status: "awaiting",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], log: [],
  worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
  baseSha: null, headSha: null, model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0,
  createdAt: "2026-07-10T00:00:00.000Z", finishedAt: null, pendingAsk: ASK,
  project: "arta", spec: "SPEC-156", title: "Multiple Invoice", phase: null,
};

describe("tombol keputusan untuk run awaiting (SPEC-157)", () => {
  beforeEach(() => runAnswer.mockClear());

  it("menampilkan pertanyaan, label, dan detail", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    expect(screen.getByText(ASK.question)).toBeTruthy();
    expect(screen.getByText("Pasien")).toBeTruthy();
    expect(screen.getByText("Pembayar")).toBeTruthy();
    expect(screen.getByText(/Satu item katalog/)).toBeTruthy();
  });

  it("klik tombol mengirim value-nya, bukan label-nya", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    fireEvent.click(screen.getByText("Pembayar"));
    expect(runAnswer).toHaveBeenCalledWith("RUN-1", "pembayar");
  });

  // Teks bebas tidak menjawab: pesan steer baru dikuras SETELAH fase selesai, padahal fase
  // itu sedang diblokir menunggu. Kotak yang tampak bekerja tapi diam = jebakan.
  it("menyembunyikan kotak steer dan tombol Resume saat awaiting", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    expect(screen.queryByPlaceholderText(/ketik perintah/)).toBeNull();
    expect(screen.queryByText("Resume")).toBeNull();
    expect(screen.getByText("Stop")).toBeTruthy();
  });

  it("run running tidak menampilkan tombol keputusan, dan kotak steer kembali", () => {
    render(<RunsScreen runs={[{ ...RUN, status: "running", pendingAsk: null }] as never[]} />);
    expect(screen.queryByText(ASK.question)).toBeNull();
    expect(screen.getByPlaceholderText(/ketik perintah/)).toBeTruthy();
  });

  // Run awaiting = proses claude HIDUP. Kartunya tidak boleh tampak beku seperti run selesai.
  it("run awaiting tidak menampilkan tombol Retry", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    expect(screen.queryByText("Retry")).toBeNull();
  });
});

// Run yang di-stop/gagal saat menunggu MENYIMPAN pertanyaannya (bug RUN-90012). Kalau UI
// menyembunyikannya, satu-satunya jejak keputusan yang tertunda itu lenyap dari layar dan
// operator tidak punya cara tahu run itu berhenti karena butuh dia.
describe("pertanyaan tertunda pada run yang tidak lagi awaiting (SPEC-157)", () => {
  beforeEach(() => runAnswer.mockClear());
  const stopped = { ...RUN, status: "stopped", finishedAt: "2026-07-10T00:05:00.000Z" };

  it("tetap menampilkan pertanyaannya pada run stopped", () => {
    render(<RunsScreen runs={[stopped] as never[]} />);
    expect(screen.getByText(ASK.question)).toBeTruthy();
    expect(screen.getByText(/belum terjawab/i)).toBeTruthy();
  });

  it("tombolnya mati — tak ada proses yang mendengarkan jawabannya", () => {
    render(<RunsScreen runs={[stopped] as never[]} />);
    fireEvent.click(screen.getByText("Pembayar"));
    expect(runAnswer).not.toHaveBeenCalled();
  });

  it("menawarkan Retry supaya run menanyakannya ulang", () => {
    render(<RunsScreen runs={[stopped] as never[]} />);
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("run failed dengan pertanyaan tertunda juga menampilkannya", () => {
    render(<RunsScreen runs={[{ ...stopped, status: "failed" }] as never[]} />);
    expect(screen.getByText(ASK.question)).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("run selesai tanpa pertanyaan tertunda tidak menampilkan kartunya", () => {
    render(<RunsScreen runs={[{ ...stopped, status: "done", pendingAsk: null }] as never[]} />);
    expect(screen.queryByText(ASK.question)).toBeNull();
  });
});
