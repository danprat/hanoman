# Hardening VPS Checklist (SPEC-220) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD throughout.

**Goal:** Perluas modul VPS jadi kerangka kepatuhan 232-item: katalog di git, audit→skor, checklist UI + N/A/attest, dan remediasi selektif AUTO dengan preview dry-run.

**Architecture:** Katalog kanonik (232 item, di-generate dari `bzn_catalog.json`) hidup di `server/src/vps/catalog/`. Audit script mengemit `CHECK <itemId> <status>`; `vps-audit.ts` memetakannya ke katalog, `vps-scoring.ts` menghitung `(pass+attested)/applicable`, hasil disimpan sebagai `VpsAuditSnapshot`. Keputusan human (N/A, attest) di `VpsItemState`. Remediasi selektif lewat `remediate.sh` (dry-run + apply, anti-lockout). Semua deterministik SSH+sudo, tanpa cron baru.

**Tech Stack:** Node/TS Fastify, Prisma/Postgres, React/TS Vite, bash (multi-distro deb/rhel), vitest.

## Global Constraints

- TypeScript strict. Test tiap logika (katalog, scoring, parse, route).
- Skrip deterministik SSH+sudo, BUKAN sesi Claude (AC-21). Idempoten (AC-22). Multi-distro deb/ubuntu + rhel/centos/rocky/alma/opencloudos (AC-23). Anti-lockout: firewall allow SSH sebelum enable; `sshd -t` wajib pass sebelum reload (AC-15).
- Item berisiko-lockout (ganti port SSH, buat/hapus user, matikan service kritis, disable root/password login) TIDAK boleh `AUTO` (AC-16) — tetap `AUDIT`/`INFO`.
- Tanpa scheduler/cron baru (AC-20, ADR-0024). Tanpa drift/Notification (itu Fase 3).
- Perubahan skema → migration hand-written + `migrate deploy` per DB (`hanoman`, `hanoman_test`) + ADR (AC-24). Jangan `migrate dev` (reset saat drift worktree).
- Katalog = sumber kebenaran di git, bukan diedit runtime lewat DB (AC-2).
- Scoring v1 = bobot setara per item (PRD open Q1).
- Docs tersentuh diperbarui + link di `internal/docs/README.md` dalam commit yang sama.
- Test: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`. Setiap task selesai: centang box + boot server + curl endpoint tersentuh.
- Sumber katalog: `scratchpad/bzn_catalog.json` (232 item, `{id,text,code?}` per item; regenerasi dari https://bzn2026.lovable.app/ bila hilang, lihat `scratchpad/extract_catalog.mjs`).

---

## PR1 — Katalog + data model + ADR/docs

### Task 1: Generate katalog data + tipe + build

**Files:**
- Create: `server/scripts/gen-catalog.mjs` (generator sekali-jalan)
- Create: `server/src/vps/catalog/catalog.data.ts` (generated)
- Create: `server/src/vps/catalog/overrides.ts`
- Create: `server/src/vps/catalog/catalog.ts`
- Create: `server/src/vps/catalog/catalog.test.ts`

**Interfaces (Produces):**
```ts
export type Mode = "AUTO" | "AUDIT" | "INFO";
export type Severity = "critical" | "high" | "medium" | "low";
export type CatalogItem = {
  id: string; section: string; sectionTitle: string; level: string;
  title: string; code?: string;
  mode: Mode; severity: Severity; probe: boolean; remediable: boolean; appLayer: boolean;
};
export type SectionMeta = { id: string; title: string; icon: string; count: number };
export const CATALOG: CatalogItem[];        // 232 item
export const SECTIONS: SectionMeta[];        // 16 seksi
export const byId: (id: string) => CatalogItem | undefined;
```

- [x] **Step 1: Generator.** `server/scripts/gen-catalog.mjs` membaca `bzn_catalog.json` (path via argv, default `../../scratchpad/bzn_catalog.json`) → menulis `catalog.data.ts`:
```js
// gen-catalog.mjs — node server/scripts/gen-catalog.mjs <path-to-bzn_catalog.json>
import { readFileSync, writeFileSync } from "node:fs";
const src = process.argv[2] ?? "/tmp/bzn_catalog.json";
const data = JSON.parse(readFileSync(src, "utf8"));
const sections = data.map((s) => ({ id: s.id, title: s.title, icon: s.icon,
  count: s.subsections.reduce((a, ss) => a + ss.items.length, 0) }));
const items = data.flatMap((s) => s.subsections.flatMap((ss) => ss.items.map((it) => ({
  id: it.id, section: s.id, sectionTitle: s.title, level: ss.level, title: it.text,
  ...(it.code ? { code: it.code } : {}) }))));
const banner = "// GENERATED oleh server/scripts/gen-catalog.mjs dari checklist rujukan (SPEC-220). Jangan edit tangan.\n";
writeFileSync("server/src/vps/catalog/catalog.data.ts",
  banner + "export const RAW_SECTIONS = " + JSON.stringify(sections) + " as const;\n" +
  "export const RAW_ITEMS = " + JSON.stringify(items) + " as const;\n");
console.log("wrote", items.length, "items", sections.length, "sections");
```
Run: `mkdir -p server/src/vps/catalog && node server/scripts/gen-catalog.mjs "$SCRATCH/bzn_catalog.json"` → expect `wrote 232 items 16 sections`.

- [x] **Step 2: Overrides.** `overrides.ts` — mode/severity/probe/remediable per itemId + section-level appLayer:
```ts
import type { Mode, Severity } from "./catalog";
export const APP_LAYER_SECTIONS = new Set(["aapanel", "webserver", "database", "ssl"]);
type Ov = { mode?: Mode; severity?: Severity; probe?: boolean; remediable?: boolean };
// AUTO = diaudit + boleh di-apply idempoten & anti-lockout. AUDIT = diaudit, remediasi manual.
export const OVERRIDES: Record<string, Ov> = {
  // firewall
  "fw-b1": { mode: "AUTO", severity: "critical", probe: true, remediable: true },
  "fw-b3": { mode: "AUDIT", severity: "medium", probe: true },
  // ids / fail2ban
  "ids-b1": { mode: "AUTO", severity: "high", probe: true, remediable: true },
  // system updates
  "sys-b1": { mode: "AUTO", severity: "high", probe: true, remediable: true },
  // kernel sysctl (aman, idempoten)
  "ker-b1": { mode: "AUTO", severity: "medium", probe: true, remediable: true },
  "ker-b2": { mode: "AUTO", severity: "medium", probe: true, remediable: true },
  "ker-b3": { mode: "AUTO", severity: "medium", probe: true, remediable: true },
  "ker-b4": { mode: "AUTO", severity: "medium", probe: true, remediable: true },
  "ker-b5": { mode: "AUTO", severity: "medium", probe: true, remediable: true },
  "ker-i4": { mode: "AUTO", severity: "low", probe: true, remediable: true },
  "ker-i6": { mode: "AUTO", severity: "low", probe: true, remediable: true },
  // sshd tweaks aman (sshd -t guarded), TANPA lockout
  "ssh-i2": { mode: "AUTO", severity: "medium", probe: true, remediable: true },
  "ssh-i3": { mode: "AUTO", severity: "low", probe: true, remediable: true },
  "ssh-i5": { mode: "AUTO", severity: "medium", probe: true, remediable: true },
  // sshd berisiko-lockout: PROBE saja, remediasi manual (AC-16)
  "ssh-b1": { mode: "AUDIT", severity: "high", probe: true },
  "ssh-b2": { mode: "AUDIT", severity: "critical", probe: true },
  "ssh-b3": { mode: "AUDIT", severity: "critical", probe: true },
  // user berisiko/destruktif
  "usr-b2": { mode: "AUDIT", severity: "medium", probe: true },
  "usr-b3": { mode: "AUDIT", severity: "high", probe: true },
};
```

- [x] **Step 3: catalog.ts.** Bangun `CATALOG` dari `RAW_ITEMS` + overrides, default mode `INFO`, severity dari level:
```ts
import { RAW_ITEMS, RAW_SECTIONS } from "./catalog.data";
import { OVERRIDES, APP_LAYER_SECTIONS } from "./overrides";
export type Mode = "AUTO" | "AUDIT" | "INFO";
export type Severity = "critical" | "high" | "medium" | "low";
export type CatalogItem = { id: string; section: string; sectionTitle: string; level: string;
  title: string; code?: string; mode: Mode; severity: Severity; probe: boolean; remediable: boolean; appLayer: boolean };
export type SectionMeta = { id: string; title: string; icon: string; count: number };
const sevFromLevel = (lvl: string): Severity =>
  lvl === "Basic" ? "high" : lvl === "Intermediate" ? "medium" : "low";
export const CATALOG: CatalogItem[] = RAW_ITEMS.map((r) => {
  const ov = OVERRIDES[r.id] ?? {};
  return { id: r.id, section: r.section, sectionTitle: r.sectionTitle, level: r.level,
    title: r.title, ...(("code" in r) ? { code: (r as { code?: string }).code } : {}),
    mode: ov.mode ?? "INFO", severity: ov.severity ?? sevFromLevel(r.level),
    probe: ov.probe ?? false, remediable: ov.remediable ?? false,
    appLayer: APP_LAYER_SECTIONS.has(r.section) };
});
export const SECTIONS: SectionMeta[] = RAW_SECTIONS.map((s) => ({ ...s }));
const _map = new Map(CATALOG.map((c) => [c.id, c]));
export const byId = (id: string): CatalogItem | undefined => _map.get(id);
```

- [x] **Step 4: Test katalog.** `catalog.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CATALOG, SECTIONS, byId } from "./catalog";
describe("catalog", () => {
  it("memuat 232 item / 16 seksi (AC-1)", () => {
    expect(CATALOG.length).toBe(232);
    expect(SECTIONS.length).toBe(16);
    expect(SECTIONS.reduce((a, s) => a + s.count, 0)).toBe(232);
  });
  it("id unik & stabil", () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(232);
  });
  it("mode & severity valid", () => {
    for (const c of CATALOG) {
      expect(["AUTO", "AUDIT", "INFO"]).toContain(c.mode);
      expect(["critical", "high", "medium", "low"]).toContain(c.severity);
    }
  });
  it("remediable ⊆ AUTO; item AUTO tak boleh berisiko-lockout (AC-16)", () => {
    const risky = new Set(["ssh-b1", "ssh-b2", "ssh-b3", "usr-b2"]);
    for (const c of CATALOG) {
      if (c.remediable) expect(c.mode).toBe("AUTO");
      if (risky.has(c.id)) expect(c.mode).not.toBe("AUTO");
    }
  });
  it("appLayer benar untuk seksi app-layer", () => {
    expect(byId("ssh-b2")?.appLayer).toBe(false);
    expect(CATALOG.filter((c) => c.section === "aapanel").every((c) => c.appLayer)).toBe(true);
  });
});
```
Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism server/src/vps/catalog` → PASS.

- [x] **Step 5: Commit.** `git add server/scripts/gen-catalog.mjs server/src/vps/catalog && git commit -m "feat(vps): katalog kepatuhan 232 item + mode/severity (SPEC-220 AC-1/2/16)"`

### Task 2: Model Prisma + migration + regenerate

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Vps` + 2 model baru)
- Create: `server/prisma/migrations/2026071700_spec220_vps_compliance/migration.sql`

**Interfaces (Produces):** tabel `VpsAuditSnapshot`, `VpsItemState`; `prisma.vpsAuditSnapshot`, `prisma.vpsItemState`.

- [x] **Step 1:** Tambah ke `schema.prisma` (dalam blok `model Vps { … }` tambah back-relations, lalu 2 model baru):
```prisma
// di model Vps, sebelum penutup:
  snapshots  VpsAuditSnapshot[]
  itemStates VpsItemState[]

model VpsAuditSnapshot {
  id             String   @id @default(cuid())
  vpsId          String
  createdAt      DateTime @default(now())
  results        Json
  scoreTotal     Float
  scoreBySection Json
  vps            Vps      @relation(fields: [vpsId], references: [id], onDelete: Cascade)
  @@index([vpsId, createdAt])
}

model VpsItemState {
  id         String   @id @default(cuid())
  vpsId      String
  itemId     String
  na         Boolean  @default(false)
  naReason   String?
  attested   Boolean  @default(false)
  attestNote String?
  actorEmail String?
  updatedAt  DateTime @default(now())
  vps        Vps      @relation(fields: [vpsId], references: [id], onDelete: Cascade)
  @@unique([vpsId, itemId])
}
```

- [x] **Step 2:** Tulis `migration.sql` (hand-written, additive):
```sql
CREATE TABLE "VpsAuditSnapshot" (
  "id" TEXT NOT NULL, "vpsId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "results" JSONB NOT NULL, "scoreTotal" DOUBLE PRECISION NOT NULL,
  "scoreBySection" JSONB NOT NULL,
  CONSTRAINT "VpsAuditSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VpsAuditSnapshot_vpsId_createdAt_idx" ON "VpsAuditSnapshot"("vpsId", "createdAt");
ALTER TABLE "VpsAuditSnapshot" ADD CONSTRAINT "VpsAuditSnapshot_vpsId_fkey"
  FOREIGN KEY ("vpsId") REFERENCES "Vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VpsItemState" (
  "id" TEXT NOT NULL, "vpsId" TEXT NOT NULL, "itemId" TEXT NOT NULL,
  "na" BOOLEAN NOT NULL DEFAULT false, "naReason" TEXT,
  "attested" BOOLEAN NOT NULL DEFAULT false, "attestNote" TEXT, "actorEmail" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VpsItemState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VpsItemState_vpsId_itemId_key" ON "VpsItemState"("vpsId", "itemId");
ALTER TABLE "VpsItemState" ADD CONSTRAINT "VpsItemState_vpsId_fkey"
  FOREIGN KEY ("vpsId") REFERENCES "Vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [x] **Step 3: Apply per DB + generate.**
```bash
cd server
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" pnpm exec prisma migrate deploy
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_test" pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
(Sesuaikan kredensial/port dgn `.env`/docker; DB di Docker — lihat `docker compose exec -T db …` bila perlu.) Expected: `migrate deploy` sukses di dua DB.

- [x] **Step 4:** Smoke Prisma client:
```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.vpsItemState.count().then(n=>{console.log('itemState rows',n);return p.vpsAuditSnapshot.count()}).then(n=>console.log('snapshot rows',n)).finally(()=>p.\$disconnect())"
```
Expected: `itemState rows 0` / `snapshot rows 0` (bukan error P2021 tabel hilang).

- [x] **Step 5: Commit.** `git add server/prisma/schema.prisma server/prisma/migrations && git commit -m "feat(vps): model VpsAuditSnapshot + VpsItemState + migration (SPEC-220 AC-5/24)"`

### Task 3: ADR-0050 + docs

**Files:**
- Create: `internal/docs/adr/0050-vps-compliance-katalog-scoring.md`
- Create: `internal/docs/architecture/vps-compliance.md`
- Modify: `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/README.md`

- [x] **Step 1:** Tulis `0050-vps-compliance-katalog-scoring.md` — status diterima · SPEC-220. Konteks: PRD hardening checklist; Keputusan: (1) katalog 232 item di git (generated, bukan DB, AC-2); (2) dua model baru `VpsAuditSnapshot` (append-only, fondasi drift Fase 3) + `VpsItemState` (N/A/attest + jejak pelaku); (3) taksonomi mode AUTO/AUDIT/INFO + severity; (4) scoring `(pass+attested)/applicable` equal-weight v1, N/A keluar denominator; (5) dry-run sebagai pengaman pengganti rollback (Non-goal v1); (6) item berisiko-lockout tetap non-AUTO (AC-16). Meng-extend ADR-0025.
- [x] **Step 2:** `vps-compliance.md` — jelaskan katalog (`server/src/vps/catalog/`), regenerasi via `gen-catalog.mjs`, mode/severity, probe→`CHECK <itemId>`, scoring, endpoint ringkas, alur remediasi dry-run.
- [x] **Step 3:** Tambah dua model ke `data-model.md`; tambah endpoint baru ke `api-contract.md`.
- [x] **Step 4:** Link di `README.md`: baris ADR-0050 (di bagian adr) + `vps-compliance` (di architecture).
- [x] **Step 5: Commit.** `git add internal/docs && git commit -m "docs(vps): ADR-0050 + vps-compliance + data-model/api-contract (SPEC-220)"`

---

## PR2 — Audit → katalog + scoring

### Task 4: Scoring pure function

**Files:**
- Create: `server/src/vps/scoring.ts`, `server/src/vps/scoring.test.ts`

**Interfaces (Produces):**
```ts
export type ItemStatus = "pass" | "fail" | "warn" | "na" | "unknown";
export type ItemState = { na?: boolean; attested?: boolean };
export type Scored = { total: number; bySection: Record<string, number>;
  status: Record<string, ItemStatus> };
export function scoreCompliance(
  probeStatus: Record<string, "pass" | "fail" | "warn" | "unknown">,
  states: Record<string, ItemState>): Scored;
```
Aturan: applicable = item TIDAK `na`. Terpenuhi = `pass` ATAU (`INFO` & `attested`). `na` → status "na", keluar denominator. Item probe tanpa hasil → "unknown" (tak terpenuhi). Skor = round((terpenuhi/applicable)*100). bySection sama per seksi. Item probe-status menang atas default; INFO tanpa attest = tak terpenuhi.

- [x] **Step 1: Test** `scoring.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { scoreCompliance } from "./scoring";
describe("scoreCompliance (AC-6)", () => {
  it("N/A keluar dari pembilang & penyebut (AC-10)", () => {
    const s = scoreCompliance({ "fw-b1": "pass" }, { "ssh-b2": { na: true } });
    // fw-b1 pass dihitung; ssh-b2 na tak masuk denominator
    expect(s.status["ssh-b2"]).toBe("na");
    expect(s.total).toBeGreaterThan(0);
  });
  it("INFO tanpa attest tak dihitung; attest → terpenuhi (AC-11)", () => {
    const a = scoreCompliance({}, {});
    const b = scoreCompliance({}, { "ssh-a1": { attested: true } });
    expect(b.total).toBeGreaterThan(a.total);
  });
  it("probe unknown ≠ pass (AC-7)", () => {
    const s = scoreCompliance({ "fw-b1": "unknown" }, {});
    expect(s.status["fw-b1"]).toBe("unknown");
  });
});
```
- [x] **Step 2: Run (fail).** `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism server/src/vps/scoring` → FAIL (module not found).
- [x] **Step 3: Implement** `scoring.ts` (iterasi `CATALOG`, terapkan aturan di atas). Import `CATALOG` dari `./catalog/catalog`.
- [x] **Step 4: Run (pass).**
- [x] **Step 5: Commit.** `git commit -m "feat(vps): scoring kepatuhan (pass+attested)/applicable (SPEC-220 AC-6)"`

### Task 5: Perluas audit.sh + mapping katalog

**Files:**
- Modify: `server/scripts/vps/audit.sh` (tambah blok emit `CHECK <itemId>`)
- Modify: `server/src/services/vps-audit.ts` (map ke katalog, simpan snapshot, hitung skor)
- Modify: `server/src/services/vps-audit.test.ts` (atau buat bila belum ada)

- [x] **Step 1:** Di `audit.sh`, setelah blok legacy, tambah emit item-id untuk item ber-probe. Contoh (memakai `sshd_opt`, `sysctl`, dsb yang sudah/akan ada):
```bash
# --- SPEC-220: CHECK per itemId katalog (item ber-probe) ---
# firewall aktif → fw-b1
if [ "$FAM" = deb ]; then ufw status 2>/dev/null | grep -q "Status: active" && emit fw-b1 pass || emit fw-b1 fail "ufw nonaktif";
else firewall-cmd --state 2>/dev/null | grep -q running && emit fw-b1 pass || emit fw-b1 fail "firewalld mati"; fi
systemctl is-active --quiet fail2ban 2>/dev/null && emit ids-b1 pass || emit ids-b1 fail "fail2ban nonaktif"
# auto updates → sys-b1 (reuse logika auto_updates)
# sshd → ssh-b2 (root login), ssh-b3 (password auth), ssh-i2 (idle), ssh-i3 (forwarding), ssh-i5 (maxauthtries)
if [ -n "$SSHD_T" ]; then
  case "$(sshd_opt permitrootlogin)" in no|prohibit-password|without-password) emit ssh-b2 pass ;; *) emit ssh-b2 fail ;; esac
  [ "$(sshd_opt passwordauthentication)" = no ] && emit ssh-b3 pass || emit ssh-b3 fail
  [ "$(sshd_opt clientaliveinterval)" -gt 0 ] 2>/dev/null && emit ssh-i2 pass || emit ssh-i2 fail "ClientAliveInterval 0"
  { [ "$(sshd_opt x11forwarding)" = no ] && [ "$(sshd_opt allowtcpforwarding)" = no ]; } && emit ssh-i3 pass || emit ssh-i3 fail
  [ "$(sshd_opt maxauthtries)" -le 4 ] 2>/dev/null && emit ssh-i5 pass || emit ssh-i5 fail
else emit ssh-b2 fail "sshd -T tak terbaca"; emit ssh-b3 fail "sshd -T tak terbaca"; fi
# kernel sysctl → ker-b1..b5, i4, i6
sctl() { sysctl -n "$1" 2>/dev/null; }
[ "$(sctl net.ipv4.ip_forward)" = 0 ] && emit ker-b1 pass || emit ker-b1 fail
[ "$(sctl net.ipv4.tcp_syncookies)" = 1 ] && emit ker-b2 pass || emit ker-b2 fail
[ "$(sctl net.ipv4.conf.all.accept_source_route)" = 0 ] && emit ker-b3 pass || emit ker-b3 fail
[ "$(sctl net.ipv4.conf.all.accept_redirects)" = 0 ] && emit ker-b4 pass || emit ker-b4 fail
[ "$(sctl net.ipv4.conf.all.rp_filter)" = 1 ] && emit ker-b5 pass || emit ker-b5 fail
[ "$(sctl kernel.randomize_va_space)" = 2 ] && emit ker-i4 pass || emit ker-i4 fail
[ "$(sctl fs.suid_dumpable)" = 0 ] && emit ker-i6 pass || emit ker-i6 fail
```
(Legacy CHECK lines tetap ada — parseAudit tetap menampung keduanya; `isHardened` legacy tak berubah.)

- [x] **Step 2:** Di `vps-audit.ts`, tambah `mapToCatalog`:
```ts
import { CATALOG, byId } from "../vps/catalog/catalog";
import { scoreCompliance } from "../vps/scoring";
// itemId asing (bukan katalog) diabaikan + warn (AC-3)
export function mapToCatalog(checks: VpsCheck[]): Record<string, "pass"|"fail"|"warn"|"unknown"> {
  const out: Record<string, "pass"|"fail"|"warn"|"unknown"> = {};
  for (const c of checks) {
    if (!byId(c.check)) { continue; } // legacy name / asing → lewati (log warn di caller)
    out[c.check] = c.status === "na" ? "unknown" : c.status;
  }
  return out;
}
```
Lalu di `runAudit`: setelah legacy update, ambil `itemStates` (`prisma.vpsItemState.findMany({where:{vpsId}})`), hitung `scoreCompliance(mapToCatalog(audit), states)`, buat `VpsAuditSnapshot`. Tetap set `Vps.audit/hardened/lastAuditAt` (kompat).

- [x] **Step 3: Test** `vps-audit.test.ts` — perluas `parseAudit` menerima `na` (ubah regex `(pass|fail|warn|na)`), `mapToCatalog` mengabaikan itemId asing (AC-3), dan `unknown` bukan pass (AC-7). Unit, tanpa DB.
- [x] **Step 4:** Ubah `zVpsCheck` status enum + `parseAudit` regex jadi menyertakan `"na"`; sesuaikan tipe. Run test PASS.
- [x] **Step 5: Commit.** `git commit -m "feat(vps): audit emit CHECK <itemId> + map katalog + snapshot skor (SPEC-220 AC-3/4/5/7)"`

### Task 6: Endpoint audit (snapshot) + GET checklist

**Files:**
- Modify: `server/src/routes/vps.ts`
- Modify: `shared/src/dto.ts` (tipe `ChecklistView`, `VpsScoreView`)
- Create: `server/src/routes/vps-checklist.test.ts`

**Interfaces (Produces):**
```ts
export type ChecklistItem = CatalogItem & { status: ItemStatus; na: boolean; attested: boolean; actorEmail: string | null; naReason: string | null; attestNote: string | null };
export type ChecklistView = { vpsId: string; scoreTotal: number; scoreBySection: Record<string, number>;
  sections: { id: string; title: string; icon: string; score: number; items: ChecklistItem[] }[];
  lastAuditAt: string | null };
```

- [x] **Step 1: Test** `vps-checklist.test.ts`: `POST /vps/:id/audit` (dgn sshExec di-mock) menyimpan `VpsAuditSnapshot` & mengembalikan skor; `GET /vps/:id/checklist` mengembalikan 232 item + skor. Pakai pola test route existing (buildApp + inject; DB test).
- [x] **Step 2: Run (fail).**
- [x] **Step 3:** Implement `GET /vps/:id/checklist` (gabung CATALOG + snapshot terakhir + itemStates). Ubah `POST /vps/:id/audit` mengembalikan `{ audit, hardened, scoreTotal, scoreBySection }`.
- [x] **Step 4: Run (pass).**
- [x] **Step 5: Live curl.** Boot server (DB throwaway ter-migrate, port bukan 8787). Daftarkan VPS dummy, `GET /api/vps/:id/checklist` → 200 dgn 232 item. Commit `git commit -m "feat(vps): GET checklist + audit kembalikan skor (SPEC-220 AC-9)"`

---

## PR3 — Checklist UI + N/A + attest

### Task 7: Endpoint N/A + attest (jejak pelaku)

**Files:**
- Modify: `server/src/routes/vps.ts`
- Modify: `shared/src/dto.ts` (`zMarkNa`, `zAttest`)
- Create: `server/src/routes/vps-item-state.test.ts`

- [x] **Step 1: Test:** `POST /vps/:id/items/:itemId/na {na, reason}` upsert `VpsItemState`, item keluar denominator (skor naik). `POST …/attest {note}` set attested + `actorEmail` dari `req.user`. itemId asing → 404. Verifikasi jejak pelaku tersimpan.
- [x] **Step 2: Run (fail).**
- [x] **Step 3:** Implement dua handler (validasi itemId via `byId`, `prisma.vpsItemState.upsert` by `@@unique([vpsId,itemId])`, `actorEmail` dari sesi auth `req.user?.email`).
- [x] **Step 4: Run (pass).**
- [x] **Step 5: Live curl + commit** `git commit -m "feat(vps): mark N/A + attest INFO dgn jejak pelaku (SPEC-220 AC-10/11)"`

### Task 8: Checklist UI

**Files:**
- Modify: `src/src/screens/VpsScreen.tsx`
- Modify: `src/src/api/client.ts` (fungsi baru: `vpsChecklist`, `markNa`, `attestItem`)
- Modify: `src/test/vps-screen.test.tsx`

- [x] **Step 1: Test** (viewport-aware, lihat memory): render checklist per-seksi + skor total; filter mode/status/severity; klik N/A → panggil `api.markNa`; tombol Attest muncul hanya utk item INFO.
- [x] **Step 2: Run (fail).**
- [x] **Step 3:** Implement: detail pane VPS → checklist. Header skor total + per-seksi (bar `--brass`/`--leaf`). Baris item: ikon status, judul, badge mode+severity, tombol N/A (semua), Attest (INFO). Filter bar (seksi/mode/status/severity). Ikuti design system (bone paper, brass). Muat via `api.vpsChecklist(id)`.
- [x] **Step 4: Run (pass).**
- [x] **Step 5: Commit** `git commit -m "feat(vps): checklist UI per-seksi + skor + filter + N/A/attest (SPEC-220 AC-9/12)"`

---

## PR4 — Remediasi selektif AUTO (Fase 2)

### Task 9: remediate.sh (dry-run + seleksi, anti-lockout)

**Files:**
- Create: `server/scripts/vps/remediate.sh`
- Create: `server/src/services/vps-remediate.ts`, `server/src/services/vps-remediate.test.ts`

**Interfaces (Produces):**
```ts
export type RemediateStep = { item: string; status: "would" | "ok" | "fail"; detail: string };
export function parseSteps(out: string): RemediateStep[];
export async function remediate(v: VpsRow, items: string[], dryRun: boolean): Promise<{ ok: boolean; steps: RemediateStep[]; out: string }>;
```

- [x] **Step 1:** `remediate.sh` — env `ITEMS=<id,..>` + `DRY_RUN=1`. Untuk tiap item AUTO, fungsi terpisah; dry-run cetak `STEP <item> would <detail>`, apply cetak `STEP <item> <ok|fail>`. Item non-AUTO → `STEP <item> fail "bukan item AUTO"` (AC-16). Reuse anti-lockout: firewall allow SSH sebelum enable; sshd drop-in + `sshd -t` wajib pass sebelum reload, batal bila gagal (AC-15). Idempoten (AC-22). Contoh kerangka:
```bash
#!/usr/bin/env bash
set -u
step(){ echo "STEP $1 $2 ${3:-}"; }
DRY="${DRY_RUN:-}"; IFS=',' read -ra SEL <<< "${ITEMS:-}"
AUTO="fw-b1 ids-b1 sys-b1 ker-b1 ker-b2 ker-b3 ker-b4 ker-b5 ker-i4 ker-i6 ssh-i2 ssh-i3 ssh-i5"
has(){ case " $AUTO " in *" $1 "*) return 0;; *) return 1;; esac; }
for it in "${SEL[@]}"; do
  has "$it" || { step "$it" fail "bukan item AUTO"; continue; }
  if [ -n "$DRY" ]; then step "$it" would "akan menerapkan $it"; continue; fi
  case "$it" in
    ker-b1) sysctl -w net.ipv4.ip_forward=0 >/dev/null 2>&1 && step ker-b1 ok || step ker-b1 fail ;;
    # … item lain: sysctl -w / drop-in sshd + sshd -t / ufw / fail2ban / unattended-upgrades …
  esac
done
```
(Sysctl AUTO juga tulis ke `/etc/sysctl.d/99-hanoman.conf` agar persist + idempoten.)

- [x] **Step 2: Test** `vps-remediate.test.ts`: `parseSteps` parse `would|ok|fail`; dry-run tak menghasilkan `ok` (semua `would`, AC-13); item non-AUTO → `fail` (AC-16). Unit (mock sshExec).
- [x] **Step 3:** `vps-remediate.ts`: `remediate()` rangkai `sudo -n env ITEMS=.. DRY_RUN=.. bash -s < remediate.sh`, verifikasi koneksi baru pasca-apply (pola harden).
- [x] **Step 4: Run (pass).**
- [x] **Step 5: Commit** `git commit -m "feat(vps): remediate.sh dry-run + seleksi AUTO anti-lockout (SPEC-220 AC-13/15/16/22)"`

### Task 10: Endpoint preview + apply + re-audit

**Files:**
- Modify: `server/src/routes/vps.ts`, `shared/src/dto.ts` (`zRemediate`)
- Create: `server/src/routes/vps-remediate.route.test.ts`

- [x] **Step 1: Test:** `POST /vps/:id/remediate/preview {items}` → steps `would`, TIDAK menyentuh DB/VPS (AC-13). `POST /vps/:id/remediate {items}` → apply + re-audit, kembalikan steps + skor baru (AC-14/17). item non-AUTO ditolak (AC-16). sshExec di-mock.
- [x] **Step 2: Run (fail).**
- [x] **Step 3:** Implement dua handler (validasi `items` semua `remediable` via katalog; preview = dryRun true; apply = dryRun false lalu `runAudit`). keyMissing guard seperti route lain.
- [x] **Step 4: Run (pass) + live curl** (mock/VPS dummy: preview 200 steps `would`).
- [x] **Step 5: Commit** `git commit -m "feat(vps): endpoint remediate preview+apply+re-audit (SPEC-220 AC-14/17)"`

### Task 11: UI remediasi (select → preview → apply)

**Files:**
- Modify: `src/src/screens/VpsScreen.tsx`, `src/src/api/client.ts`, `src/test/vps-screen.test.tsx`

- [x] **Step 1: Test:** checkbox muncul hanya utk item `AUTO`; pilih → tombol Preview → tampil steps `would`; Apply → panggil `api.remediate`.
- [x] **Step 2: Run (fail).**
- [x] **Step 3:** Implement multi-select item AUTO, panel Preview (list `would`), tombol Apply (confirm) → `api.remediate` → reload checklist. Non-AUTO tanpa checkbox.
- [x] **Step 4: Run (pass).**
- [x] **Step 5: Commit** `git commit -m "feat(vps): UI remediasi selektif AUTO (SPEC-220 AC-13/14)"`

---

## Verifikasi akhir (sebelum `Execute done`)

- [x] Semua box di atas `- [x]`.
- [x] `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism` hijau (server + web + shared).
- [x] Boot server nyata + curl: `GET /api/vps/:id/checklist`, `POST /api/vps/:id/items/:itemId/na`, `POST /api/vps/:id/remediate/preview` — semua sesuai kontrak.
- [x] Docs tersentuh diperbarui + ter-link di `internal/docs/README.md`.
- [x] Diff bersih di worktree; siap push `hanoman/spec-220`.

## Coverage spec → task

AC-1 T1 · AC-2 T1 · AC-3 T5 · AC-4 T5 · AC-5 T2/T5 · AC-6 T4 · AC-7 T4/T5 · AC-8 T5(distro existing) · AC-9 T6/T8 · AC-10 T7/T8 · AC-11 T7/T8 · AC-12 T8 · AC-13 T9/T10/T11 · AC-14 T10/T11 · AC-15 T9 · AC-16 T1/T9/T10 · AC-17 T10 · AC-21 (semua skrip) · AC-22 T9 · AC-23 (skrip multi-distro) · AC-24 T2/T3. Deferred Fase 3: AC-18(existing)/AC-19/AC-20(guardrail dipatuhi).
