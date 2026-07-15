# Clone existing dari GitHub/GitLab + set gitRemote saat edit (SPEC-218) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dari UI, user bisa menambah project "existing codebase" dengan clone dari URL GitHub/GitLab, dan menyetel `gitRemote` saat edit agar device lain bisa mendapatkan kode via `git clone`.

**Architecture:** Frontend-only. Merangkai endpoint backend yang sudah ada (SPEC-213/217): `POST /projects` (dengan `gitRemote`) → `POST /projects/:id/clone` (git clone + set `LocalBinding`), dan `PATCH /projects/:id` (set `gitRemote`). Tak ada perubahan skema, migration, ADR, endpoint, atau `client.ts` — `api.cloneProject` & `api.updateProject({gitRemote})` sudah ada. Perubahan hanya di `src/src/App.tsx` (dua modal + dua handler) dan `src/src/screens/ProjectDetailScreen.tsx` (tampil `gitRemote`).

**Tech Stack:** React 18 + TypeScript (Vite), design-system lokal (`../ds`), Vitest + @testing-library/react (jsdom). Server Fastify + Prisma (tak disentuh, hanya diuji via curl).

## Global Constraints

- TypeScript strict — semua field baru bertipe eksplisit.
- Tak ada perubahan skema/migration/ADR/endpoint backend baru (design SPEC-218).
- "Hapus gitRemote" cukup kirim string kosong `""` — endpoint clone cek `if (!project.gitRemote)` (falsy), jadi `""` berperilaku seperti "tak ada remote". Tak perlu ubah `zUpdateProject`.
- Makna "sync": **clone sekali** untuk mendapatkan checkout di device baru. Bukan auto-pull/push.
- Test web dijalankan dengan: `pnpm --filter ./src exec vitest run <path>`.
- Smoke API dijalankan dengan DB throwaway + `buildApp({ requireAuth: false })` (memori: jangan pakai `hanoman_test` untuk smoke; jangan port 8787 — ada dev sesi lain). Shell sesi bisa menunjuk prod → prefix `env -u NODE_ENV -u DATABASE_URL` untuk menjalankan test unit.
- Ikuti design system (editorial, bone paper, brass accent) — pakai komponen `../ds` yang sudah ada (`Tabs`, `Field`, `Input`, `Button`, `Modal`, `FolderPicker`). Jangan bikin komponen baru.

---

### Task 1: Create existing codebase via clone dari URL git

Menambah sub-toggle "Dari folder lokal / Clone dari URL git" di tab Existing pada `NewProjectModal`, dan mengorkestrasi `createProject` → `cloneProject` di handler `createProject`.

**Files:**
- Modify: `src/src/App.tsx` — `type ProjectForm` (baris 189), `NewProjectModal` (baris 190-249), handler `createProject` (baris 379-388)
- Test: `src/test/new-project-clone.test.tsx` (buat)

**Interfaces:**
- Consumes (sudah ada di `src/src/api/client.ts`):
  - `api.createProject(b: { name; kind; desc?; repoDir?; gitRemote? }) => Promise<ProjectView>`
  - `api.cloneProject(id: string, dir: string) => Promise<{ repoDir: string }>`
  - `api.getProject(id: string) => Promise<ProjectView>`
- Produces:
  - `type ProjectForm = { kind: string; mode: "local" | "clone"; name: string; desc: string; dir: string; gitRemote: string; objective: string }`
  - `NewProjectModal` submit clone mode berlabel teks **"Clone → reverse-engineer docs"**; sub-toggle berlabel **"Dari folder lokal"** dan **"Clone dari URL git"**; field URL berplaceholder **"https://github.com/org/repo.git"**.

- [ ] **Step 1: Tulis failing test** — `src/test/new-project-clone.test.tsx`

```tsx
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const CREATED = {
  id: "repo", name: "repo", desc: "", kind: "existing", repoDir: null, binding: null,
  gitRemote: "https://github.com/org/repo.git", stack: "", docStatus: "broken", coverage: 0,
  createdAt: "", backlog: 0, topStage: "spec", activity: "idle", commit: "",
  session: { status: "idle", phase: null, flow: null },
};

vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    createProject: vi.fn(async () => CREATED),
    cloneProject: vi.fn(async () => ({ repoDir: "/tmp/clone" })),
    getProject: vi.fn(async () => ({ ...CREATED, binding: "/tmp/clone" })),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("create existing via clone (SPEC-218)", () => {
  it("mode clone memanggil createProject(gitRemote, tanpa repoDir) lalu cloneProject(dir)", async () => {
    const { api } = await import("../src/api/client");
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(await screen.findByText("Project baru"));
    fireEvent.click(await screen.findByText("Existing codebase"));
    fireEvent.click(await screen.findByText("Clone dari URL git"));
    fireEvent.change(await screen.findByPlaceholderText("https://github.com/org/repo.git"),
      { target: { value: "https://github.com/org/repo.git" } });
    fireEvent.change(screen.getByPlaceholderText("/path/ke/repo"), { target: { value: "/tmp/clone" } });
    fireEvent.click(screen.getByText("Clone → reverse-engineer docs"));
    await waitFor(() => expect((api.cloneProject as any)).toHaveBeenCalledWith("repo", "/tmp/clone"));
    const arg = (api.createProject as any).mock.calls[0][0];
    expect(arg).toMatchObject({ kind: "existing", gitRemote: "https://github.com/org/repo.git" });
    expect(arg.repoDir).toBeUndefined();
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/new-project-clone.test.tsx`
Expected: FAIL — sub-toggle "Clone dari URL git" belum ada (`findByText` timeout) / `cloneProject` tak terpanggil.

- [ ] **Step 3: Perbarui `type ProjectForm`** (baris 189)

Ganti:
```tsx
type ProjectForm = { kind: string; name: string; desc: string; dir: string; objective: string };
```
menjadi:
```tsx
type ProjectForm = { kind: string; mode: "local" | "clone"; name: string; desc: string; dir: string; gitRemote: string; objective: string };
```

- [ ] **Step 4: Ganti `NewProjectModal`** (seluruh fungsi, baris 190-249)

```tsx
function NewProjectModal({ open, onClose, onCreate }:
  { open: boolean; onClose: () => void; onCreate: (f: ProjectForm) => void | Promise<void> }) {
  const blank: ProjectForm = { kind: "from-scratch", mode: "local", name: "", desc: "", dir: "", gitRemote: "", objective: "" };
  const [f, setF] = React.useState<ProjectForm>(blank);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setF(blank); setBusy(false); } }, [open]);
  const set = (k: keyof ProjectForm) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const scratch = f.kind === "from-scratch";
  const clone = !scratch && f.mode === "clone";
  // SPEC-217/218 · path opsional (mode lokal): nama ATAU dir. Mode clone: URL + folder tujuan wajib.
  const canSubmit = scratch ? !!f.name.trim()
    : clone ? (!!f.gitRemote.trim() && !!f.dir.trim())
    : (!!f.name.trim() || !!f.dir.trim());
  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try { await onCreate(f); } finally { setBusy(false); }
  };
  const [picker, setPicker] = React.useState(false);
  const submitLabel = scratch ? "Buat → brainstorm objective"
    : clone ? (busy ? "Meng-clone…" : "Clone → reverse-engineer docs")
    : "Tambah → reverse-engineer docs";
  return (
    <Modal open={open} onClose={onClose} icon="box" eyebrow="workspace" title="Project baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
        <Button size="sm" leftIcon={scratch ? "messages-square" : clone ? "git-branch" : "radar"}
          onClick={submit} disabled={!canSubmit || busy}>{submitLabel}</Button>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <Tabs variant="pill" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} tabs={[
          { value: "from-scratch", label: "From scratch", icon: "sparkles" },
          { value: "existing", label: "Existing codebase", icon: "folder-git-2" },
        ]} />
        <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          {scratch ? "hanoman brainstorm sampai MVP objective terkunci, lalu scaffold seluruh doc index sebagai Source of Truth."
            : "hanoman reverse-engineer docs dari codebase yang ada, lalu menyusun Source of Truth-nya."}
        </div>
      </div>
      {scratch ? (
        <>
          <Field label="Nama project" hint="lowercase, tanpa spasi">
            <Input value={f.name} onChange={set("name")} placeholder="mis. kirana" style={{ width: "100%" }} />
          </Field>
          <Field label="Deskripsi">
            <Input value={f.desc} onChange={set("desc")} placeholder="mis. Marketplace jasa lokal" style={{ width: "100%" }} />
          </Field>
          <Field label="Ide awal" hint="opsional — bahan brainstorm objective">
            <HnTextarea value={f.objective} onChange={set("objective")} rows={2} placeholder="Tuang ide di sini…" />
          </Field>
        </>
      ) : (
        <>
          {/* SPEC-218 · dua cara menambah existing: folder lokal, atau clone dari URL git. */}
          <div style={{ marginBottom: 12 }}>
            <Tabs variant="pill" value={f.mode} onChange={(v) => setF((s) => ({ ...s, mode: v as "local" | "clone" }))} tabs={[
              { value: "local", label: "Dari folder lokal", icon: "folder" },
              { value: "clone", label: "Clone dari URL git", icon: "git-branch" },
            ]} />
          </div>
          {clone ? (
            <Field label="URL repository" hint="GitHub/GitLab · https atau ssh">
              <Input value={f.gitRemote} onChange={set("gitRemote")} leftIcon="git-branch" mono
                placeholder="https://github.com/org/repo.git" style={{ width: "100%" }} />
            </Field>
          ) : null}
          <Field label={clone ? "Folder tujuan clone" : "Direktori"}
            hint={clone ? "path lokal tempat repo di-clone (mesin ini)" : "opsional · path checkout lokal (bisa diedit belakangan per-mesin)"}>
            <div style={{ display: "flex", gap: 8 }}>
              <Input value={f.dir} onChange={set("dir")} leftIcon="folder" mono placeholder="/path/ke/repo" style={{ flex: 1 }} />
              <Button size="sm" variant="secondary" leftIcon="folder-open" onClick={() => setPicker(true)}>Pilih folder</Button>
            </div>
          </Field>
          <FolderPicker open={picker} onClose={() => setPicker(false)}
            start={f.dir} onPick={(p) => setF((s) => ({ ...s, dir: p }))} />
          <Field label="Deskripsi" hint="opsional">
            <Input value={f.desc} onChange={set("desc")} placeholder="mis. POS ritel + inventori" style={{ width: "100%" }} />
          </Field>
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 5: Ganti handler `createProject`** (baris 379-388)

```tsx
  async function createProject(f: ProjectForm) {
    const scratch = f.kind === "from-scratch";
    const clone = !scratch && f.mode === "clone";
    // SPEC-218 · mode clone: turunkan nama dari basename URL bila user tak isi (buang .git & host).
    const fromUrl = f.gitRemote.trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "repo";
    const name = f.name.trim() || (clone ? fromUrl : (f.dir.split("/").filter(Boolean).pop() || "repo"));
    let created;
    try {
      created = await api.createProject({
        name, kind: f.kind, desc: f.desc.trim(),
        repoDir: scratch || clone ? undefined : f.dir,
        gitRemote: clone ? f.gitRemote.trim() : undefined,
      });
    } catch { showToast("Gagal membuat project", "err", "x-circle"); return; }
    // SPEC-218 · project sudah ada; clone di jalur terpisah agar gagal-clone tak menghapus project
    // (remote tersimpan → bisa clone ulang dari Edit). AC-8.
    if (clone) {
      try {
        await api.cloneProject(created.id, f.dir.trim());
        created = await api.getProject(created.id);   // binding hasil clone
      } catch (e) {
        const detail = e instanceof ApiError ? ` · ${e.message}` : "";
        setProjects((list) => [created!, ...list]);
        setProjectId(created.id); setModal(null); setSection("project");
        showToast(`Project ${created.id} dibuat, tapi clone gagal${detail} · clone ulang dari Edit`, "warn", "git-branch");
        return;
      }
    }
    setProjects((list) => [created!, ...list]);
    setProjectId(created.id); setModal(null); setSection("docs");
    showToast("Project " + created.id + " dibuat · " + (scratch ? "mulai brainstorm objective" : "reverse-engineer docs"), "ok", "box");
  }
```

- [ ] **Step 6: Jalankan test — pastikan lulus**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/new-project-clone.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0 (tak ada error tipe dari field `mode`/`gitRemote` baru).

- [ ] **Step 8: Commit**

```bash
git add src/src/App.tsx src/test/new-project-clone.test.tsx
git commit -m "feat(web): create existing via clone dari GitHub/GitLab (SPEC-218 AC-1/2/3/4/9)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Edit project — field "Git remote" + tampil di detail

Menambah field `gitRemote` di `EditProjectModal`, meneruskannya di handler `updateProject`, dan menampilkan `gitRemote` di `ProjectDetailScreen`.

**Files:**
- Modify: `src/src/App.tsx` — `EditProjectModal` (baris 251-282), handler `updateProject` (baris 363-377), pemanggilan `<EditProjectModal ... onSave={updateProject} />` (baris 673, hanya bila tipe berubah — lihat Step)
- Modify: `src/src/screens/ProjectDetailScreen.tsx` — grid Meta (baris 60-66)
- Test: `src/test/edit-project-gitremote.test.tsx` (buat)

**Interfaces:**
- Consumes: `api.updateProject(id, { name?; desc?; gitRemote?; repoDir? }) => Promise<ProjectView>` (sudah ada), `ProjectVM.gitRemote: string | null` (dari `ProjectView`).
- Produces: `EditProjectModal` `onSave` payload = `{ name: string; desc: string; dir: string; gitRemote: string }`; field Git remote berplaceholder **"https://github.com/org/repo.git"**; `ProjectDetailScreen` merender Meta label **"Git remote"**.

- [ ] **Step 1: Tulis failing test** — `src/test/edit-project-gitremote.test.tsx`

```tsx
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { vi } from "vitest";

const PROJECT = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: "/repo/arta",
  binding: null, gitRemote: null, stack: "ts", docStatus: "ok", coverage: 100,
  createdAt: "2026-07-10T00:00:00.000Z", backlog: 1, topStage: "planned", activity: "idle",
  commit: "belum ada commit", session: { status: "idle", phase: null, flow: null },
};

vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [PROJECT], total: 1, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    updateProject: vi.fn(async (_id: string, b: any) => ({ ...PROJECT, ...b })),
    getProject: vi.fn(async () => ({ ...PROJECT, gitRemote: "https://github.com/org/repo.git" })),
    putBinding: vi.fn(async () => ({ repoDir: "/tmp/x" })),
    deleteBinding: vi.fn(async () => {}),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

async function openEdit() {
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByText("Projects")[0]!);
  fireEvent.click(screen.getAllByText("arta")[0]!);
  fireEvent.click(await screen.findByText("Edit project"));
}

describe("edit project git remote (SPEC-218)", () => {
  it("menyimpan gitRemote lewat updateProject", async () => {
    const { api } = await import("../src/api/client");
    await openEdit();
    fireEvent.change(await screen.findByPlaceholderText("https://github.com/org/repo.git"),
      { target: { value: "https://github.com/org/repo.git" } });
    fireEvent.click(screen.getByText("Simpan"));
    await waitFor(() => expect((api.updateProject as any)).toHaveBeenCalledWith("arta",
      expect.objectContaining({ gitRemote: "https://github.com/org/repo.git" })));
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/edit-project-gitremote.test.tsx`
Expected: FAIL — field "Git remote" belum ada (`findByPlaceholderText` timeout).

- [ ] **Step 3: Perbarui `EditProjectModal`** (baris 251-282)

Ubah signature `onSave` dan state agar memuat `gitRemote`, lalu tambah field. Ganti baris 251-258 (deklarasi + state + effect):
```tsx
function EditProjectModal({ open, project, onClose, onSave }:
  { open: boolean; project?: ProjectVM; onClose: () => void; onSave: (f: { name: string; desc: string; dir: string; gitRemote: string }) => void }) {
  // SPEC-217 · `dir` = override path per-mesin (LocalBinding, tak disync).
  // SPEC-218 · `gitRemote` = remote resmi (disync) agar device lain bisa clone.
  const [f, setF] = React.useState({ name: "", desc: "", dir: "", gitRemote: "" });
  React.useEffect(() => {
    if (open && project) setF({ name: project.name, desc: project.desc, dir: project.binding ?? "", gitRemote: project.gitRemote ?? "" });
  }, [open, project]);
```
Lalu tambahkan field baru tepat setelah field "Path (mesin ini)" (setelah baris 279, sebelum `</Modal>`):
```tsx
      <Field label="Git remote" hint="opsional · remote resmi agar device lain bisa clone project ini · disync antar-device">
        <Input value={f.gitRemote} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, gitRemote: e.target.value }))}
          leftIcon="git-branch" mono placeholder="https://github.com/org/repo.git" style={{ width: "100%" }} />
      </Field>
```

- [ ] **Step 4: Perbarui handler `updateProject`** (baris 363-377)

Ganti signature dan tambahkan `gitRemote` ke payload PATCH:
```tsx
  async function updateProject(f: { name: string; desc: string; dir: string; gitRemote: string }) {
    if (!proj) return;
    try {
      // SPEC-218 · gitRemote disync; "" = kosongkan (endpoint clone cek `!gitRemote`, falsy).
      await api.updateProject(proj.id, { name: f.name.trim(), desc: f.desc.trim(), gitRemote: f.gitRemote.trim() });
      // SPEC-217 · path per-mesin lewat binding (tak disync). Set bila berubah; kosong = hapus override.
      const dir = f.dir.trim();
      if (dir !== (proj.binding ?? "")) {
        if (dir) await api.putBinding(proj.id, dir); else await api.deleteBinding(proj.id);
      }
      const fresh = await api.getProject(proj.id);   // view segar (binding + gitRemote + coverage terbarui)
      setProjects((list) => list.map((x) => (x.id === fresh.id ? fresh : x)));
      setModal(null);
      showToast("Project " + fresh.name + " diperbarui", "ok", "box");
    } catch { showToast("Gagal memperbarui project", "err", "x-circle"); }
  }
```

- [ ] **Step 5: Jalankan test edit — pastikan lulus**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/edit-project-gitremote.test.tsx`
Expected: PASS.

- [ ] **Step 6: Tulis failing test tampilan detail** — tambahkan ke `src/test/edit-project-gitremote.test.tsx` (di dalam `describe`)

```tsx
  it("detail project menampilkan gitRemote", async () => {
    const { api } = await import("../src/api/client");
    (api.listProjects as any).mockResolvedValueOnce(
      { items: [{ ...PROJECT, gitRemote: "https://github.com/org/repo.git" }], total: 1, page: 1, pageSize: 20 });
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(screen.getAllByText("arta")[0]!);
    expect(await screen.findByText("Git remote")).toBeInTheDocument();
    expect(await screen.findByText("https://github.com/org/repo.git")).toBeInTheDocument();
  });
```

- [ ] **Step 7: Jalankan — pastikan gagal** (label "Git remote" belum dirender di detail)

Run: `pnpm --filter ./src exec vitest run test/edit-project-gitremote.test.tsx -t "menampilkan gitRemote"`
Expected: FAIL.

- [ ] **Step 8: Tambah Meta gitRemote di `ProjectDetailScreen.tsx`** (grid baris 60-66)

Sisipkan Meta baru tepat setelah Meta "Repo" (setelah baris 63):
```tsx
          {/* SPEC-218 · remote resmi untuk clone di device lain (— bila belum diset). */}
          <Meta label="Git remote" value={p.gitRemote || "—"} mono />
```
(Grid `repeat(4, 1fr)` kini memuat 5 Meta — item ke-5 membungkus ke baris berikut; ini oke secara visual.)

- [ ] **Step 9: Jalankan seluruh test file — pastikan lulus**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/edit-project-gitremote.test.tsx`
Expected: PASS (2 test).

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/src/App.tsx src/src/screens/ProjectDetailScreen.tsx src/test/edit-project-gitremote.test.tsx
git commit -m "feat(web): edit project set gitRemote + tampil di detail (SPEC-218 AC-5/6/7)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verifikasi end-to-end via curl (server nyata) + regresi

Membuktikan alur create→clone→bind dan PATCH gitRemote bekerja terhadap server yang benar-benar boot (CLAUDE.md: test API nyata, bukan hanya unit test). Clone memakai repo lokal `file://` agar tak butuh jaringan.

**Files:**
- Create (throwaway, di scratchpad): `/private/tmp/claude-501/-Users-denameidina-Documents-Nafanesia-hanoman/afbaf933-0d68-4ab9-a0c7-da12c40965cb/scratchpad/boot-smoke.ts`
- No product code changes.

- [ ] **Step 1: Siapkan repo sumber throwaway + folder tujuan**

```bash
SP=/private/tmp/claude-501/-Users-denameidina-Documents-Nafanesia-hanoman/afbaf933-0d68-4ab9-a0c7-da12c40965cb/scratchpad
rm -rf "$SP/src-repo" "$SP/clone-target"
mkdir -p "$SP/src-repo"
git -C "$SP/src-repo" init -q
printf "# demo\n" > "$SP/src-repo/README.md"
git -C "$SP/src-repo" add -A
git -C "$SP/src-repo" -c user.email=t@t -c user.name=t commit -qm init
echo "src repo siap: $SP/src-repo"
```

- [ ] **Step 2: Siapkan DB throwaway + migrate**

```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'DROP DATABASE IF EXISTS spec218_smoke' 2>/dev/null || true
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE spec218_smoke'
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/spec218_smoke' \
  pnpm --filter ./server exec prisma migrate deploy
```
Expected: "All migrations have been applied".

- [ ] **Step 3: Tulis boot script auth-off** — `scratchpad/boot-smoke.ts`

```ts
import { buildApp } from "../../../../server/src/app";
const app = buildApp({ requireAuth: false });
app.listen({ port: 8799, host: "127.0.0.1" }).then(() => console.log("smoke up :8799"));
```
(Path relatif dari scratchpad ke `server/src/app.ts`; sesuaikan bila struktur berbeda — `buildApp` diekspor di `server/src/app.ts:39`.)

- [ ] **Step 4: Boot server smoke (background)**

```bash
SP=/private/tmp/claude-501/-Users-denameidina-Documents-Nafanesia-hanoman/afbaf933-0d68-4ab9-a0c7-da12c40965cb/scratchpad
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/spec218_smoke' PORT=8799 \
  pnpm --filter ./server exec tsx "$SP/boot-smoke.ts"
```
Jalankan sebagai background process. Tunggu log "smoke up :8799". (Port 8799 sengaja bukan 8787 — memori: dev sesi lain di 8787.)

- [ ] **Step 5: curl create (gitRemote) → clone → binding**

```bash
SP=/private/tmp/claude-501/-Users-denameidina-Documents-Nafanesia-hanoman/afbaf933-0d68-4ab9-a0c7-da12c40965cb/scratchpad
# create existing dgn gitRemote file://, tanpa repoDir
curl -sS -X POST localhost:8799/api/projects -H 'content-type: application/json' \
  -d "{\"name\":\"demo\",\"kind\":\"existing\",\"gitRemote\":\"file://$SP/src-repo\"}" | tee /tmp/p.json
# clone ke folder tujuan → set binding
curl -sS -X POST localhost:8799/api/projects/demo/clone -H 'content-type: application/json' \
  -d "{\"dir\":\"$SP/clone-target\"}" | tee /tmp/clone.json
# binding harus = folder tujuan
curl -sS localhost:8799/api/projects/demo/binding
```
Expected: create → 201 dgn `"gitRemote":"file://…/src-repo"`, `"repoDir":null`; clone → 201 `{"repoDir":".../clone-target"}`; binding → `{"repoDir":".../clone-target"}`; dan `ls "$SP/clone-target/README.md"` ada (clone benar-benar terjadi).

- [ ] **Step 6: curl PATCH gitRemote (edit) + kosongkan**

```bash
curl -sS -X PATCH localhost:8799/api/projects/demo -H 'content-type: application/json' \
  -d '{"gitRemote":"https://github.com/org/lain.git"}' | tee /tmp/patch.json
# kosongkan → "" berperilaku seperti tak ada remote (clone akan 409)
curl -sS -X PATCH localhost:8799/api/projects/demo -H 'content-type: application/json' -d '{"gitRemote":""}'
curl -sS -o /dev/null -w "%{http_code}\n" -X POST localhost:8799/api/projects/demo/clone \
  -H 'content-type: application/json' -d "{\"dir\":\"$SP/x2\"}"
```
Expected: PATCH → 200 dgn gitRemote baru; setelah dikosongkan, clone → `409` (`"tidak punya gitRemote untuk clone"`) — membuktikan `""` = kosong. **AC-6/AC-8**.

- [ ] **Step 7: Bersihkan**

```bash
# hentikan proses smoke (background), lalu:
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'DROP DATABASE IF EXISTS spec218_smoke'
```

- [ ] **Step 8: Regresi test web penuh + centang plan**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test`
Expected: seluruh test web PASS (termasuk `project-detail.test.tsx`, `client-binding.test.ts` lama tak regres).
Lalu centang seluruh `- [ ]` → `- [x]` di plan ini.

- [ ] **Step 9: Commit dokumentasi plan**

```bash
git add docs/superpowers/plans/2026-07-15-clone-repo-git-sync-spec-218.md
git commit -m "docs(plan): SPEC-218 selesai — clone existing + set gitRemote (verifikasi curl hijau)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage vs SPEC-218 ACs:**
- AC-1 (create by clone: create+clone) → Task 1 Step 5 (createProject→cloneProject), diuji Task 1 Step 1 + Task 3 Step 5. ✓
- AC-2 (clone → bind) → perilaku endpoint; diverifikasi Task 3 Step 5 (binding = folder tujuan). ✓
- AC-3 (nama dari URL) → Task 1 Step 5 (`fromUrl`). ✓
- AC-4 (mode lokal tak berubah) → Task 1 Step 5 (`repoDir: … : f.dir`, clone tak dipanggil); regresi Task 3 Step 8. ✓
- AC-5 (edit set gitRemote) → Task 2 Step 4, diuji Step 1. ✓
- AC-6 (edit hapus gitRemote) → Task 2 Step 4 (`.trim()`, "" falsy); diverifikasi Task 3 Step 6 (clone→409). ✓
- AC-7 (remote terlihat) → Task 2 Step 8 (Meta), diuji Step 6. ✓
- AC-8 (clone gagal → tak yatim, tak crash) → Task 1 Step 5 (jalur catch mempertahankan project + toast). ✓
- AC-9 (submit gating + loading) → Task 1 Step 4 (`canSubmit`, `busy`, `disabled`). ✓

**Placeholder scan:** Tak ada TBD/TODO; semua step memuat kode/perintah + expected output. ✓

**Type consistency:** `ProjectForm` (mode/gitRemote) konsisten dipakai di `NewProjectModal` & `createProject`. `EditProjectModal.onSave` payload `{name,desc,dir,gitRemote}` cocok dengan `updateProject` param. `api.cloneProject(id,dir)`, `api.updateProject(id,{gitRemote})`, `p.gitRemote` sesuai tipe `ProjectView` yang ada. ✓
