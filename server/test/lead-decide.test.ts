import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Lead } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { decide, takeReply, type DecideDeps } from "../src/services/lead/decide";

// SPEC-409 · ADR-0091 · satu otak, tiga pintu. Semua deps disuntik: nol tmux, nol git, nol agen.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
});
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });

type Notif = { id: string; title: string };
function deps(raw: string | Error, notes: Notif[] = []): DecideDeps {
  return {
    think: async () => { if (raw instanceof Error) throw raw; return raw; },
    defaults: async () => ({ agent: "claude", model: "claude-opus-5", effort: "xhigh" }),
    repoDir: async () => null,
    liveSessions: () => [],
    notify: async (id, title) => { notes.push({ id, title }); },
  };
}
const block = (o: Record<string, unknown>) => "```json\n" + JSON.stringify(o) + "\n```";
const ask = { projectId: "demo", gate: "contract", kind: "answer", question: "Pakai kolom baru atau turunkan?" } as const;

describe("decide · gerbang aktif (AC-15/AC-30)", () => {
  it("returns null while the master switch is off — hanoman apa adanya", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: false });
    expect(await decide({ ...ask }, deps(block({ decision: "a", reason: "b" })))).toBeNull();
  });
  it("returns null while lead is paused globally", async () => {
    await setLead(cfg({ paused: true }));
    expect(await decide({ ...ask }, deps(block({ decision: "a", reason: "b" })))).toBeNull();
  });
  it("returns null while lead is paused for THIS project only", async () => {
    await setLead(cfg({ pausedProjects: ["demo"] }));
    expect(await decide({ ...ask }, deps(block({ decision: "a", reason: "b" })))).toBeNull();
    await setLead(cfg({ pausedProjects: ["lain"] }));
    expect(await decide({ ...ask }, deps(block({ decision: "a", reason: "b" })))).not.toBeNull();
  });
});

describe("decide · jejak & notifikasi (AC-2/23/25)", () => {
  beforeEach(() => setLead(cfg()));

  it("writes exactly one trail row carrying question, answer, reason and confidence", async () => {
    const row = await decide({ ...ask }, deps(block({
      decision: "kolom baru", reason: "waktu lahir tak bisa dihitung ulang", confidence: "tinggi",
    })));
    expect(row?.status).toBe("berlaku");
    const rows = await prisma.leadDecision.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: "demo", gate: "contract", kind: "answer",
      question: ask.question, answer: "kolom baru", confidence: "tinggi", actor: "lead",
    });
  });
  it("stays quiet for an ordinary confident answer", async () => {
    const notes: Notif[] = [];
    await decide({ ...ask }, deps(block({ decision: "a", reason: "b", confidence: "tinggi" }), notes));
    expect(notes).toEqual([]);
  });
  // AC-21: keraguan tak boleh jadi mandek — lead TETAP memutuskan, tapi operator diberi tahu.
  it("still decides when unsure, marks it ragu, and notifies", async () => {
    const notes: Notif[] = [];
    const row = await decide({ ...ask }, deps(block({
      decision: "pilih yang paling mudah dibatalkan", reason: "bukti tak konklusif", confidence: "ragu",
    }), notes));
    expect(row?.answer).toBe("pilih yang paling mudah dibatalkan");
    expect(row?.status).toBe("berlaku");
    expect(row?.weighty).toBe(true);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toContain("ragu");
  });
});

describe("decide · rujukan (AC-6)", () => {
  beforeEach(() => setLead(cfg()));
  it("drops refs that cannot be proven to exist", async () => {
    const row = await decide({ ...ask }, deps(block({
      decision: "a", reason: "b", refs: ["internal/docs/README.md", "ADR-0091"],
    })));
    // repoDir null di test ini → hanya rujukan non-berkas yang bertahan.
    expect(row!.refs).toEqual(["ADR-0091"]);
  });
});

describe("decide · batas keras (AC-31/32/33)", () => {
  beforeEach(() => setLead(cfg()));
  it("refuses a locked action, records the refusal, and notifies", async () => {
    const notes: Notif[] = [];
    const row = await decide({ ...ask }, deps(block({
      decision: "deploy dulu ke VPS", reason: "biar cepat", action: "deploy",
    }), notes));
    expect(row!.kind).toBe("refusal");
    expect(row!.action).toBe("none");          // tak pernah tersimpan sebagai tindakan yang sah
    expect(row!.reason).toContain("DITOLAK");
    expect(row!.reason).toContain("produksi");
    expect(notes).toHaveLength(1);
  });
  it("refuses deletion of the decision trail itself", async () => {
    const row = await decide({ ...ask }, deps(block({
      decision: "bersihkan jejak lama", reason: "kepenuhan", action: "delete-decision",
    })));
    expect(row!.kind).toBe("refusal");
    expect(row!.action).toBe("none");
  });
  it("keeps an allowed action as-is", async () => {
    const row = await decide({ ...ask }, deps(block({
      decision: "lanjutkan saja", reason: "worktree masih sah", action: "resume-session",
    })));
    expect(row!.kind).toBe("answer");
    expect(row!.action).toBe("resume-session");
  });
});

describe("decide · gagal (AC-4)", () => {
  beforeEach(() => setLead(cfg()));
  // Diam bukan pilihan: "tak ada baris" tak bisa dibedakan dari "tak pernah diminta".
  it("records a `gagal` row and notifies when the agent times out", async () => {
    const notes: Notif[] = [];
    const row = await decide({ ...ask }, deps(new Error("lead claude kehabisan waktu 120000 ms"), notes));
    expect(row!.status).toBe("gagal");
    expect(row!.answer).toBe("");
    expect(row!.reason).toContain("kehabisan waktu");
    expect(notes[0]!.title).toContain("gagal memutuskan");
  });
  it("records a `gagal` row when the output has no readable json block", async () => {
    const row = await decide({ ...ask }, deps("saya tidak yakin, tolong putuskan sendiri"));
    expect(row!.status).toBe("gagal");
    expect(row!.reason).toContain("blok json");
  });
});

describe("decide · balasan untuk pane", () => {
  beforeEach(() => setLead(cfg()));
  it("hands over `reply` once and then forgets it", async () => {
    const row = await decide({ ...ask, sessionId: "s1" }, deps(block({
      decision: "opsi 1", reason: "b", reply: "1",
    })));
    expect(takeReply(row!.id)).toBe("1");
    expect(takeReply(row!.id)).toBe("");
  });
  it("falls back to the decision text when the agent leaves `reply` empty", async () => {
    const row = await decide({ ...ask, sessionId: "s1" }, deps(block({ decision: "opsi 1", reason: "b" })));
    expect(takeReply(row!.id)).toBe("opsi 1");
  });
});
