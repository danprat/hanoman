# SPEC-490 — Placeholder berisi contoh nilai di setiap field form · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap field teks, textarea, dan kolom cari combobox di dashboard hanoman punya placeholder berisi **contoh nilai nyata** (atau bentuk formatnya), bukan pengulangan label — dan sebuah test kontrak menjaga call site baru tak bisa lahir tanpa placeholder.

**Architecture:** Tiga lapis. (1) **Katalog** — field yang dirender dari data (`CONFIG_REGISTRY`, `BRIEF/GOAL/QA_FIELDS`) mendapat contohnya di katalognya, jadi satu isian melayani ~35 field terender di dua panel. (2) **Call site** — 22 field kosong sisanya + ≈25 placeholder yang mengulang label/berisi instruksi ditambal langsung di JSX. (3) **Kontrak** — `src/test/placeholder-contract.test.ts` men-scan sumber `src/src/**/*.tsx` dan gagal bila ada field dalam scope tanpa placeholder, atau placeholder yang identik dengan labelnya.

**Tech Stack:** React 18 + TypeScript (Vite), design system in-repo (`src/src/ds`), vitest + jsdom (`src/test`), katalog bersama di `shared/src` (`@hanoman/shared`).

## Global Constraints

- **Bahasa Indonesia** untuk seluruh teks yang dilihat pengguna (placeholder, docs). Kode & identifier tetap apa adanya.
- **Label tetap wajib.** Placeholder TIDAK pernah menggantikan `Field label=…` / `aria-label`. Jangan menghapus label mana pun.
- **Jangan mengubah perilaku validasi**, submit, endpoint, skema, atau `Field.hint`.
- **Tanpa ADR, tanpa migration, tanpa endpoint baru, tanpa perubahan `server/src`.**
- **Design system tak bertambah prop:** `Input`/`HnTextarea`/`MultiSelect` sudah meneruskan `placeholder`/`searchPlaceholder`.
- **Scope verifikasi = yang berubah** (ADR-0080). Test yang dijalankan: `env -u NODE_ENV ./node_modules/.bin/vitest run <path test>` dari root repo — **`env -u NODE_ENV` wajib** (shell mesin ini menyetel `NODE_ENV=production`, dan itu membuat RTL `act` gagal massal). Jangan `pnpm -r typecheck`, jangan suite penuh.
- **Bentuk placeholder:** contoh bebas diawali `mis. ` (`mis. erp-tumbuh-ai`); format terikat ditulis apa adanya tanpa `mis. ` (`~/.ssh/id_ed25519`, `-1001234567890`, `https://github.com/org/repo.git`, `••••••••`).

## File Structure

**Dibuat:**
- `src/test/helpers/form-fields.ts` — scanner JSX murni: menemukan elemen form di sumber, menandai scope, exempt, placeholder, label. Satu-satunya parser; test memakainya, bukan menyalinnya.
- `src/test/form-field-scanner.test.ts` — unit test scanner atas fixture string (bukan repo), supaya parser sendiri punya jaring.
- `src/test/placeholder-contract.test.ts` — kontrak atas repo nyata.

**Diubah:**
- `shared/src/config-registry.ts` — field `example?: string` di `ConfigEntry` + isiannya.
- `shared/test/config-registry-example.test.ts` (dibuat di Task 3) — katalog wajib lengkap.
- `src/src/screens/SettingsScreen.tsx` — `ConfigField` + panel Telegram membaca `configEntry(key)?.example`; password akun; token agent; Activity log; goal condition.
- `src/src/screens/BacklogScreen.tsx` — `BRIEF/GOAL/QA_FIELDS` jadi triple; judul edit; kotak cari.
- `src/src/App.tsx`, `src/src/ds/shell.tsx`, `src/src/public/PublicHelpApp.tsx`, `src/src/screens/{CustomAgentsPanel,DocsWorkspace,GitGraph,IdeScreen,LeadScreen,PrdScreen,SchedulerScreen,SessionHistoryModal,TerminalScreen,TriageScreen,VpsChecklist,VpsScreen}.tsx` — placeholder call site.
- `internal/docs/design-system/design-system.md`, `internal/docs/frontend/frontend-implementation.md` — aturan + tempat penegakannya.

---

### Task 1: Scanner JSX sebagai helper bersama

**Files:**
- Create: `src/test/helpers/form-fields.ts`
- Test: `src/test/form-field-scanner.test.ts`

**Interfaces:**
- Consumes: — (tak ada)
- Produces:
  - `export type FormField = { file: string; line: number; tag: string; type: string; combobox: boolean; inScope: boolean; exemptReason?: string; hasPlaceholder: boolean; placeholder?: string; label?: string }`
  - `export function scanSource(file: string, source: string): FormField[]`
  - `export function scanDir(root: string): FormField[]`
  - `export function normalizeLabel(s: string): string`

- [x] **Step 1: Write the failing test**

Buat `src/test/form-field-scanner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeLabel, scanSource } from "./helpers/form-fields";

const one = (src: string) => {
  const f = scanSource("x.tsx", src);
  expect(f).toHaveLength(1);
  return f[0]!;
};

describe("scanSource", () => {
  it("menemukan Input dan membaca placeholder + aria-label", () => {
    const f = one(`<Input aria-label="Host" placeholder="203.0.113.10" />`);
    expect(f.tag).toBe("Input");
    expect(f.inScope).toBe(true);
    expect(f.hasPlaceholder).toBe(true);
    expect(f.placeholder).toBe("203.0.113.10");
    expect(f.label).toBe("Host");
  });

  it("mengabaikan tag yang hidup di dalam komentar", () => {
    expect(scanSource("x.tsx", `// DS Input meneruskan rest ke <input>\nconst a = 1;`)).toEqual([]);
    expect(scanSource("x.tsx", `/* pakai <textarea> polos */\nconst a = 1;`)).toEqual([]);
  });

  it("tidak berhenti pada > di dalam ekspresi prop", () => {
    const f = one(`<Input onChange={(e) => setX(e.target.value)} placeholder="mis. 5" />`);
    expect(f.placeholder).toBe("mis. 5");
  });

  it("menandai tipe non-teks di luar scope", () => {
    for (const t of ["checkbox", "radio", "file", "date"]) {
      expect(one(`<input type="${t}" />`).inScope).toBe(false);
    }
  });

  it("menandai field aria-hidden di luar scope", () => {
    expect(one(`<input aria-hidden value={t} />`).inScope).toBe(false);
  });

  it("membaca alasan dari komentar placeholder-exempt", () => {
    const f = one(`{/* placeholder-exempt: isi berkas apa pun bahasanya */}\n<textarea value={d} />`);
    expect(f.exemptReason).toBe("isi berkas apa pun bahasanya");
  });

  it("MultiSelect dinilai dari searchPlaceholder, bukan placeholder", () => {
    const a = one(`<MultiSelect placeholder="Pilih tools…" value={v} />`);
    expect(a.combobox).toBe(true);
    expect(a.hasPlaceholder).toBe(false);
    const b = one(`<MultiSelect placeholder="Pilih tools…" searchPlaceholder="mis. Read" value={v} />`);
    expect(b.hasPlaceholder).toBe(true);
    expect(b.placeholder).toBe("mis. Read");
  });

  it("jatuh ke label Field terdekat saat aria-label absen", () => {
    expect(one(`<Field label="Port"><Input placeholder="22" /></Field>`).label).toBe("Port");
  });

  it("tak memungut label Field yang jauh (di luar 500 karakter)", () => {
    const src = `<Field label="Jauh"></Field>${" ".repeat(600)}<Input placeholder="x" />`;
    expect(one(src).label).toBeUndefined();
  });

  it("normalizeLabel membuang prefiks mis. dan tanda baca ekor", () => {
    expect(normalizeLabel("Cari backlog…")).toBe("cari backlog");
    expect(normalizeLabel("mis. Cari Backlog")).toBe("cari backlog");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/form-field-scanner.test.ts
```

Expected: FAIL — `Failed to resolve import "./helpers/form-fields"`.

- [x] **Step 3: Write the scanner**

Buat `src/test/helpers/form-fields.ts`:

```ts
// SPEC-490 · scanner JSX untuk kontrak placeholder. SATU definisi parser: test kontrak
// memakainya, bukan menyalin regex-nya sendiri (kelas bug "satu definisi, N call site",
// SPEC-431/448/475/481). Bukan parser TS penuh — cukup untuk menemukan tag form dan
// atribut literalnya, dan sengaja gagal-KERAS (melempar) daripada menebak.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tag yang membawa kolom teks. `Select` TIDAK di sini: dropdown native selalu menampilkan
 *  opsi terpilih, jadi tak pernah ada kotak kosong tanpa petunjuk (lihat design doc). */
const TEXT_TAGS = ["Input", "HnTextarea", "textarea", "input"] as const;
const COMBOBOX_TAGS = ["MultiSelect"] as const;

/** Tipe input yang tak punya kolom teks, atau yang placeholder-nya diabaikan browser
 *  (`date`/`time`/… merender widget bawaan). */
const NON_TEXT_TYPES = new Set([
  "checkbox", "radio", "file", "hidden", "submit", "reset", "button", "range", "color", "image",
  "date", "datetime-local", "month", "week", "time",
]);

const LABEL_LOOKBEHIND = 500;

export type FormField = {
  file: string; line: number; tag: string; type: string;
  combobox: boolean;
  /** field yang wajib punya placeholder (sebelum memperhitungkan exemptReason) */
  inScope: boolean;
  exemptReason?: string;
  hasPlaceholder: boolean;
  placeholder?: string;
  label?: string;
};

/** Ganti isi komentar dengan spasi (panjang & baris dipertahankan) supaya `<input>` yang
 *  hidup di dalam prosa komentar tak terhitung sebagai call site. Terukur: 5 positif palsu. */
function maskComments(src: string): string {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") {
      const e = src.indexOf("\n", i); const stop = e < 0 ? src.length : e;
      out += " ".repeat(stop - i); i = stop; continue;
    }
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2); const stop = e < 0 ? src.length : e + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " "); i = stop; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === "\\") k++; k++; }
      out += src.slice(i, Math.min(k + 1, src.length)); i = k + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Ujung tag pembuka: `>` pertama yang tidak berada di dalam `{…}` maupun string. */
function tagEnd(src: string, from: number): number {
  let depth = 0;
  for (let k = from; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") {
      k++; while (k < src.length && src[k] !== c) { if (src[k] === "\\") k++; k++; }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return k;
  }
  return -1;
}

const attrLiteral = (body: string, name: string): string | undefined =>
  body.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];
const hasAttr = (body: string, name: string): boolean =>
  new RegExp(`\\b${name}\\s*=`).test(body);

/** Untuk membandingkan placeholder dengan label: buang `mis. `, tanda baca ekor, dan kapital. */
export function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/^mis\.\s*/, "").replace(/[….:•\s]+$/g, "").trim();
}

export function scanSource(file: string, source: string): FormField[] {
  const masked = maskComments(source);
  const out: FormField[] = [];
  for (const tag of [...TEXT_TAGS, ...COMBOBOX_TAGS]) {
    const re = new RegExp(`<${tag}(?=[\\s/>])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const start = m.index;
      const end = tagEnd(masked, start);
      if (end < 0) throw new Error(`${file}: tag <${tag}> tanpa penutup di offset ${start}`);
      const body = source.slice(start, end + 1);
      const before = source.slice(Math.max(0, start - LABEL_LOOKBEHIND), start);
      const combobox = (COMBOBOX_TAGS as readonly string[]).includes(tag);
      const phAttr = combobox ? "searchPlaceholder" : "placeholder";
      const type = attrLiteral(body, "type") ?? "";
      const fieldLabels = [...before.matchAll(/<Field\b[^>]*?\blabel\s*=\s*"([^"]*)"/g)];
      out.push({
        file, line: source.slice(0, start).split("\n").length, tag, type, combobox,
        inScope: combobox || (!NON_TEXT_TYPES.has(type) && !hasAttr(body, "aria-hidden")),
        exemptReason: before.match(/placeholder-exempt:\s*([^\n*}]+)/)?.[1]?.trim(),
        hasPlaceholder: hasAttr(body, phAttr),
        placeholder: attrLiteral(body, phAttr),
        label: attrLiteral(body, "aria-label") ?? fieldLabels.at(-1)?.[1],
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

export function scanDir(root: string): FormField[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) files.push(p);
    }
  };
  walk(root);
  return files.flatMap((f) => scanSource(f, readFileSync(f, "utf8")))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/form-field-scanner.test.ts
```

Expected: PASS — `10 passed`.

- [x] **Step 5: Commit**

```bash
git add src/test/helpers/form-fields.ts src/test/form-field-scanner.test.ts
git commit -m "test(490): scanner JSX bersama untuk kontrak placeholder"
```

---

### Task 2: Kontrak placeholder (sengaja MERAH sampai Task 8)

**Files:**
- Create: `src/test/placeholder-contract.test.ts`

**Interfaces:**
- Consumes: `scanDir`, `normalizeLabel`, `FormField` dari `src/test/helpers/form-fields.ts` (Task 1).
- Produces: — (test, tak diimpor siapa pun)

> **Task ini sengaja meninggalkan test MERAH.** Ini fase RED dari sweep: kontraknya lahir
> lebih dulu, lalu Task 3–8 mengecilkan daftar pelanggarannya sampai nol. Angka yang
> diharapkan disebut di tiap task berikutnya, jadi kemajuan bisa diverifikasi persis
> alih-alih "seharusnya lulus". **Jangan** menambal call site di task ini.

- [x] **Step 1: Write the contract test**

Buat `src/test/placeholder-contract.test.ts`:

```ts
// SPEC-490 · placeholder = contoh nilai, bukan pengulangan label. Ditegakkan atas SUMBER,
// bukan DOM: field tanpa placeholder terlihat persis seperti field yang belum diketik, jadi
// tak ada test render yang akan menangkapnya, dan call site form baru lahir terus-menerus.
import { describe, expect, it } from "vitest";
import { normalizeLabel, scanDir, type FormField } from "./helpers/form-fields";

const ROOT = "src/src";
const all = scanDir(ROOT);
const where = (f: FormField) => `${f.file}:${f.line} <${f.tag}${f.type ? ` type="${f.type}"` : ""}>`;

describe("kontrak placeholder", () => {
  // Scanner yang diam-diam berhenti memberi gejala yang sama dengan "semua lulus".
  it("benar-benar memindai field form", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((f) => f.inScope).length).toBeGreaterThan(50);
  });

  it("setiap field teks/textarea/combobox punya placeholder", () => {
    const missing = all.filter((f) => f.inScope && !f.exemptReason && !f.hasPlaceholder);
    expect(missing.map(where)).toEqual([]);
  });

  it("placeholder tidak mengulang labelnya", () => {
    const echoes = all.filter((f) =>
      f.inScope && !f.exemptReason && f.placeholder && f.label &&
      normalizeLabel(f.placeholder) === normalizeLabel(f.label));
    expect(echoes.map((f) => `${where(f)} placeholder="${f.placeholder}" label="${f.label}"`)).toEqual([]);
  });

  it("setiap pengecualian menyebut alasannya", () => {
    const blank = all.filter((f) => f.exemptReason !== undefined && f.exemptReason.length < 8);
    expect(blank.map(where)).toEqual([]);
  });
});
```

- [x] **Step 2: Run and record the baseline**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/placeholder-contract.test.ts
```

Expected: **2 failed | 2 passed**.
- `setiap field teks/textarea/combobox punya placeholder` → daftar **23** entri.
- `placeholder tidak mengulang labelnya` → **2** entri (`BacklogScreen.tsx:781`, `TerminalScreen.tsx:339`, keduanya `"Cari backlog…"` vs label `"Cari backlog"`).

> **Terukur 23, bukan 24 seperti perkiraan awal plan.** Honeypot `hc_trap`
> (`PublicHelpApp.tsx:154`) sudah keluar scope sendiri: ia ditulis `aria-hidden` **tanpa
> nilai**, dan Task 1 memang mengajari scanner membaca atribut boolean telanjang itu
> (`ariaHidden()`, bukan `hasAttr` yang menuntut `=`). Komentar `placeholder-exempt`-nya di
> Task 7 tetap dipasang supaya alasannya terbaca di call site.

Bila angkanya bukan 23 dan 2, berhenti dan periksa scanner-nya sebelum lanjut — plan ini menghitung mundur dari kedua angka itu.

- [x] **Step 3: Commit**

```bash
git add src/test/placeholder-contract.test.ts
git commit -m "test(490): kontrak placeholder (RED: 24 field kosong, 2 mengulang label)"
```

---

### Task 3: Katalog config — `ConfigEntry.example`

Satu isian di katalog melayani **dua** panel Settings (Config runtime + Kredensial Telegram), ~25 field terender. Menambal `<Input>`-nya saja hanya menambal satu komponen yang melayani semuanya dengan teks generik.

**Files:**
- Modify: `shared/src/config-registry.ts`
- Modify: `src/src/screens/SettingsScreen.tsx` (`ConfigField`, panel Telegram)
- Test: `shared/test/config-registry-example.test.ts` (create)

**Interfaces:**
- Consumes: `configEntry(key)` (sudah ada, `@hanoman/shared`).
- Produces: `ConfigEntry.example?: string` — dibaca `SettingsScreen`; **tidak** masuk `ConfigEntryView` (wire contract tak berubah; klien menghitungnya dari katalog yang sudah ter-bundle — semangat ADR-0018).

- [x] **Step 1: Write the failing catalog test**

Buat `shared/test/config-registry-example.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONFIG_REGISTRY } from "../src/config-registry";

// SPEC-490 · entri config baru wajib membawa contoh nilainya. `bootstrap` read-only (tak
// ada kolom yang diketik) dan `bool` dirender sebagai Switch — keduanya tak punya placeholder.
const needsExample = CONFIG_REGISTRY.filter((e) => e.category !== "bootstrap" && e.kind !== "bool");

describe("CONFIG_REGISTRY.example", () => {
  it("ada untuk setiap entri yang punya kolom ketik", () => {
    expect(needsExample.filter((e) => !e.example?.trim()).map((e) => e.key)).toEqual([]);
  });

  it("bukan pengulangan labelnya", () => {
    const echo = needsExample.filter((e) =>
      e.example!.trim().toLowerCase() === e.label.trim().toLowerCase());
    expect(echo.map((e) => e.key)).toEqual([]);
  });

  it("memindai entri, bukan daftar kosong", () => {
    expect(needsExample.length).toBeGreaterThan(15);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run shared/test/config-registry-example.test.ts
```

Expected: FAIL — TypeScript/runtime menolak `e.example` (properti belum ada) atau daftar 26 key.

- [x] **Step 3: Tambahkan field ke tipe**

Di `shared/src/config-registry.ts`, dalam `interface ConfigEntry`, tepat di bawah `patternError`:

```ts
  // SPEC-490 · contoh nilai untuk placeholder field-nya di Settings. Hidup di katalog, bukan
  // di call site: SATU <Input> di `ConfigField` merender ~25 entri, dan panel Telegram
  // merender empat di antaranya lagi — teks generik di call site tak bisa jadi contoh.
  example?: string;
```

- [x] **Step 4: Isi `example` untuk tiap entri**

Ubah entri berikut di `CONFIG_REGISTRY` — tambahkan `example` pada masing-masing (biarkan properti lain apa adanya):

| key | `example` |
|---|---|
| `SYNC_SERVER_URL` | `"https://hanoman.nafanesia.id"` |
| `SYNC_DEVICE_TOKEN` | `"43 karakter base64url dari tab Perangkat hub"` |
| `SYNC_TICK_MS` | `"15000"` |
| `CLAUDE_CODE_OAUTH_TOKEN` | `"sk-ant-oat01-…"` |
| `ANTHROPIC_API_KEY` | `"sk-ant-api03-…"` |
| `HANOMAN_CLAUDE_BIN` | `"/opt/homebrew/bin/claude"` |
| `HANOMAN_CODEX_BIN` | `"/opt/homebrew/bin/codex"` |
| `CLAUDE_CONFIG_DIR` | `"~/.claude"` |
| `HANOMAN_SSH_KEY_DIR` | `"~/.hanoman"` |
| `HANOMAN_SSH_BIN` | `"/usr/bin/ssh"` |
| `GITHUB_TOKEN` | `"ghp_…"` |
| `HANOMAN_GH_BIN` | `"/opt/homebrew/bin/gh"` |
| `HANOMAN_TELEGRAM_BOT_TOKEN` | `"123456789:AAE…"` |
| `HANOMAN_TELEGRAM_AGENT_TOKEN` | `"hnm_agt_…"` |
| `HANOMAN_TELEGRAM_ALLOWED_USER_IDS` | `"123456789, 987654321"` |
| `HANOMAN_TELEGRAM_TARGET_CHAT_ID` | `"-1001234567890"` |
| `HANOMAN_EVENTS_TICK_MS` | `"1000"` |
| `HANOMAN_NPM_REGISTRY` | `"https://registry.npmjs.org"` |
| `HANOMAN_TMUX_SOCKET` | `"hanoman"` |
| `gitGraph.style` | `"rounded"` |
| `gitGraph.colours` | `"#c9a227, #6b8f71, #b4614e"` |
| `gitGraph.dateType` | `"author"` |
| `gitGraph.commitsInitialLoad` | `"200"` |
| `gitGraph.commitsLoadMore` | `"100"` |
| `gitGraph.issueLinkPattern` | `"https://github.com/acme/app/issues/$1"` |

Contoh bentuk satu entri sesudah diubah:

```ts
  { key: "SYNC_SERVER_URL", group: "sync", label: "URL hub", kind: "url", apply: "live", category: "knob",
    example: "https://hanoman.nafanesia.id",
    help: "Base URL hub tujuan sync (REST + WS). Kosong = instance ini murni HUB." },
```

- [x] **Step 5: Run catalog test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run shared/test/config-registry-example.test.ts
```

Expected: PASS — `3 passed`.

- [x] **Step 6: Pakai katalognya di kedua panel Settings**

Di `src/src/screens/SettingsScreen.tsx`, tambahkan `configEntry` ke import `@hanoman/shared` yang sudah ada (cari baris `import { ... } from "@hanoman/shared";` dan sisipkan `configEntry`).

Lalu di `ConfigField`, cabang **secret** — ganti prop `placeholder` `<Input>`-nya:

```tsx
        : <><Input aria-label={entry.label} type="password"
              placeholder={entry.hasValue ? "biarkan kosong = pertahankan" : (configEntry(entry.key)?.example ?? "tempel token…")}
```

dan cabang **url | int | string | path** — tambahkan `placeholder` pada `<Input>`-nya:

```tsx
    <Input aria-label={entry.label} type={entry.kind === "int" ? "number" : "text"}
      placeholder={configEntry(entry.key)?.example}
      value={draft ?? entry.value ?? ""} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => onDraft(ev.target.value)} style={{ width: 240 }} />
```

Di panel **Kredensial Telegram** (cari `tgCreds.fields.map`), ganti prop `placeholder` `<Input>`-nya:

```tsx
                        placeholder={f.kind === "secret"
                          ? (f.masked ?? configEntry(f.key)?.example ?? "belum diisi")
                          : (configEntry(f.key)?.example ?? "belum diisi")}
```

- [x] **Step 7: Verify — typecheck, test terkait, dan hitungan kontrak**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./src typecheck
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/settings-nav.test.tsx src/test/config-panel.test.tsx src/test/placeholder-contract.test.ts
```

Expected: typecheck bersih; `config-panel`/`settings-nav` PASS; kontrak masih FAIL tapi daftar "punya placeholder" turun **23 → 22** (`SettingsScreen.tsx:343` hilang dari daftar).

- [x] **Step 8: Commit**

```bash
git add shared/src/config-registry.ts shared/test/config-registry-example.test.ts src/src/screens/SettingsScreen.tsx
git commit -m "feat(490): contoh nilai config hidup di CONFIG_REGISTRY, dipakai dua panel Settings"
```

---

### Task 4: Katalog payload backlog — `BRIEF/GOAL/QA_FIELDS`

Satu `<HnTextarea>` di `SpecDetail` merender 3–5 field tergantung `source`. Placeholdernya karena itu milik katalog field-nya.

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx:89-99` (konstanta), `:391` (render)
- Test: `src/test/placeholder-contract.test.ts` (sudah ada — dipakai sebagai verifikasi)

**Interfaces:**
- Consumes: —
- Produces: `BRIEF_FIELDS`/`GOAL_FIELDS`/`QA_FIELDS` bertipe `readonly (readonly [string, string, string])[]` — `[key, label, placeholder]`. Dibaca hanya di berkas ini.

- [x] **Step 1: Ubah konstantanya jadi triple**

Ganti blok `BRIEF_FIELDS`/`GOAL_FIELDS`/`QA_FIELDS` di `src/src/screens/BacklogScreen.tsx` dengan:

```tsx
// SPEC-490 · elemen ketiga = placeholder (contoh nilai). Satu <HnTextarea> merender
// ketiga daftar ini, jadi contohnya milik katalog fieldnya — bukan call site.
const BRIEF_FIELDS = [
  ["context", "Konteks", "mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu"],
  ["outcome", "Outcome", "mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu"],
  ["constraints", "Constraints", "mis. reuse queue yang ada"],
] as const;
// SPEC-407 · ADR-0089 · bentuk payload backlog goal (zGoalPayload) — bukan konteks/outcome.
const GOAL_FIELDS = [
  ["goal", "Goal", "mis. p95 GET /api/specs di bawah 200 ms"],
  ["done", "Selesai bila", "mis. output benchmark menunjukkan < 200 ms"],
  ["constraints", "Batasan", "mis. tanpa cache eksternal"],
] as const;
const QA_FIELDS = [
  ["severity", "Severity", ""],
  ["steps", "Langkah reproduksi", "1. Buka …\n2. Lakukan …\n3. Amati …"],
  ["expected", "Diharapkan", "mis. total funnel sama dengan jumlah baris laporan harian"],
  ["actual", "Aktual", "mis. total funnel dua kali lipat untuk sesi yang melewati tengah malam"],
  ["env", "Environment", "prod · web · v0.9.2"],
] as const;
```

- [x] **Step 2: Perbarui tipe & render**

Di `SpecDetail`, ganti baris tipe `fields`:

```tsx
  const fields: readonly (readonly [string, string, string])[] = qa ? QA_FIELDS : isGoal ? GOAL_FIELDS : BRIEF_FIELDS;
```

Lalu ganti kedua `fields.map(...)` supaya membaca elemen ketiga. Blok mode edit:

```tsx
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              {k === "severity"
                ? <Select value={form[k] ?? "major"} onChange={setField(k)} options={SEV_OPTS} style={{ width: "100%" }} />
                : <HnTextarea value={form[k] ?? ""} onChange={setField(k)} rows={2} placeholder={ph} />}
            </Field>
          ))}
```

dan blok baca (tepat di cabang `) : (` sesudahnya) — `ph` tak dipakai, jadi tetap dua elemen:

```tsx
        fields.map(([k, label]) => <DetailRow key={k} label={label} value={p[k] ?? ""} />)
```

- [x] **Step 3: Verify**

```bash
pnpm --filter ./src typecheck
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/backlog-board.test.tsx src/test/revert-stage.test.tsx src/test/placeholder-contract.test.ts
```

Expected: typecheck bersih; test backlog PASS; kontrak "punya placeholder" turun **22 → 21** (`BacklogScreen.tsx:391` hilang).

- [x] **Step 4: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx
git commit -m "feat(490): placeholder payload backlog hidup di katalog BRIEF/GOAL/QA_FIELDS"
```

---

### Task 5: Call site — modal & form (11 field)

**Files:**
- Modify: `src/src/App.tsx:566-578`
- Modify: `src/src/screens/BacklogScreen.tsx:331`
- Modify: `src/src/screens/CustomAgentsPanel.tsx:223,229,234`
- Modify: `src/src/screens/TriageScreen.tsx:131,138`
- Modify: `src/src/screens/VpsScreen.tsx:59`
- Modify: `src/src/screens/TerminalScreen.tsx:449`

**Interfaces:**
- Consumes: — · Produces: —

- [x] **Step 1: `App.tsx` — modal Edit project (3 field)**

Tambahkan `placeholder` pada ketiga `<Input>` di `EditProjectModal` (biarkan prop lain apa adanya):

```tsx
        <Input value={f.id} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, id: e.target.value }))}
          leftIcon="hash" mono placeholder="mis. erp-tumbuh-ai" style={{ width: "100%" }} />
```
```tsx
        <Input value={f.name} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, name: e.target.value }))}
          placeholder="mis. ERP Tumbuh AI" style={{ width: "100%" }} />
```
```tsx
        <Input value={f.desc} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, desc: e.target.value }))}
          placeholder="mis. ERP manufaktur + inventori" style={{ width: "100%" }} />
```

- [x] **Step 2: `BacklogScreen.tsx` — judul spec saat edit**

```tsx
        <Field label="Judul"><Input value={form.title ?? ""} onChange={setField("title")}
          placeholder="mis. Jadwal invoice berulang" style={{ width: "100%" }} /></Field>
```

- [x] **Step 3: `CustomAgentsPanel.tsx` — nama, deskripsi, instruksi**

```tsx
            <Input value={editing.draft.name} aria-label="Nama" disabled={Boolean(editing.id)}
              invalid={!nameValid} placeholder="mis. peninjau-keamanan"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
```
```tsx
            <Input value={editing.draft.description} aria-label="Deskripsi"
              placeholder="mis. Dipakai saat meninjau perubahan yang menyentuh auth"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, description: e.target.value } })} />
```
```tsx
            <HnTextarea value={editing.draft.instructions} aria-label="Instruksi" rows={6}
              placeholder={"mis. Kamu peninjau keamanan. Baca diff, laporkan temuan berurut dari yang paling berbahaya, sebut file:line."}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, instructions: e.target.value } })} />
```

- [x] **Step 4: `TriageScreen.tsx` — judul & detail tiket**

```tsx
        <Field label="Judul"><Input value={form.title} placeholder="mis. Tombol Simpan tak berfungsi di HP"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} /></Field>
```
```tsx
        <Field label="Detail keluhan"><HnTextarea value={form.detail} rows={6}
          placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tak tersimpan."
          onChange={(e) => setForm({ ...form, detail: e.target.value })} /></Field>
```

- [x] **Step 5: `VpsScreen.tsx` — port SSH**

```tsx
        <Field label="Port"><Input value={f.port} onChange={set("port")} mono placeholder="22" style={{ width: "100%" }} /></Field>
```

- [x] **Step 6: `TerminalScreen.tsx` — nama grup**

```tsx
    <input autoFocus aria-label="Nama grup" value={value} placeholder="mis. Rilis"
      onChange={(e) => setValue(e.target.value)}
```

- [x] **Step 7: Verify**

```bash
pnpm --filter ./src typecheck
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/edit-project-id.test.tsx src/test/edit-project-gitremote.test.tsx src/test/custom-agents-panel.test.tsx src/test/project-help-center.test.tsx src/test/placeholder-contract.test.ts
```

Expected: typecheck bersih; test PASS; kontrak "punya placeholder" turun **21 → 10**.

- [x] **Step 8: Commit**

```bash
git add src/src/App.tsx src/src/screens/BacklogScreen.tsx src/src/screens/CustomAgentsPanel.tsx src/src/screens/TriageScreen.tsx src/src/screens/VpsScreen.tsx src/src/screens/TerminalScreen.tsx
git commit -m "feat(490): placeholder contoh nilai di field modal & form dashboard"
```

---

### Task 6: Call site — angka & rahasia (8 field)

**Files:**
- Modify: `src/src/screens/LeadScreen.tsx:88,95,102`
- Modify: `src/src/screens/SchedulerScreen.tsx:180,198`
- Modify: `src/src/screens/SettingsScreen.tsx:108,111,166`

**Interfaces:**
- Consumes: — · Produces: —

Field angka memakai nilai default operasionalnya sebagai contoh — itu yang benar-benar
berguna saat kolomnya dikosongkan (`timeoutSec` 600 datang dari SPEC-432/479).

- [x] **Step 1: `LeadScreen.tsx` — tiga knob denyut lead**

```tsx
          <Input type="number" min={1} style={{ width: 76 }} aria-label="denyut lead (menit)"
            placeholder="5" value={String(cfg.everyMin)} disabled={busy}
```
```tsx
          <Input type="number" min={10} style={{ width: 84 }} aria-label="batas waktu putusan (detik)"
            placeholder="600" value={String(cfg.timeoutSec)} disabled={busy}
```
```tsx
          <Input type="number" min={1} style={{ width: 76 }} aria-label="maksimum jawaban otomatis per sesi"
            placeholder="3" value={String(cfg.maxAutoAnswers)} disabled={busy}
```

- [x] **Step 2: `SchedulerScreen.tsx` — cap concurrent & cadence**

```tsx
            <Input type="number" min={1} value={String(draft.maxConcurrent)} aria-label="Cap concurrent"
              placeholder="6"
```
```tsx
              <Input type="number" min={1} style={{ width: 84 }} aria-label={`cadence ${k}`}
                placeholder="30" value={String(draft.sources[k].everyMin)}
```

- [x] **Step 3: `SettingsScreen.tsx` — tiga field password**

Ketiganya memakai bentuk, bukan contoh: nilainya rahasia dan tak boleh disarankan.

```tsx
        <Input type="password" autoComplete="current-password" placeholder="••••••••" value={cur}
```
```tsx
        <Input type="password" autoComplete="new-password" placeholder="minimal 8 karakter" value={next}
```
```tsx
        <Input type="password" autoComplete="new-password" placeholder="minimal 8 karakter" value={password}
```

> Ketiganya di dua komponen berbeda (ganti password akun; buat user baru). Cocokkan lewat
> `autoComplete` + nama state (`cur` / `next` / `password`), bukan nomor baris — nomor
> bergeser sesudah Task 3.

- [x] **Step 4: Verify**

```bash
pnpm --filter ./src typecheck
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/lead-screen.test.tsx src/test/scheduler-screen.test.tsx src/test/settings-nav.test.tsx src/test/placeholder-contract.test.ts
```

Expected: typecheck bersih; test PASS; kontrak "punya placeholder" turun **10 → 2**.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/LeadScreen.tsx src/src/screens/SchedulerScreen.tsx src/src/screens/SettingsScreen.tsx
git commit -m "feat(490): placeholder untuk knob angka lead/scheduler dan field password"
```

---

### Task 7: Editor dokumen + pintu darurat (2 field wajib + 1 penanda)

**Files:**
- Modify: `src/src/screens/DocsWorkspace.tsx:268`
- Modify: `src/src/screens/IdeScreen.tsx:348`
- Modify: `src/src/public/PublicHelpApp.tsx:154`

**Interfaces:**
- Consumes: parser `placeholder-exempt:` dari Task 1. · Produces: —

Dua dari tiga **sah** tak punya placeholder, dan itu dinyatakan di kodenya — bukan dilewati diam-diam.

- [x] **Step 1: `DocsWorkspace.tsx` — editor markdown SoT punya satu bentuk, jadi punya contoh**

```tsx
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
                placeholder={"# Judul dokumen\n\nParagraf pembuka…"} style={{
```

- [x] **Step 2: `IdeScreen.tsx` — editor berkas: pintu darurat**

Sisipkan komentar tepat di atas `<textarea>` editor berkas (yang ber-`minHeight: 560`):

```tsx
            {/* placeholder-exempt: isi berkas apa pun bahasanya — tak ada satu contoh yang benar lintas .ts/.json/.sh */}
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} style={{
```

- [x] **Step 3: `PublicHelpApp.tsx` — honeypot: pintu darurat**

Sisipkan komentar tepat di atas input honeypot:

```tsx
          {/* placeholder-exempt: honeypot SPEC-352 — sengaja tak terlihat manusia; placeholder justru memandu bot */}
          <input tabIndex={-1} autoComplete="new-password" aria-hidden value={trap}
```

> Field ini juga sudah di luar scope lewat `aria-hidden`; komentarnya ada supaya alasannya
> terbaca di call site, bukan tersembunyi di daftar tipe scanner.

- [x] **Step 4: Verify**

```bash
pnpm --filter ./src typecheck
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/ide-screen.test.tsx src/test/public-help.test.tsx src/test/preview-fill-height.test.tsx src/test/placeholder-contract.test.ts
```

Expected: typecheck bersih; test PASS; kontrak test **`setiap field … punya placeholder` menjadi PASS** (0 tersisa). Yang masih FAIL hanya `placeholder tidak mengulang labelnya` (2 entri).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/DocsWorkspace.tsx src/src/screens/IdeScreen.tsx src/src/public/PublicHelpApp.tsx
git commit -m "feat(490): placeholder editor docs + pintu darurat beralasan untuk dua field"
```

---

### Task 8: Tulis ulang placeholder yang mengulang label atau berisi instruksi

Field-field ini **punya** placeholder, tapi isinya bukan contoh — itu inti keluhan SPEC-490 ("bukan placeholder `Nama project` untuk label `Nama project`"). Task ini yang membuat kontrak sepenuhnya hijau.

**Files:**
- Modify: `src/src/ds/shell.tsx`, `src/src/App.tsx`, `src/src/public/PublicHelpApp.tsx`
- Modify: `src/src/screens/{BacklogScreen,TerminalScreen,SessionHistoryModal,TriageScreen,VpsChecklist,GitGraph,CustomAgentsPanel,IdeScreen,PrdScreen,LeadScreen,SettingsScreen,VpsScreen,WebhooksPanel}.tsx`

**Interfaces:**
- Consumes: — · Produces: —

- [x] **Step 1: Kotak cari — enam permukaan**

Ganti **hanya** nilai `placeholder`-nya (biarkan prop lain apa adanya):

| berkas | dari | jadi |
|---|---|---|
| `ds/shell.tsx` (`Cari project…`) | `"Cari project…"` | `"mis. hanoman atau erp"` |
| `screens/BacklogScreen.tsx` (toolbar) | `"Cari backlog…"` | `"mis. invoice atau SPEC-412"` |
| `screens/TerminalScreen.tsx` (Ambil backlog) | `"Cari backlog…"` | `"mis. invoice atau SPEC-412"` |
| `screens/SessionHistoryModal.tsx` | `"Cari sesi…"` | `"mis. spec-412 atau reverse"` |
| `screens/TriageScreen.tsx` (daftar tiket) | `"Cari judul / email"` | `"mis. gagal login atau budi@contoh.id"` |
| `screens/VpsChecklist.tsx` | `"cari item, id, atau kode…"` | `"mis. ssh atau 5.2.1"` |
| `screens/GitGraph.tsx` (find) | `"cari commit (pesan/author/hash/ref)…"` | `"mis. auto-merge, 3a3e7e0, atau hanoman/spec-490"` |

- [x] **Step 2: Combobox — kolom cari `MultiSelect`**

Di `screens/CustomAgentsPanel.tsx`:

```tsx
              placeholder="Pilih tools…" searchPlaceholder="mis. Read atau Bash"
```
```tsx
              placeholder="Pilih agen…" searchPlaceholder="mis. peninjau-keamanan"
              emptyText="Belum ada agen lain."
```

- [x] **Step 3: Prosa instruksi → contoh (form brief / QA / PRD / ide project)**

`src/src/App.tsx`:

| field | dari | jadi |
|---|---|---|
| `f.expected` | `"Perilaku yang benar…"` | `"mis. total funnel sama dengan jumlah baris laporan harian"` |
| `f.actual` | `"Perilaku yang terjadi…"` | `"mis. total funnel dua kali lipat untuk sesi yang melewati tengah malam"` |
| `f.context` (cabang non-audit) | `"Situasi & motivasi…"` | `"mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu"` |
| `f.outcome` (cabang non-audit) | `"Kondisi setelah selesai…"` | `"mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu"` |
| `f.objective` (project baru) | `"Tuang ide di sini…"` | `"mis. POS ritel dengan stok multi-gudang dan laporan harian"` |

`src/src/screens/PrdScreen.tsx`:

| field | dari | jadi |
|---|---|---|
| `f.context` | `"Situasi & motivasi…"` | `"mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu"` |
| `f.outcome` | `"Kondisi setelah selesai…"` | `"mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu"` |

`src/src/public/PublicHelpApp.tsx`:

| field | dari | jadi |
|---|---|---|
| judul (`hc-title`) | `"Ringkas masalahnya"` | `"mis. Tombol Simpan tak berfungsi di HP"` |
| detail (`hc-detail`) | `"Ceritakan apa yang terjadi…"` | `"mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tak tersimpan."` |
| email (`hc-email`) | `"agar kami bisa menautkan laporan Anda"` | `"nama@contoh.id"` |
| cek status (`checkKey`) | `"Tempel link / kode status"` | `"mis. a1b2c3d4e5f6 — atau tempel link statusnya"` |

- [x] **Step 4: Sisanya**

| berkas · field | dari | jadi |
|---|---|---|
| `screens/IdeScreen.tsx` — nama remote | `"nama"` | `"origin"` |
| `screens/IdeScreen.tsx` — url remote | `"url"` | `"https://github.com/org/repo.git"` |
| `screens/SettingsScreen.tsx` — nama agent token | `"mis. nama token (agent-ci)"` | `"mis. agent-ci"` |
| `screens/SettingsScreen.tsx` — Activity log project id | `"semua project"` | `"mis. hanoman — kosong = semua project"` |
| `screens/LeadScreen.tsx` — jawaban operator | `"Jawaban kamu — dikirim ke sesi bila panenya masih hidup"` | `"mis. pilih opsi 2, pakai Node 22"` |
| `screens/VpsScreen.tsx` — password SSH | `"untuk VPS yang belum punya key"` | `"••••••••"` |
| `screens/WebhooksPanel.tsx` — nama endpoint | `"Dashboard internal"` | `"mis. Dashboard internal"` |

Dan dua textarea kondisi goal — pertahankan penanda defaultnya, tambahkan contohnya.
`src/src/App.tsx` (picker Start):

```tsx
              placeholder={goalLocked
                ? "Kosong = goal backlog item ini · mis. semua fase tercatat & plan tanpa - [ ]"
                : "Kosong = kondisi bawaan hanoman · mis. semua fase tercatat & plan tanpa - [ ]"}
```

`src/src/screens/SettingsScreen.tsx` (kartu Mode goal):

```tsx
              placeholder="Kosong = kondisi bawaan hanoman · mis. semua fase tercatat & plan tanpa - [ ]"
```

- [x] **Step 5: Verify — kontrak HIJAU penuh**

```bash
pnpm --filter ./src typecheck
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/placeholder-contract.test.ts src/test/form-field-scanner.test.ts
```

Expected: **4 passed** di kontrak (nol pelanggaran), scanner PASS.

Lalu test render yang menyentuh berkas-berkas itu:

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run \
  src/test/public-help.test.tsx src/test/search-filter.test.tsx src/test/project-filter.test.tsx \
  src/test/session-history-modal.test.tsx src/test/git-graph-view.test.tsx src/test/prd-screen.test.tsx \
  src/test/lead-screen.test.tsx src/test/webhooks-panel.test.tsx src/test/agent-tokens.test.tsx \
  src/test/custom-agents-panel.test.tsx src/test/settings-goal.test.tsx src/test/ide-screen.test.tsx
```

Expected: semua PASS. Bila ada test yang mencari field lewat `getByPlaceholderText("…")` teks lama, **perbarui test-nya** ke teks baru — placeholder memang berubah; jangan mengembalikan teks lamanya.

- [x] **Step 6: Commit**

```bash
git add -u src/src
git commit -m "feat(490): placeholder jadi contoh nilai, bukan pengulangan label atau instruksi"
```

---

### Task 9: Docs Source of Truth

**Files:**
- Modify: `internal/docs/design-system/design-system.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`

**Interfaces:**
- Consumes: — · Produces: —

- [x] **Step 1: Aturan di design-system**

Tambahkan di akhir `internal/docs/design-system/design-system.md`:

```markdown
## Placeholder: contoh nilai, bukan pengulangan label (SPEC-490)

Label, hint, dan placeholder menjawab tiga pertanyaan berbeda — jangan salah satu
mengerjakan pekerjaan yang lain:

| elemen | menjawab |
|---|---|
| `Field label` / `aria-label` | *field ini apa* — **wajib**, tak pernah digantikan placeholder |
| `Field hint` | *aturannya apa* (opsional, batasan & konsekuensi) |
| `placeholder` | *isinya kelihatan seperti apa* |

1. Placeholder berisi **contoh nilai nyata**, diawali `mis. ` bila nilainya bebas
   (`mis. erp-tumbuh-ai`), atau **bentuk formatnya apa adanya** bila formatnya terikat
   (`~/.ssh/id_ed25519`, `https://github.com/org/repo.git`, `-1001234567890`, `22`,
   `••••••••`).
2. **Bukan** pengulangan label (`Cari backlog…` untuk label "Cari backlog") dan **bukan**
   instruksi (`Ceritakan apa yang terjadi…`). Instruksi tempatnya di `hint`.
3. Placeholder tak pernah menggantikan label — ia hilang begitu diketik.
4. Field yang nilainya **sudah ada** boleh memakai placeholder sebagai penanda keadaan
   (`••••1234`, `biarkan kosong = pertahankan`); itu lebih berguna daripada contoh.

**Berlaku untuk** input teks (termasuk `password`/`number`/`email`/`search`),
`textarea`/`HnTextarea`, dan kolom cari combobox (`MultiSelect.searchPlaceholder` —
`placeholder`-nya adalah label tombol, bukan petunjuk kolom).

**Di luar aturan, dengan alasan:** `<Select>` native (selalu menampilkan opsi terpilih;
keadaan belum-memilih dilayani opsi pertama yang eksplisit — `Pilih branch…`), `type="date"`
dan kerabatnya (browser **mengabaikan** `placeholder` dan merender widget bawaan), serta
checkbox/radio/file. Field yang sah tak punya placeholder ditandai di call site-nya:

    {/* placeholder-exempt: <alasan> */}

Ditegakkan `src/test/placeholder-contract.test.ts` — lihat
[frontend-implementation](../frontend/frontend-implementation.md).
```

- [x] **Step 2: Tempat penegakannya di frontend-implementation**

Tambahkan section baru di `internal/docs/frontend/frontend-implementation.md`, sesudah
section "Favicon (SPEC-147)":

```markdown
## Placeholder tiap field form (SPEC-490)

Aturan isinya ada di [design-system](../design-system/design-system.md). Yang menjaganya
tetap berlaku ada tiga lapis, karena ini bentuk "satu definisi, N call site" yang sudah
berulang di repo ini (SPEC-431/448/475/481):

1. **Katalog** untuk field yang dirender dari data — `ConfigEntry.example`
   (`shared/src/config-registry.ts`) menyetir **dua** panel Settings sekaligus (Config
   runtime + Kredensial Telegram, ~25 field lewat satu `<Input>`), dan
   `BRIEF_FIELDS`/`GOAL_FIELDS`/`QA_FIELDS` (`screens/BacklogScreen.tsx`) menyetir 3–5
   field detail spec lewat satu `<HnTextarea>`. Contohnya **tidak** ikut
   `ConfigEntryView`/`GET /api/config`: klien menghitungnya dari katalog yang memang sudah
   ter-bundle (`configEntry(key)`), jadi wire contract tak melebar untuk nilai presentasi —
   semangat ADR-0018.
2. **Call site** untuk sisanya.
3. **Kontrak** `src/test/placeholder-contract.test.ts` di atas scanner bersama
   `src/test/helpers/form-fields.ts`: memindai `src/src/**/*.tsx` non-test dan menolak
   field dalam scope yang tak punya placeholder, atau yang placeholder-nya identik dengan
   labelnya. Ia menegakkan atas **sumber**, bukan DOM — field tanpa placeholder terlihat
   persis seperti field yang belum diketik, jadi tak ada test render yang akan
   menangkapnya.

**Tiga gotcha scanner:** (a) isi komentar di-**blank** dulu — `<input>` yang hidup di dalam
prosa komentar memberi 5 positif palsu; (b) ujung tag pembuka dicari sebagai `>` di luar
`{…}` dan string, karena `onChange={(e) => …}` memuat `>`; (c) pemeriksaan "tak mengulang
label" hanya menyala saat placeholder **dan** namanya sama-sama literal statis — banyak
placeholder di sini ekspresi kondisional. Ia lantai, bukan seluruh aturan; sisanya editorial.
```

- [x] **Step 3: Verifikasi integritas index docs**

Kedua dokumen sudah ter-link di `internal/docs/README.md` (bagian `design-system` dan
`frontend`) — tak ada entri baru yang perlu ditambahkan. Buktikan:

```bash
grep -n "design-system/design-system.md\|frontend/frontend-implementation.md" internal/docs/README.md
```

Expected: dua baris cocok. Bila salah satu tak ada, tambahkan barisnya.

- [x] **Step 4: Commit**

```bash
git add internal/docs/design-system/design-system.md internal/docs/frontend/frontend-implementation.md
git commit -m "docs(490): aturan placeholder di design system + tempat penegakannya"
```

---

### Task 10: Verifikasi akhir

**Files:** — (tak ada perubahan; hanya pembuktian)

- [x] **Step 1: Seluruh test yang tersentuh perubahan ini**

```bash
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: semua PASS. **Pastikan jumlah berkas test yang berjalan > 0** — `--changed`
menyalakan `passWithNoTests`, jadi nol test terlihat hijau.

- [x] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./src typecheck
```

Expected: keluaran kosong, exit 0. (`server` tak disentuh — jangan `pnpm -r typecheck`.)

- [x] **Step 3: Bukti akhir dari kontraknya sendiri**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/placeholder-contract.test.ts --reporter=verbose
```

Expected: 4 test PASS, termasuk `benar-benar memindai field form` (bukti scanner tidak
memulangkan daftar kosong).

- [x] **Step 4: Centang plan & commit penutup**

Pastikan seluruh kotak `- [ ]` di berkas plan ini sudah `- [x]` (ADR-0029: `Execute done`
tak sah selama masih ada kotak kosong), lalu:

```bash
git add docs/superpowers/plans/2026-08-01-placeholder-contoh-nilai-spec-490.md
git commit -m "chore(490): centang plan + catatan pelaksanaan"
```

> **Boot server + curl tidak diperlukan.** Perubahan ini tak menyentuh satu pun endpoint,
> route, atau perilaku runtime server — `server/src` tidak diubah sama sekali.

---

## Catatan pelaksanaan (2026-08-01)

- **Baseline terukur 23, bukan 24.** Honeypot `hc_trap` keluar scope sendiri lewat deteksi
  `aria-hidden` **telanjang** yang lahir saat Task 1 (satu-satunya koreksi scanner: `hasAttr`
  menuntut `=`, sementara JSX menulis atribut boolean tanpa nilai). Komentar
  `placeholder-exempt`-nya tetap dipasang di Task 7 supaya alasannya terbaca di call site.
- **Turunnya persis seperti direncanakan:** 23 → 22 (Task 3) → 21 (Task 4) → 10 (Task 5) →
  2 (Task 6) → 0 (Task 7); 2 echo label ditutup Task 8. Kontrak **4/4 hijau**.
- **Task 8 memecahkan 3 test** yang memegang teks placeholder lewat `getByPlaceholderText`.
  Diperbaiki dengan memindahkannya ke `getByLabelText` — nama aksesibilitas adalah kontrak
  yang stabil, salinan placeholder bukan. Satu textarea (kondisi mode goal di Settings)
  memang **tak punya nama sama sekali** (`SettingRow` bukan `<label>`) → diberi `aria-label`.
- **Verifikasi akhir:** `vitest --changed <base> --no-file-parallelism` → **2533 lulus, 11
  gagal**, kesebelasnya terbukti **tak terkait** dengan membandingkan langsung ke
  `$HANOMAN_BASE_SHA` (`git checkout <base> -- src/src shared/src`, hasil identik):
  9 × `api.listBranches is not a function` (mock `api` parsial yang basi di
  `edit-project-gitremote` · `project-detail` · `project-help-center`), 1 × `GET /api/update`
  (bergantung jaringan), 1 × `review-download.route.test.ts` (lulus sendirian di HEAD **dan**
  di base — bergantung urutan pada run 290 berkas). Typecheck `shared` + `src` bersih.
  `prisma generate` perlu dijalankan sekali di worktree ini sebelum test server bisa dikoleksi
  (158 berkas gagal `@prisma/client did not initialize yet` sebelum itu) — bukan efek perubahan ini.
- **Boot server + curl dilewati dengan sengaja:** `server/src` tidak disentuh sama sekali;
  satu-satunya perubahan di luar `src/` adalah field presentasi `example?` di katalog
  `shared/src/config-registry.ts`, yang tak ikut respons API mana pun.
