import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Lead } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { decide, takeDelivery, type DecideDeps } from "../src/services/lead/decide";
import { LeadBusyError, leadGateStats, __resetLeadGate } from "../src/services/lead/gate";
import { decidingIds, queuedIds, __resetDeciding } from "../src/services/lead/deciding";

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
  __resetLeadGate(); __resetDeciding();
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

  // SPEC-432 · di panel notifikasi operator, KETUJUH notifikasi lead yang pernah terbit berbunyi
  // "Lead gagal memutuskan" — kegagalan yang sama, berulang. Kegagalan beruntun bukan kabar baru:
  // yang pertama sudah memberi tahu bahwa lead rusak, sisanya cuma mengubur notifikasi lain.
  // Baris jejaknya TETAP ditulis setiap kali (AC-4: "tak ada baris" tak bisa dibedakan dari
  // "tak pernah diminta") — yang di-dedupe hanya notifikasinya.
  it("writes every failed row but does not notify twice in a row", async () => {
    const notes: Notif[] = [];
    await decide({ ...ask }, deps(new Error("kehabisan waktu 600000 ms"), notes));
    await decide({ ...ask, question: "Ada 27 backlog siap dikerjakan. Urutkan." },
      deps(new Error("kehabisan waktu 600000 ms"), notes));
    expect(await prisma.leadDecision.count({ where: { status: "gagal" } })).toBe(2);
    expect(notes).toHaveLength(1);
  });

  // Sesudah lead terbukti pulih, kegagalan berikutnya kabar baru lagi.
  it("notifies again once a decision in between actually succeeded", async () => {
    const notes: Notif[] = [];
    await decide({ ...ask }, deps(new Error("kehabisan waktu 600000 ms"), notes));
    await decide({ ...ask }, deps(block({ decision: "a", reason: "b", confidence: "tinggi" }), notes));
    await decide({ ...ask }, deps(new Error("kehabisan waktu 600000 ms"), notes));
    expect(notes.filter((n) => n.title.includes("gagal memutuskan"))).toHaveLength(2);
  });

  // Dedup-nya per (project, pintu, jenis): kegagalan di pintu lain tetap dilaporkan.
  it("still notifies a failure coming from a different door", async () => {
    const notes: Notif[] = [];
    await decide({ ...ask }, deps(new Error("kehabisan waktu 600000 ms"), notes));
    await decide({ ...ask, gate: "pulse", kind: "order" }, deps(new Error("kehabisan waktu 600000 ms"), notes));
    expect(notes).toHaveLength(2);
  });
});

// SPEC-432 · anggaran waktu yang disebut prompt HARUS angka yang benar-benar berlaku: agen yang
// diberi tahu satu angka lalu dibunuh di angka lain akan menganggarkan pembacaannya ke arah yang
// salah — persis kegagalan 7/7 yang tercatat di jejak operator.
describe("decide · anggaran waktu sampai ke agen (audit SPEC-432)", () => {
  it("tells the agent the same budget it will actually be killed at", async () => {
    await setLead(cfg({ timeoutSec: 300 }));
    let seen = { prompt: "", timeoutMs: 0 };
    const out = block({ decision: "a", reason: "b" });
    await decide({ ...ask }, {
      ...deps(out),
      think: async (prompt, o) => { seen = { prompt, timeoutMs: o.timeoutMs }; return out; },
    });
    expect(seen.timeoutMs).toBe(300_000);
    expect(seen.prompt).toContain("300 detik");
  });
});

// SPEC-479 (QA) · `decide()` adalah choke point tunggal ketiga pintu (ADR-0091 G6), jadi gerbang
// konkurensinya duduk di sini — bukan disalin ke tiap pintu (kelas bug SPEC-431/448/475).
describe("decide · gerbang konkurensi (SPEC-479)", () => {
  beforeEach(() => setLead(cfg({ maxConcurrent: 2 })));

  it("tak pernah memanggil agen lebih dari maxConcurrent sekaligus", async () => {
    let inFlight = 0, max = 0;
    const slow: DecideDeps = {
      ...deps(block({ decision: "a", reason: "b" })),
      think: async () => {
        inFlight++; max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
        return block({ decision: "a", reason: "b" });
      },
    };
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      decide({ ...ask, sessionId: `s${i}` }, slow)));
    expect(max).toBe(2);
  });

  it("melempar LeadBusyError — BUKAN baris `gagal` — saat antreannya kehabisan waktu", async () => {
    await setLead(cfg({ maxConcurrent: 1, queueWaitSec: 0 }));
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const holder: DecideDeps = {
      ...deps(block({ decision: "a", reason: "b" })),
      think: async () => { await held; return block({ decision: "a", reason: "b" }); },
    };
    const first = decide({ ...ask, sessionId: "s1" }, holder);
    await new Promise((r) => setTimeout(r, 5));

    await expect(decide({ ...ask, sessionId: "s2" }, holder)).rejects.toBeInstanceOf(LeadBusyError);
    // Inti temuan C: penolakan karena penuh BUKAN percobaan yang gagal, jadi ia tak boleh
    // meninggalkan jejak `gagal` yang nanti dihitung pagar SPEC-472 sebagai sebab permanen.
    expect(await prisma.leadDecision.count({ where: { status: "gagal" } })).toBe(0);

    release();
    await first;
  });

  it("menandai sesi ANTRE selagi menunggu slot, dan `sedang diputuskan` hanya saat agennya jalan", async () => {
    await setLead(cfg({ maxConcurrent: 1, queueWaitSec: 30 }));
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const holder: DecideDeps = {
      ...deps(block({ decision: "a", reason: "b" })),
      think: async () => { await held; return block({ decision: "a", reason: "b" }); },
    };
    const first = decide({ ...ask, sessionId: "s1" }, holder);
    await new Promise((r) => setTimeout(r, 5));
    expect(decidingIds()).toEqual(["s1"]);

    const second = decide({ ...ask, sessionId: "s2" }, holder).catch(() => null);
    await new Promise((r) => setTimeout(r, 5));
    // s2 belum memanggil agen apa pun — ia mengantre. Operator harus bisa membedakan keduanya:
    // "menunggu manusia" dan "menunggu giliran" terlihat sama di pane, tapi hanya satu yang bug.
    expect(decidingIds()).toEqual(["s1"]);
    expect(queuedIds()).toEqual(["s2"]);

    release();
    await Promise.all([first, second]);
    expect(decidingIds()).toEqual([]);
    expect(queuedIds()).toEqual([]);
  });

  it("melepas slotnya saat agen melempar — kegagalan tak boleh mengecilkan kapasitas", async () => {
    await setLead(cfg({ maxConcurrent: 1, queueWaitSec: 0 }));
    const boom = deps(new Error("agen mati"));
    const row = await decide({ ...ask, sessionId: "s1" }, boom);
    expect(row?.status).toBe("gagal");          // ini kegagalan lead yang sebenarnya (AC-4)
    expect(leadGateStats()).toEqual({ inFlight: 0, queued: 0 });
  });
});

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
