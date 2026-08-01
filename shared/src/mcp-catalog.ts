// SPEC-482 · ADR-0099 · katalog tool MCP hanoman. Data murni: dipakai runtime MCP di CLI DAN
// panel Settings di web, jadi daftar capability yang harus dicentang manusia tak bisa drift dari
// yang benar-benar dituntut tool.
import {
  DATE_PARAMS, PAGE_PARAMS, PRIORITY, SOURCE_ENUM, SOURCE_PAYLOAD_ALLOF, SPEC_PAYLOAD_ONEOF,
  STAGE_ENUM, bool, enumStr, obj, str, strArray, type JsonSchemaObject,
} from "./mcp-schema";
import {
  paginateLocal, shapeGithubIssue, shapeLeadDecision, shapeNotification, shapeProject,
  shapeProjectDetail, shapeSession, shapeSpec, shapeSpecDetail, shapeTicket,
} from "./mcp-shape";

export type McpMode = "read" | "write";
export type McpRequest = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

type Args = Record<string, unknown>;

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  mode: McpMode;
  /** Capability REST yang dituntut. `null` = tool ini tak memanggil `/api` sama sekali. */
  capability: string | null;
  /** Path CONTOH (tanpa `/api`) untuk uji kontrak terhadap `capabilityForRoute`. */
  samplePath: string;
  /** Method contoh, dipakai uji kontrak yang sama. */
  sampleMethod: "GET" | "POST" | "PATCH";
  build(args: Args): McpRequest | null;
  shape(raw: unknown, args: Args): unknown;
};

const s = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const enc = encodeURIComponent;

/** Query dari argumen: hanya yang terisi ikut. `undefined` tak pernah jadi string "undefined". */
function query(pairs: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) if (v !== undefined) out[k] = v;
  return out;
}

/** Amplop daftar dari server (`{items,total,page,pageSize}`) → item dipadatkan, amplop dijaga. */
function reshapePage(raw: unknown, fn: (r: Record<string, unknown>) => unknown): unknown {
  const p = raw as { items?: unknown[] };
  if (!Array.isArray(p?.items)) return raw;
  return { ...(raw as object), items: p.items.map((i) => fn(i as Record<string, unknown>)) };
}

/** Daftar mentah (`{items:[…]}` tanpa paginasi server) → dipadatkan lalu dipaginasi di wrapper. */
function localPage(
  raw: unknown,
  a: Args,
  fn: (r: Record<string, unknown>) => unknown,
  extra?: (raw: Record<string, unknown>) => object,
): unknown {
  const items = Array.isArray((raw as { items?: unknown[] })?.items)
    ? (raw as { items: unknown[] }).items
    : Array.isArray(raw) ? (raw as unknown[]) : [];
  return {
    ...paginateLocal(items.map((i) => fn(i as Record<string, unknown>)), n(a.page), n(a.limit)),
    ...(extra?.((raw ?? {}) as Record<string, unknown>) ?? {}),
  };
}

const ID_HINT = "Id backlog, mis. `SPEC-482` (huruf besar, dengan tanda hubung).";

export const MCP_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_about",
    title: "Tentang sambungan ini",
    description:
      "Instance hanoman mana yang sedang tersambung, versi skema tool, mode (baca-tulis / baca-saja), dan daftar tool yang aktif. Panggil ini lebih dulu bila ada tool yang menjawab 401 atau 403 — jawabannya menyebut host yang dipakai. Tool ini tak butuh token dan tak pernah menampilkan token.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/health", sampleMethod: "GET",
    build: () => null,
    shape: (raw) => raw,
  },
  {
    name: "hanoman_projects_list",
    title: "Daftar proyek",
    description:
      "Daftar seluruh proyek yang dikelola hanoman, dipadatkan ke field yang dipakai agen: id, nama, jenis, jumlah backlog, stage tertinggi, coverage docs, dan opt-in scheduler/lead. Untuk detail satu proyek pakai hanoman_project_get.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "projects:read", samplePath: "/projects", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/projects" }),
    shape: (raw, a) => localPage(raw, a, shapeProject),
  },
  {
    name: "hanoman_project_get",
    title: "Detail proyek",
    description:
      "Detail satu proyek: stack, remote git, status & coverage docs, ringkasan sesi berjalan, aktivitas terakhir, dan opt-in scheduler/lead. Path repo per-mesin sengaja tidak dikembalikan.",
    inputSchema: obj({
      properties: { project: str("Id proyek (slug huruf kecil), mis. `hanoman`. Ambil dari hanoman_projects_list.") },
      required: ["project"],
    }),
    mode: "read", capability: "projects:read", samplePath: "/projects/hanoman", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}` }),
    shape: (raw) => shapeProjectDetail((raw ?? {}) as Record<string, unknown>),
  },
  {
    name: "hanoman_backlog_search",
    title: "Cari backlog",
    description:
      "Cari & saring backlog lintas proyek. Stage yang dikembalikan sudah stage LIVE (diturunkan dari sesi berjalan), bukan nilai basi di database — tak perlu memanggil apa pun untuk menyegarkannya. Balasannya ringkas: `objective` dipotong 200 karakter dan `payload` tidak ikut; pakai hanoman_backlog_get untuk isi penuh satu item.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Tanpa ini, pencarian mencakup SEMUA proyek."),
        source: enumStr(SOURCE_ENUM, "Asal item. `cross-audit` sudah tidak ada."),
        stage: enumStr(STAGE_ENUM, "Stage live yang dicocokkan persis."),
        priority: PRIORITY,
        startable: bool("true = hanya item yang belum selesai (stage bukan `done`). false / tak diisi = semua item."),
        q: str("Substring, tanpa peduli huruf besar-kecil, dicocokkan ke `id + title + objective` saja. TIDAK menyentuh isi `payload` — kata yang hanya ada di konteks/outcome tak akan ketemu."),
        ...DATE_PARAMS,
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "backlog:read", samplePath: "/specs", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/specs",
      query: query({
        project: s(a.project), source: s(a.source), stage: s(a.stage), priority: s(a.priority),
        // Jebakan yang ditutup di sini: server hanya melihat string "true"; nilai lain diabaikan
        // SENYAP dan mengembalikan SELURUH backlog termasuk yang `done`. Skema tool memakai
        // boolean, dan `false` MENGHILANGKAN parameternya alih-alih mengirim "false".
        startable: a.startable === true ? "true" : undefined,
        q: s(a.q), dateField: s(a.dateField), from: s(a.from), to: s(a.to),
        page: n(a.page) === undefined ? undefined : String(n(a.page)),
        limit: n(a.limit) === undefined ? undefined : String(n(a.limit)),
      }),
    }),
    shape: (raw) => reshapePage(raw, shapeSpec),
  },
  {
    name: "hanoman_backlog_get",
    title: "Detail backlog",
    description:
      "Isi lengkap satu backlog item termasuk `payload`, `baseSha`/`headSha`, dan penanda `editable` (masih boleh diubah bila stage `brainstorming` dan belum pernah punya sesi).",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read", samplePath: "/specs", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/specs", query: { q: String(a.spec), limit: "100" } }),
    // REST tak punya `GET /specs/:id`; `q` adalah SUBSTRING, jadi `SPEC-48` mengembalikan
    // SPEC-480…489. Pencocokan persis dilakukan di sini, bukan dipercayakan ke server.
    shape: (raw, a) => {
      const want = String(a.spec).trim().toLowerCase();
      const items = ((raw as { items?: unknown[] })?.items ?? []) as Record<string, unknown>[];
      const hit = items.find((i) => String(i.id).toLowerCase() === want);
      return hit
        ? shapeSpecDetail(hit)
        : { error: `backlog "${String(a.spec)}" tidak ada. Cek ejaannya (bentuknya SPEC-nnn) atau cari dengan hanoman_backlog_search.` };
    },
  },
  {
    name: "hanoman_backlog_docs_list",
    title: "Dokumen hasil sesi",
    description:
      "Daftar dokumen yang dihasilkan sesi backlog ini (design doc, plan, laporan audit). Sumbernya freshest-wins: worktree sesi yang masih hidup menang atas checkout proyek. Isi berkasnya dibaca dengan hanoman_backlog_doc_read.",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read", samplePath: "/specs/SPEC-1/docs", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/specs/${enc(String(a.spec))}/docs` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_doc_read",
    title: "Baca dokumen sesi",
    description:
      "Isi satu dokumen hasil sesi. `path` adalah jalur relatif yang persis seperti muncul di hanoman_backlog_docs_list. Balasan panjang dipotong pada plafon byte dan ditandai `truncated`.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        path: str("Jalur relatif dokumen, mis. `docs/superpowers/plans/2026-08-01-x.md`. Salin apa adanya dari hanoman_backlog_docs_list."),
      },
      required: ["spec", "path"],
    }),
    mode: "read", capability: "backlog:read", samplePath: "/specs/SPEC-1/docs/a.md", sampleMethod: "GET",
    build: (a) => ({
      method: "GET",
      path: `/specs/${enc(String(a.spec))}/docs/${String(a.path).split("/").map(enc).join("/")}`,
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_sessions_list",
    title: "Sesi berjalan",
    description:
      "Sesi agen yang hidup sekarang (sumber kebenarannya tmux, bukan database). `exited: true` berarti prosesnya sudah mati — `exitCode` bukan 0 berarti gagal. Tool ini hanya MEMBACA; membuat sesi baru tidak tersedia lewat MCP.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "sessions:read", samplePath: "/terminal/sessions", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/terminal/sessions" }),
    shape: (raw, a) => localPage(raw, a, shapeSession),
  },
  {
    name: "hanoman_notifications_list",
    title: "Notifikasi",
    description:
      "Notifikasi terbaru (50 teratas dari server) berikut jumlah yang belum dibaca. `type`: `done` (backlog selesai), `decision` (sesi menunggu jawaban manusia), `ticket`, `fail`, `lead`.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "notifications:read", samplePath: "/notifications", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/notifications" }),
    shape: (raw, a) => localPage(raw, a, shapeNotification, (r) => ({ unread: r.unread ?? 0 })),
  },
  {
    name: "hanoman_tickets_list",
    title: "Tiket Help Center",
    description:
      "Tiket yang masuk lewat Help Center publik. `status`: `new` (belum ditriase), `accepted` (sudah jadi backlog — lihat `specId`), `rejected`.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Tanpa ini, seluruh proyek."),
        status: enumStr(["new", "accepted", "rejected"], "Status triase."),
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "support:read", samplePath: "/tickets", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/tickets", query: query({ project: s(a.project), status: s(a.status) }) }),
    shape: (raw, a) => localPage(raw, a, shapeTicket),
  },
  {
    name: "hanoman_ticket_get",
    title: "Detail tiket",
    description: "Isi lengkap satu tiket Help Center berikut daftar lampirannya.",
    inputSchema: obj({ properties: { ticket: str("Id tiket, seperti muncul di hanoman_tickets_list.") }, required: ["ticket"] }),
    mode: "read", capability: "support:read", samplePath: "/tickets/t1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/tickets/${enc(String(a.ticket))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_github_issues_list",
    title: "Issue GitHub yang sudah ditarik",
    description:
      "Issue GitHub yang SUDAH ditarik ke hanoman untuk ditriase (record lokal, bukan panggilan langsung ke GitHub — daftarnya sesegar tarikan terakhir). Pull request tidak pernah ikut. Menarik ulang dari GitHub adalah tindakan manusia di dashboard.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        status: enumStr(["new", "accepted", "rejected"], "Status triase di hanoman (bukan status di GitHub — itu `issueState`)."),
        ...PAGE_PARAMS,
      },
      required: ["project"],
    }),
    mode: "read", capability: "support:read", samplePath: "/projects/hanoman/github/issues", sampleMethod: "GET",
    build: (a) => ({
      method: "GET",
      path: `/projects/${enc(String(a.project))}/github/issues`,
      query: query({ status: s(a.status) }),
    }),
    shape: (raw, a) => localPage(raw, a, shapeGithubIssue),
  },
  {
    name: "hanoman_lead_decisions_list",
    title: "Jejak keputusan hanoman-lead",
    description:
      "Jejak keputusan hanoman-lead, terbaru dulu. `status`: `berlaku`, `gagal`, `ditimpa`, `dibatalkan`. `confidence: ragu` berarti lead memutuskan tapi memilih opsi yang paling mudah dibatalkan.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        spec: str("Id backlog, mis. `SPEC-482`."),
        status: str("Status keputusan: `berlaku`, `gagal`, `ditimpa`, atau `dibatalkan`."),
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "lead:read", samplePath: "/lead/decisions", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/lead/decisions",
      query: query({ projectId: s(a.project), specId: s(a.spec), status: s(a.status) }),
    }),
    shape: (raw, a) => localPage(raw, a, shapeLeadDecision),
  },
  {
    name: "hanoman_backlog_create",
    title: "Buat backlog",
    description:
      "Buat satu backlog item baru. JANGAN kirim `id`, `stage`, atau `objective`: id diturunkan server (SPEC-nnn berikutnya), stage selalu lahir `brainstorming`, dan objective diturunkan dari payload. Bentuk `payload` ditentukan `source` dan sudah ditegakkan skema tool ini.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Proyek yang tak dikenal menjawab 404."),
        source: enumStr(SOURCE_ENUM, "Asal item: `brief` (fitur), `qa` (temuan bug), `audit` (telusur tanpa perbaikan), `help` (dari tiket), `goal` (kejar satu tujuan tanpa perencanaan)."),
        title: str("Judul singkat.", { minLength: 1 }),
        priority: PRIORITY,
        payload: SPEC_PAYLOAD_ONEOF,
        branchFrom: str("Opsional. Nama branch basis. Branch yang tak ada di repo proyek menjawab 400."),
        dependsOn: strArray("Opsional. Id backlog yang harus selesai DAN ter-merge lebih dulu. Harus ada, satu proyek, bukan diri sendiri."),
      },
      required: ["project", "source", "title", "priority", "payload"],
      allOf: SOURCE_PAYLOAD_ALLOF,
    }),
    mode: "write", capability: "backlog:write", samplePath: "/specs", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/specs",
      body: {
        project: a.project, source: a.source, title: a.title, priority: a.priority, payload: a.payload,
        ...(s(a.branchFrom) ? { branchFrom: a.branchFrom } : {}),
        ...(Array.isArray(a.dependsOn) ? { dependsOn: a.dependsOn } : {}),
      },
    }),
    shape: (raw) => shapeSpecDetail((raw ?? {}) as Record<string, unknown>),
  },
  {
    name: "hanoman_backlog_update",
    title: "Ubah backlog yang belum dimulai",
    description:
      "Ubah judul, prioritas, isi, atau dependency sebuah backlog. Konten hanya bisa diubah selagi item BELUM DIMULAI (stage `brainstorming` dan belum pernah punya sesi); di luar itu server menjawab 409. Cek `editable` di hanoman_backlog_get lebih dulu. Mengubah stage, menghapus item, dan menjalankan integrate sengaja tidak tersedia lewat MCP.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        title: str("Judul baru."),
        priority: PRIORITY,
        payload: SPEC_PAYLOAD_ONEOF,
        dependsOn: strArray("Ganti seluruh daftar dependency. `[]` mengosongkan. Ini SATU-SATUNYA field di sini yang masih boleh diubah setelah item dimulai."),
      },
      required: ["spec"],
    }),
    mode: "write", capability: "backlog:write", samplePath: "/specs/SPEC-1", sampleMethod: "PATCH",
    build: (a) => ({
      method: "PATCH", path: `/specs/${enc(String(a.spec))}`,
      body: {
        ...(s(a.title) ? { title: a.title } : {}),
        ...(s(a.priority) ? { priority: a.priority } : {}),
        ...(a.payload !== undefined ? { payload: a.payload } : {}),
        ...(Array.isArray(a.dependsOn) ? { dependsOn: a.dependsOn } : {}),
      },
    }),
    shape: (raw) => shapeSpecDetail((raw ?? {}) as Record<string, unknown>),
  },
  {
    name: "hanoman_notifications_mark_read",
    title: "Tandai notifikasi terbaca",
    description: "Tandai SELURUH notifikasi sebagai sudah dibaca. Tak ada varian per-item.",
    inputSchema: obj({ properties: {} }),
    mode: "write", capability: "notifications:write", samplePath: "/notifications/read", sampleMethod: "POST",
    build: () => ({ method: "POST", path: "/notifications/read", body: {} }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_ask",
    title: "Minta putusan hanoman-lead",
    description:
      "Minta putusan ke hanoman-lead saat menemui persimpangan yang biasanya butuh manusia. Jawabannya terbaca mesin (`decision`, `reason`, `refs`, `confidence`, `action`) dan `refs` hanya memuat rujukan yang benar-benar ada di repo. Panggilan ini melahirkan jejak permanen dan putusannya bisa menggerakkan sesi — pakai hanya saat memang buntu. 409 = lead tak aktif atau proyek belum opt-in: kembali ke perilaku biasa, berhenti dan tunggu manusia.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        question: str("Pertanyaannya, maksimum 8000 karakter."),
        spec: str("Opsional. Id backlog yang bersangkutan."),
        session: str("Opsional. Id sesi yang bersangkutan."),
        options: strArray("Opsional. Pilihan yang tersedia, maksimum 20, masing-masing maksimum 2000 karakter. Lead memilih salah satunya."),
        context: str("Opsional. Konteks pendukung, maksimum 20.000 karakter."),
      },
      required: ["project", "question"],
    }),
    mode: "write", capability: "lead:write", samplePath: "/lead/decisions", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/lead/decisions",
      body: {
        projectId: a.project, question: a.question,
        ...(s(a.spec) ? { specId: a.spec } : {}),
        ...(s(a.session) ? { sessionId: a.session } : {}),
        ...(Array.isArray(a.options) ? { options: a.options } : {}),
        ...(s(a.context) ? { context: a.context } : {}),
      },
    }),
    shape: (raw) => raw,
  },
];
