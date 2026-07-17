# VPS Checklist Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memindahkan detail VPS checklist ke dalam modal yang leluasa, dengan tiap seksi collapse/expand (default collapsed), plus search dan filter existing.

**Architecture:** Frontend-only. Komponen `VpsChecklist` (konten inline) diubah jadi `VpsChecklistModal` yang membungkus konten di dalam primitive `Modal`, menambah sub-komponen `SectionGroup` collapsible (default collapsed, header informatif), input search, dan expansi turunan (`filtering ? auto-expand match : manual toggle`). `VpsScreen` mengganti panel inline dengan ringkasan ringan + tombol "Checklist" yang membuka modal. Tak ada perubahan server/DTO/API.

**Tech Stack:** React 18 + TypeScript (Vite), Testing Library + Vitest, design system lokal (`../ds`: `Modal`, `Button`, `Icon`, `StateBlock`), ikon lucide-react (nama kebab-case).

## Global Constraints

- TypeScript strict — tak ada `any` baru; ikut tipe `@hanoman/shared` (`ChecklistView`, `ChecklistSection`, `ChecklistItem`, `VpsItemStatus`, `VpsMode`, `VpsSeverity`, `RemediateStep`).
- Tak menyentuh server, skema Prisma, endpoint, DTO, katalog, maupun scoring. Murni `src/` (frontend).
- Ikut design system: token CSS (`var(--…)`), primitive `Modal`/`Button`/`Icon`/`StateBlock` yang ada (editorial, bone paper, brass accent). Jangan tambah dependensi.
- Ikon dipetakan kebab→Pascal ke lucide (`icon.tsx`): `clipboard-list`, `chevron-right`, `chevron-down`, `search` valid.
- Perintah test frontend: `pnpm --filter ./src test -- --run <file>` (Vitest, jsdom). Boot/curl tak berlaku (komponen UI); verifikasi lewat test + render.
- Default seksi **collapsed** saat modal dibuka; saat search/filter aktif, seksi dengan item cocok **auto-expand**; saat kontrol dibersihkan, collapse semua.
- Centang checklist task/step yang selesai di file plan ini (`- [ ]` → `- [x]`) tiap selesai.

---

## File Structure

- **Modify+rename export:** `src/src/screens/VpsChecklist.tsx` — `VpsChecklist` → `VpsChecklistModal`; tambah `SectionGroup`, `sectionSummary`, input search, expansi turunan; export `ScoreBar` & `Badge`. Bungkus konten di `<Modal>`.
- **Modify:** `src/src/screens/VpsScreen.tsx` — panel inline (194-206) jadi ringkasan + tombol Checklist; state `checklistOpen`+`summary`; render `<VpsChecklistModal>`; import `VpsChecklistModal, ScoreBar, Badge`.
- **Modify (test):** `src/test/vps-checklist.test.tsx` — render `<VpsChecklistModal>`; expand seksi sebelum assert item; tambah test collapse-default/toggle/header-count/search.
- **Modify (test):** `src/test/vps-screen.test.tsx` — mock `api.vpsChecklist`; test tombol Checklist membuka modal.

---

## Task 1: VpsChecklistModal (modal + collapse + search + auto-expand)

**Files:**
- Modify: `src/src/screens/VpsChecklist.tsx` (rewrite penuh)
- Test: `src/test/vps-checklist.test.tsx` (rewrite penuh)

**Interfaces:**
- Consumes: `Modal` dari `../ds` (`{ open, title, eyebrow, icon, onClose, width, children }`); `api.vpsChecklist/markNa/attestItem/remediatePreview/remediate/markNaBulk`.
- Produces (dipakai Task 2):
  - `export function VpsChecklistModal({ vpsId, vpsName?, onClose, onToast })` — `vpsId: string; vpsName?: string; onClose: () => void; onToast: (msg: string, kind?: string, icon?: string) => void`.
  - `export function ScoreBar({ score }: { score: number })`.
  - `export function Badge({ text, color }: { text: string; color: string })`.
  - Header seksi `data-testid={`section-${id}`}` (tombol, `aria-expanded`); item `data-testid={`item-${id}`}`; search `aria-label="cari item"`; skor total `data-testid="score-total"`; drift `data-testid="drift-summary"`; saran `data-testid={`suggestion-${id}`}`; preview `data-testid="remediate-preview"`.

- [ ] **Step 1: Tulis test yang gagal** — ganti seluruh isi `src/test/vps-checklist.test.tsx`:

```tsx
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChecklistView, ChecklistItem } from "@hanoman/shared";

const item = (over: Partial<ChecklistItem> & { id: string }): ChecklistItem => ({
  section: "ssh", sectionTitle: "SSH Hardening", level: "Basic", title: over.id,
  mode: "AUDIT", severity: "high", probe: true, remediable: false, appLayer: false,
  status: "unknown", na: false, attested: false, drifted: false,
  actorEmail: null, naReason: null, attestNote: null,
  ...over,
});

const VIEW: ChecklistView = {
  vpsId: "v1", scoreTotal: 42, lastAuditAt: null,
  scoreBySection: { ssh: 50, firewall: 0 },
  sections: [
    { id: "ssh", title: "SSH Hardening", icon: "🔑", score: 50, items: [
      item({ id: "ssh-b2", title: "Nonaktifkan login root", mode: "AUDIT", severity: "critical", status: "fail" }),
      item({ id: "ssh-b3", title: "Nonaktifkan password login", mode: "AUDIT", severity: "critical", status: "fail", drifted: true }),
      item({ id: "ssh-a1", title: "SSH Certificate Authority", mode: "INFO", level: "Advanced", status: "unknown", probe: false }),
    ] },
    { id: "firewall", title: "Firewall & Network", icon: "🔥", score: 0, items: [
      item({ id: "fw-b1", section: "firewall", sectionTitle: "Firewall & Network", title: "Aktifkan UFW", mode: "AUTO", severity: "critical", status: "pass" }),
    ] },
    { id: "webserver", title: "Web Server Hardening", icon: "🌐", score: 0,
      suggestion: { applicable: false, detail: "tak ada nginx/apache" }, items: [
      item({ id: "ws-b1", section: "webserver", sectionTitle: "Web Server Hardening", title: "Sembunyikan versi", mode: "INFO", appLayer: true, status: "unknown", probe: false }),
    ] },
  ],
};

const { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk } = vi.hoisted(() => ({
  vpsChecklist: vi.fn(),
  markNa: vi.fn(async () => ({ ok: true })),
  attestItem: vi.fn(async () => ({ ok: true })),
  remediatePreview: vi.fn(async () => ({ steps: [{ item: "fw-b1", status: "would", detail: "akan" }] })),
  remediate: vi.fn(async () => ({ steps: [{ item: "fw-b1", status: "ok", detail: "" }], audit: null, scoreTotal: 5, scoreBySection: {} })),
  markNaBulk: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock("../src/api/client", () => ({
  api: { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk },
  ApiError: class extends Error {},
}));
import { VpsChecklistModal } from "../src/screens/VpsChecklist";

async function open() {
  render(<VpsChecklistModal vpsId="v1" onClose={() => {}} onToast={() => {}} />);
  await screen.findByTestId("score-total");
}
const expand = (id: string) => fireEvent.click(screen.getByTestId(`section-${id}`));

describe("VpsChecklistModal (SPEC-220/221 · UI modal)", () => {
  beforeEach(() => { vpsChecklist.mockResolvedValue(VIEW); markNa.mockClear(); attestItem.mockClear(); markNaBulk.mockClear(); });

  it("default collapsed: item tersembunyi, header seksi tampil (AC-9)", async () => {
    await open();
    expect(screen.getByTestId("score-total").textContent).toBe("42%");
    expect(screen.getByTestId("section-ssh")).toBeTruthy();
    expect(screen.queryByText("Nonaktifkan login root")).toBeNull();
    expand("ssh"); expand("firewall");
    expect(screen.getByText("Nonaktifkan login root")).toBeTruthy();
    expect(screen.getByText("Aktifkan UFW")).toBeTruthy();
  });

  it("klik header expand lalu collapse", async () => {
    await open();
    expect(screen.queryByTestId("item-ssh-b2")).toBeNull();
    expand("ssh");
    expect(screen.getByTestId("item-ssh-b2")).toBeTruthy();
    expand("ssh");
    expect(screen.queryByTestId("item-ssh-b2")).toBeNull();
  });

  it("header collapsed menampilkan hitungan status + badge drift", async () => {
    await open();
    const header = screen.getByTestId("section-ssh");
    expect(header.textContent).toMatch(/2 fail/);
    expect(header.textContent).toMatch(/1 unknown/);
    expect(within(header).getByText(/drift/i)).toBeTruthy();
    expect(screen.getByTestId("section-firewall").textContent).toMatch(/semua pass/);
  });

  it("search memfilter + auto-expand; dikosongkan → collapse lagi", async () => {
    await open();
    const box = screen.getByLabelText("cari item");
    fireEvent.change(box, { target: { value: "root" } });
    expect(screen.getByText("Nonaktifkan login root")).toBeTruthy();       // ssh-b2 cocok, auto-expand
    expect(screen.queryByText("Nonaktifkan password login")).toBeNull();   // ssh-b3 tak cocok
    expect(screen.queryByText("Aktifkan UFW")).toBeNull();                 // seksi firewall tak tampil
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.queryByText("Nonaktifkan login root")).toBeNull();       // collapse lagi
  });

  it("filter mode=INFO menyembunyikan non-INFO + auto-expand (AC-12)", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("mode"), { target: { value: "INFO" } });
    expect(screen.getByText("SSH Certificate Authority")).toBeTruthy(); // INFO tampil
    expect(screen.queryByText("Nonaktifkan login root")).toBeNull();    // AUDIT tersembunyi
  });

  it("tombol Attest hanya untuk item INFO (AC-11)", async () => {
    await open(); expand("ssh");
    expect(within(screen.getByTestId("item-ssh-a1")).queryByRole("button", { name: /attest/i })).toBeTruthy();
    expect(within(screen.getByTestId("item-ssh-b2")).queryByRole("button", { name: /attest/i })).toBeNull();
  });

  it("klik N/A memanggil api.markNa (AC-10)", async () => {
    await open(); expand("ssh");
    fireEvent.click(within(screen.getByTestId("item-ssh-b2")).getByRole("button", { name: /^n\/a$/i }));
    await vi.waitFor(() => expect(markNa).toHaveBeenCalledWith("v1", "ssh-b2", true, expect.any(String)));
  });

  it("klik Attest memanggil api.attestItem (AC-11)", async () => {
    await open(); expand("ssh");
    fireEvent.click(within(screen.getByTestId("item-ssh-a1")).getByRole("button", { name: /attest/i }));
    await vi.waitFor(() => expect(attestItem).toHaveBeenCalledWith("v1", "ssh-a1"));
  });

  it("hanya item AUTO punya checkbox seleksi (AC-13)", async () => {
    await open(); expand("ssh"); expand("firewall");
    expect(within(screen.getByTestId("item-fw-b1")).queryByRole("checkbox")).toBeTruthy();
    expect(within(screen.getByTestId("item-ssh-b2")).queryByRole("checkbox")).toBeNull();
    expect(within(screen.getByTestId("item-ssh-a1")).queryByRole("checkbox")).toBeNull();
  });

  it("pilih AUTO → Preview memanggil api.remediatePreview + tampil would (AC-13)", async () => {
    await open(); expand("firewall");
    fireEvent.click(within(screen.getByTestId("item-fw-b1")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    await vi.waitFor(() => expect(remediatePreview).toHaveBeenCalledWith("v1", ["fw-b1"]));
    expect(within(await screen.findByTestId("remediate-preview")).getByText(/fw-b1/)).toBeTruthy();
  });

  it("Apply memanggil api.remediate (AC-14)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await open(); expand("firewall");
    fireEvent.click(within(screen.getByTestId("item-fw-b1")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^apply/i }));
    await vi.waitFor(() => expect(remediate).toHaveBeenCalledWith("v1", ["fw-b1"]));
  });

  it("item drifted → badge drift di baris + ringkasan header (AC-19)", async () => {
    await open();
    expect(screen.getByTestId("drift-summary").textContent).toMatch(/1 item/);
    expand("ssh");
    expect(within(screen.getByTestId("item-ssh-b3")).getByText(/drift/i)).toBeTruthy();
  });

  it("seksi app-layer stack absent → banner saran + Tandai seksi N/A memanggil markNaBulk", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await open(); expand("webserver");
    const banner = screen.getByTestId("suggestion-webserver");
    fireEvent.click(within(banner).getByRole("button", { name: /tandai seksi n\/a/i }));
    await vi.waitFor(() => expect(markNaBulk).toHaveBeenCalledWith("v1", ["ws-b1"], true, expect.any(String)));
  });

  it("seksi non-app-layer TIDAK menampilkan banner saran", async () => {
    await open(); expand("ssh");
    expect(screen.queryByTestId("suggestion-ssh")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `pnpm --filter ./src test -- --run test/vps-checklist.test.tsx`
Expected: FAIL — `VpsChecklistModal` belum diekspor (import error) / testid `section-*` belum ada.

- [ ] **Step 3: Tulis ulang komponen** — ganti seluruh isi `src/src/screens/VpsChecklist.tsx`:

```tsx
/* VpsChecklistModal — modal detail checklist kepatuhan per-VPS (SPEC-220/221 · UI modal 2026-07-17).
   Seksi collapse/expand (default collapsed agar mudah di-track), search + filter existing,
   aksi N/A/attest/remediasi selektif. Data dari GET /vps/:id/checklist (server menghidrasi penuh). */
import React from "react";
import { Button, Modal, StateBlock, Icon } from "../ds";
import { api } from "../api/client";
import type { ChecklistView, ChecklistSection, ChecklistItem, VpsItemStatus, VpsMode, VpsSeverity, RemediateStep } from "@hanoman/shared";

const STATUS_ICON: Record<VpsItemStatus, string> = {
  pass: "check", fail: "x", warn: "alert-triangle", na: "minus", unknown: "circle" };
const STATUS_COLOR: Record<VpsItemStatus, string> = {
  pass: "var(--leaf-600)", fail: "var(--clay-600)", warn: "var(--amber-600)",
  na: "var(--text-subtle)", unknown: "var(--text-subtle)" };
const MODE_COLOR: Record<VpsMode, string> = {
  AUTO: "var(--brass-700)", AUDIT: "var(--amber-600)", INFO: "var(--text-subtle)" };
const SEV_COLOR: Record<VpsSeverity, string> = {
  critical: "var(--clay-600)", high: "var(--amber-600)", medium: "var(--text-subtle)", low: "var(--text-subtle)" };

export function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
    color, border: `1px solid ${color}`, borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap" }}>{text}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 90 ? "var(--leaf-600)" : score >= 50 ? "var(--amber-600)" : "var(--clay-600)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 90 }}>
      <div style={{ flex: 1, height: 6, background: "var(--bone-200)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-subtle)", minWidth: 28, textAlign: "right" }}>{score}%</span>
    </div>
  );
}

function ItemRow({ item, busy, selected, onToggle, onNa, onAttest }: {
  item: ChecklistItem; busy: boolean; selected: boolean;
  onToggle: (item: ChecklistItem) => void;
  onNa: (item: ChecklistItem, na: boolean) => void; onAttest: (item: ChecklistItem) => void }) {
  const selectable = item.mode === "AUTO" && !item.na;
  return (
    <div data-testid={`item-${item.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
      borderBottom: "1px solid var(--border-hair)", fontSize: 13, opacity: item.na ? 0.55 : 1 }}>
      {selectable
        ? <input type="checkbox" aria-label={`pilih ${item.id}`} checked={selected} onChange={() => onToggle(item)} />
        : <span style={{ display: "inline-block", width: 13 }} />}
      <Icon name={STATUS_ICON[item.status]} size={14} color={STATUS_COLOR[item.status]} />
      <span style={{ flex: 1, minWidth: 0 }}>{item.title}</span>
      {item.drifted && <Badge text="drift" color="var(--clay-600)" />}
      <Badge text={item.mode} color={MODE_COLOR[item.mode]} />
      <Badge text={item.severity} color={SEV_COLOR[item.severity]} />
      {item.mode === "INFO" && !item.attested && (
        <Button size="sm" variant="ghost" leftIcon="check-circle" loading={busy}
          onClick={() => onAttest(item)}>Attest</Button>
      )}
      <Button size="sm" variant="ghost" leftIcon={item.na ? "rotate-ccw" : "minus-circle"} loading={busy}
        onClick={() => onNa(item, !item.na)}>{item.na ? "Batal N/A" : "N/A"}</Button>
    </div>
  );
}

type Filter = { section: string; mode: string; status: string; severity: string };
const BLANK_FILTER: Filter = { section: "", mode: "", status: "", severity: "" };

function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-sm)", background: "var(--bone-50)", color: "var(--text)" }}>
      <option value="">{label}: semua</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

// Ringkasan status dari item PENUH seksi (indikator kesehatan stabil, tak terpengaruh filter).
function sectionSummary(items: ChecklistItem[]): { text: string; drift: number } {
  let fail = 0, warn = 0, unknown = 0, drift = 0;
  for (const i of items) {
    if (i.status === "fail") fail++;
    else if (i.status === "warn") warn++;
    else if (i.status === "unknown") unknown++;
    if (i.drifted) drift++;
  }
  const parts = [fail && `${fail} fail`, warn && `${warn} warn`, unknown && `${unknown} unknown`].filter(Boolean) as string[];
  return { text: parts.length ? parts.join(" ") : "semua pass", drift };
}

function SectionGroup({ section, items, expanded, onToggle, busy, selected, onToggleItem, onNa, onAttest, onSectionNa }: {
  section: ChecklistSection; items: ChecklistItem[]; expanded: boolean; onToggle: (id: string) => void;
  busy: string | null; selected: Set<string>;
  onToggleItem: (i: ChecklistItem) => void; onNa: (i: ChecklistItem, na: boolean) => void;
  onAttest: (i: ChecklistItem) => void; onSectionNa: (s: ChecklistSection) => void }) {
  const sum = sectionSummary(section.items);
  const suggestNa = !!section.suggestion && !section.suggestion.applicable;
  return (
    <div style={{ marginBottom: 8, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      <button data-testid={`section-${section.id}`} aria-expanded={expanded} onClick={() => onToggle(section.id)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", textAlign: "left",
          background: expanded ? "var(--bone-100)" : "transparent", border: "none", cursor: "pointer" }}>
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={15} color="var(--text-subtle)" />
        <span style={{ fontSize: 14 }}>{section.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{section.title}</span>
        <span style={{ fontSize: 11, color: "var(--text-subtle)", whiteSpace: "nowrap" }}>{sum.text}</span>
        {sum.drift > 0 && <Badge text="drift" color="var(--clay-600)" />}
        {suggestNa && <Badge text="saran N/A" color="var(--brass-700)" />}
        <ScoreBar score={section.score} />
      </button>
      {expanded && (
        <div style={{ padding: "2px 10px 8px" }}>
          {suggestNa && (
            <div data-testid={`suggestion-${section.id}`} style={{ display: "flex", alignItems: "center", gap: 8,
              margin: "6px 0", padding: "6px 10px", fontSize: 12, color: "var(--text-subtle)",
              background: "var(--bone-50)", border: "1px dashed var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
              <Icon name="info" size={13} color="var(--brass-700)" />
              <span style={{ flex: 1 }}>Stack tak terdeteksi ({section.suggestion!.detail}) — kemungkinan N/A. Cek Docker manual bila ragu.</span>
              <Button size="sm" variant="ghost" leftIcon="minus-circle" loading={busy === `section:${section.id}`}
                onClick={() => onSectionNa(section)}>Tandai seksi N/A</Button>
            </div>
          )}
          {items.map((i) => (
            <ItemRow key={i.id} item={i} busy={busy === i.id} selected={selected.has(i.id)}
              onToggle={onToggleItem} onNa={onNa} onAttest={onAttest} />
          ))}
        </div>
      )}
    </div>
  );
}

export function VpsChecklistModal({ vpsId, vpsName, onClose, onToast }:
  { vpsId: string; vpsName?: string; onClose: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [view, setView] = React.useState<ChecklistView | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = React.useState<Filter>(BLANK_FILTER);
  const [search, setSearch] = React.useState("");
  const [expandedManual, setExpandedManual] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<RemediateStep[] | null>(null);
  const [action, setAction] = React.useState<"" | "preview" | "apply">("");

  const load = React.useCallback(() => {
    setStatus("loading");
    api.vpsChecklist(vpsId).then((v) => { setView(v); setStatus("ready"); }).catch(() => setStatus("error"));
  }, [vpsId]);
  React.useEffect(() => {
    load();
    setSelected(new Set()); setPreview(null);
    setExpandedManual(new Set()); setSearch(""); setFilter(BLANK_FILTER);
  }, [load]);

  const toggleItem = (item: ChecklistItem) => setSelected((s) => {
    const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
  const clearSel = () => { setSelected(new Set()); setPreview(null); };
  const toggleSection = (id: string) => setExpandedManual((e) => {
    const n = new Set(e); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function doPreview() {
    setAction("preview");
    try { setPreview((await api.remediatePreview(vpsId, [...selected])).steps); }
    catch { onToast("Preview remediasi gagal", "err", "x-circle"); }
    finally { setAction(""); }
  }
  async function doApply() {
    if (!window.confirm(`Terapkan ${selected.size} item AUTO ke VPS ini?\nIdempoten & anti-lockout, lalu audit ulang.`)) return;
    setAction("apply");
    try { await api.remediate(vpsId, [...selected]); clearSel(); load(); onToast("Remediasi diterapkan · audit ulang", "ok", "shield"); }
    catch { onToast("Remediasi gagal", "err", "x-circle"); }
    finally { setAction(""); }
  }
  async function act(item: ChecklistItem, fn: () => Promise<unknown>, msg: string) {
    setBusy(item.id);
    try { await fn(); load(); onToast(msg, "ok", "shield"); }
    catch { onToast(`Gagal memperbarui ${item.id}`, "err", "x-circle"); }
    finally { setBusy(null); }
  }
  const onNa = (item: ChecklistItem, na: boolean) =>
    act(item, () => api.markNa(vpsId, item.id, na, na ? "ditandai dari checklist" : undefined),
      na ? `${item.id} ditandai N/A` : `${item.id} kembali applicable`);
  const onAttest = (item: ChecklistItem) =>
    act(item, () => api.attestItem(vpsId, item.id), `${item.id} di-attest`);
  async function onSectionNa(section: ChecklistSection) {
    const ids = section.items.map((i) => i.id);
    if (!window.confirm(`Tandai ${ids.length} item seksi "${section.title}" sebagai N/A?\nStack-nya tak terdeteksi — cek Docker manual bila ragu.`)) return;
    setBusy(`section:${section.id}`);
    try {
      await api.markNaBulk(vpsId, ids, true, "app-layer: stack tak terdeteksi");
      load(); onToast(`Seksi ${section.title} ditandai N/A`, "ok", "shield");
    } catch { onToast("Gagal tandai seksi N/A", "err", "x-circle"); }
    finally { setBusy(null); }
  }

  const searchQ = search.trim().toLowerCase();
  const filterActive = !!(filter.section || filter.mode || filter.status || filter.severity);
  const filtering = filterActive || searchQ !== "";
  const matchItem = (i: ChecklistItem) =>
    (!filter.section || i.section === filter.section) &&
    (!filter.mode || i.mode === filter.mode) &&
    (!filter.status || i.status === filter.status) &&
    (!filter.severity || i.severity === filter.severity) &&
    (!searchQ || i.title.toLowerCase().includes(searchQ)
      || i.id.toLowerCase().includes(searchQ) || (i.code ?? "").toLowerCase().includes(searchQ));
  const set = (k: keyof Filter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }));

  function body() {
    if (status === "loading") return <StateBlock kind="loading" compact title="Memuat checklist…" />;
    if (status === "error" || !view) return <StateBlock kind="error" compact title="Gagal memuat checklist" action={load} />;

    const driftCount = view.sections.reduce((a, s) => a + s.items.filter((i) => i.drifted).length, 0);
    const rows = view.sections
      .map((s) => ({ section: s, matched: s.items.filter(matchItem) }))
      .filter((r) => !filtering || r.matched.length > 0);

    return (
      <div>
        <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--surface-card)", paddingBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div data-testid="score-total" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{view.scoreTotal}%</div>
            <div style={{ flex: 1 }}><ScoreBar score={view.scoreTotal} /></div>
            <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>skor kepatuhan</span>
          </div>
          {driftCount > 0 && (
            <div data-testid="drift-summary" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
              padding: "6px 10px", fontSize: 12, color: "var(--clay-700)",
              background: "var(--clay-50, var(--bone-100))", border: "1px solid var(--clay-600)", borderRadius: "var(--radius-sm)" }}>
              <Icon name="alert-triangle" size={14} color="var(--clay-600)" />
              {driftCount} item drift (regresi) sejak audit sebelumnya
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 180px",
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: "2px 8px", background: "var(--bone-50)" }}>
              <Icon name="search" size={13} color="var(--text-subtle)" />
              <input aria-label="cari item" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="cari item, id, atau kode…"
                style={{ flex: 1, border: "none", background: "transparent", fontSize: 12, color: "var(--text)", outline: "none" }} />
            </div>
            <Select label="seksi" value={filter.section} onChange={set("section")}
              options={view.sections.map((s) => [s.id, s.title])} />
            <Select label="mode" value={filter.mode} onChange={set("mode")}
              options={[["AUTO", "AUTO"], ["AUDIT", "AUDIT"], ["INFO", "INFO"]]} />
            <Select label="status" value={filter.status} onChange={set("status")}
              options={[["pass", "pass"], ["fail", "fail"], ["warn", "warn"], ["na", "na"], ["unknown", "unknown"]]} />
            <Select label="severity" value={filter.severity} onChange={set("severity")}
              options={[["critical", "critical"], ["high", "high"], ["medium", "medium"], ["low", "low"]]} />
            {filtering && <Button size="sm" variant="ghost" onClick={() => { setFilter(BLANK_FILTER); setSearch(""); }}>Reset</Button>}
          </div>
          {selected.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "8px 10px",
              background: "var(--bone-100)", border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)" }}>
              <span style={{ fontSize: 12, flex: 1 }}>{selected.size} item AUTO dipilih</span>
              <Button size="sm" variant="secondary" leftIcon="eye" loading={action === "preview"} onClick={doPreview}>Preview</Button>
              <Button size="sm" leftIcon="shield" loading={action === "apply"} onClick={doApply}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={clearSel}>Batal</Button>
            </div>
          )}
          {preview && (
            <div data-testid="remediate-preview" style={{ marginTop: 10, padding: "8px 10px", fontSize: 12,
              fontFamily: "var(--font-mono)", background: "var(--bone-50)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Pratinjau (dry-run) — belum diterapkan:</div>
              {preview.map((s) => (
                <div key={s.item} style={{ color: "var(--text-subtle)" }}>{s.item} · {s.status} {s.detail}</div>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0
          ? <StateBlock kind="empty" compact title="Tak ada item cocok" hint="Ubah kata kunci atau reset filter." />
          : rows.map(({ section, matched }) => (
              <SectionGroup key={section.id} section={section}
                items={filtering ? matched : section.items}
                expanded={filtering ? true : expandedManual.has(section.id)}
                onToggle={toggleSection} busy={busy} selected={selected}
                onToggleItem={toggleItem} onNa={onNa} onAttest={onAttest} onSectionNa={onSectionNa} />
            ))}
      </div>
    );
  }

  return (
    <Modal open width={960} icon="clipboard-list" eyebrow={vpsName ?? "VPS"} title="Checklist kepatuhan" onClose={onClose}>
      {body()}
    </Modal>
  );
}
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `pnpm --filter ./src test -- --run test/vps-checklist.test.tsx`
Expected: PASS (13 test).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter ./src exec tsc --noEmit`
Expected: tak ada error di `VpsChecklist.tsx`. (Error `VpsScreen.tsx` soal import `VpsChecklist` yang hilang **diperbaiki di Task 2** — abaikan sementara bila muncul.)

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/VpsChecklist.tsx src/test/vps-checklist.test.tsx
git commit -m "feat(vps): checklist jadi modal + seksi collapse/expand + search (default collapsed)"
```

---

## Task 2: Integrasi VpsScreen (ringkasan + tombol Checklist + modal)

**Files:**
- Modify: `src/src/screens/VpsScreen.tsx` (import baris 9; state 76-81; effect setelah 92; panel 194-206; render modal)
- Test: `src/test/vps-screen.test.tsx` (tambah mock `vpsChecklist` + 1 test)

**Interfaces:**
- Consumes (dari Task 1): `VpsChecklistModal`, `ScoreBar`, `Badge` dari `./VpsChecklist`; `api.vpsChecklist(id): Promise<ChecklistView>`.
- Produces: perilaku UI — panel ringkasan + tombol "Checklist" membuka `<Modal>` (score-total tampil).

- [ ] **Step 1: Tulis test yang gagal** — tambahkan test + perluas mock di `src/test/vps-screen.test.tsx`.

Ganti blok `vi.hoisted`/`vi.mock` (baris 11-19) menjadi:

```tsx
const { updateVps, testVps, vpsConsole, vpsChecklist } = vi.hoisted(() => ({
  updateVps: vi.fn(),
  testVps: vi.fn(async () => ({ ok: true, out: "" })),
  vpsConsole: vi.fn(async () => ({ id: "vpsc-v1" })),
  vpsChecklist: vi.fn(async () => ({
    vpsId: "v1", scoreTotal: 77, lastAuditAt: null, scoreBySection: { ssh: 77 },
    sections: [{ id: "ssh", title: "SSH", icon: "🔑", score: 77, items: [
      { id: "ssh-b2", section: "ssh", sectionTitle: "SSH", level: "Basic", title: "Nonaktifkan login root",
        mode: "AUDIT", severity: "high", probe: true, remediable: false, appLayer: false,
        status: "fail", na: false, attested: false, drifted: false, actorEmail: null, naReason: null, attestNote: null }] }],
  })),
}));
vi.mock("../src/api/client", () => ({
  api: { listVps: vi.fn(async () => [VPS]), updateVps, testVps, vpsConsole, vpsChecklist },
  ApiError: class extends Error {},
}));
```

Tambahkan test ini di dalam `describe("VpsScreen (SPEC-164)", …)` (sebelum penutup `});` blok itu):

```tsx
  it("tombol Checklist membuka modal detail (UI 2026-07-17)", async () => {
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    fireEvent.click(await screen.findByText("web-1")); // pilih baris → ringkasan muncul
    fireEvent.click(await screen.findByRole("button", { name: /checklist/i }));
    expect(await screen.findByTestId("score-total")).toBeTruthy(); // modal termuat
    await vi.waitFor(() => expect(vpsChecklist).toHaveBeenCalledWith("v1"));
  });
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `pnpm --filter ./src test -- --run test/vps-screen.test.tsx`
Expected: FAIL — tombol "Checklist" belum ada / `api.vpsChecklist` belum dipakai VpsScreen.

- [ ] **Step 3: Ubah import** — `src/src/screens/VpsScreen.tsx` baris 9:

```tsx
import { VpsChecklistModal, ScoreBar, Badge } from "./VpsChecklist";
```

- [ ] **Step 4: Tambah state** — sisipkan setelah baris 81 (`const [modal, setModal] = …`):

```tsx
  const [checklistOpen, setChecklistOpen] = React.useState(false);
  const [summary, setSummary] = React.useState<{ scoreTotal: number; driftCount: number } | null>(null);
```

- [ ] **Step 5: Tambah loadSummary + effect** — sisipkan setelah efek `subscribe` (setelah baris 92, blok `React.useEffect(() => { load(); return subscribe(…); }, [load]);`):

```tsx
  // Ringkasan skor kepatuhan untuk VPS terpilih (di panel inline). Modal memuat detail penuh sendiri.
  const loadSummary = React.useCallback((id: string) => {
    api.vpsChecklist(id)
      .then((v) => setSummary({
        scoreTotal: v.scoreTotal,
        driftCount: v.sections.reduce((a, s) => a + s.items.filter((i) => i.drifted).length, 0) }))
      .catch(() => setSummary(null));
  }, []);
  React.useEffect(() => {
    if (!sel) { setSummary(null); return; }
    setSummary(null); loadSummary(sel);
  }, [sel, loadSummary]);
```

- [ ] **Step 6: Ganti panel inline** — ganti blok `{selected && ( … )}` (baris 194-206) menjadi:

```tsx
      {selected && (
        <div style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{selected.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 10 }}>
            {selected.lastAuditAt
              ? `Audit terakhir ${new Date(selected.lastAuditAt).toLocaleString()}`
              : "Belum pernah diaudit"}
            {selected.health && ` · disk ${selected.health.disk} · mem ${selected.health.mem} · load ${selected.health.load}`}
          </div>
          {summary && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{summary.scoreTotal}%</span>
              <div style={{ flex: 1 }}><ScoreBar score={summary.scoreTotal} /></div>
              {summary.driftCount > 0 && <Badge text={`${summary.driftCount} drift`} color="var(--clay-600)" />}
            </div>
          )}
          <Button size="sm" leftIcon="clipboard-list" onClick={() => setChecklistOpen(true)}>Checklist</Button>
        </div>
      )}
      {checklistOpen && selected && (
        <VpsChecklistModal vpsId={selected.id} vpsName={selected.name}
          onClose={() => { setChecklistOpen(false); loadSummary(selected.id); }}
          onToast={onToast} />
      )}
```

- [ ] **Step 7: Jalankan test — pastikan LULUS**

Run: `pnpm --filter ./src test -- --run test/vps-screen.test.tsx`
Expected: PASS (semua test lama + test Checklist baru).

- [ ] **Step 8: Typecheck + seluruh test frontend**

Run: `pnpm --filter ./src exec tsc --noEmit && pnpm --filter ./src test -- --run`
Expected: tsc bersih; semua test `src/` hijau.

- [ ] **Step 9: Verifikasi manual di app** (bukan cuma test)

Boot ulang server prod-lokal (memuat dist baru): `pnpm --filter ./src build` lalu (bila mengetes lewat server) restart server; atau `pnpm --filter ./src dev` dan buka VPS screen → pilih VPS → klik **Checklist** → modal terbuka, seksi collapsed default, expand/collapse jalan, search & filter jalan, N/A/Attest/Preview jalan. Tutup lewat Esc/backdrop.

- [ ] **Step 10: Commit**

```bash
git add src/src/screens/VpsScreen.tsx src/test/vps-screen.test.tsx
git commit -m "feat(vps): panel ringkasan + tombol Checklist membuka modal detail"
```

---

## Self-Review

**1. Spec coverage:**
- Modal detail leluasa → Task 1 (`<Modal width=960>`) + Task 2 (tombol). ✓
- Collapse/expand tiap seksi → `SectionGroup` + `toggleSection`. ✓
- Default collapsed → `expandedManual` awal kosong, `filtering=false` → semua collapsed. ✓
- Search → input `aria-label="cari item"` + `matchItem` (title/id/code). ✓
- Filter dipertahankan → 4 `Select` existing tetap. ✓
- Header seksi informatif (skor + hitungan + drift) → `sectionSummary` + Badge drift/saran. ✓
- Auto-expand saat filter/search; collapse saat bersih → `expanded = filtering ? true : manual`. ✓
- Fungsi lama dipertahankan (N/A/attest/remediasi/bulk/drift banner) → dipindah utuh ke modal. ✓
- Ringkasan inline + skor → Task 2 panel + `summary`. ✓

**2. Placeholder scan:** tak ada TBD/TODO; semua step berisi kode/perintah nyata.

**3. Type consistency:** `VpsChecklistModal`, `ScoreBar`, `Badge` diekspor di Task 1 dan diimpor persis di Task 2. `matchItem`/`sectionSummary`/`filtering`/`expandedManual` konsisten. `api.vpsChecklist` dipakai di kedua tempat dengan signature `(id) => Promise<ChecklistView>`.

**4. Ambiguity:** hitungan header dari item penuh seksi (eksplisit di `sectionSummary(section.items)`); saat filtering seksi force-expand & item = matched; empty-state saat nol match.
