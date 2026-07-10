# SPEC-168 — spec: backlog menurunkan stage live selama sesi hidup

**Status:** terimplementasi (`sessionPhasesBySpec` di `pty.ts` + derivasi forward-only di
`GET /specs`). Diverifikasi nyata di server yang di-boot: sesi hidup + `echo "Audit done" >>
$HANOMAN_PHASE_FILE` → `GET /api/specs` melaporkan `objective` **tanpa DELETE**, sementara
baris DB tetap `brainstorming`; DELETE memfinalkan ke `objective`. Test: 3 kasus di
`server/test/terminal.route.test.ts` ("GET /specs · stage live dari sesi").

Fase **Spec** dari alur QA. Hulu: [audit SPEC-168](spec-168-backlog-realtime-audit.md).
Hilir: plan di `docs/superpowers/plans/`.

## Objective

Board backlog memantulkan kemajuan fase sesi terminal **real time** (≤3 detik), tanpa
menambah kanal realtime baru dan tanpa mengubah frontend.

## Keputusan

`GET /specs` **menurunkan** `stage` dari berkas fase sesi yang hidup, forward-only, sebelum
mengembalikannya — mengikuti pola "simpan seminimalnya, turunkan saat dibaca" (ADR-0018/0019).
`Spec.stage` di DB tetap ditulis hanya oleh seed `create` dan `advanceStage` di DELETE; tidak
ada penulisan baru di jalur panas.

### 1. Helper batch di `pty.ts`

Satu `list-panes`, kembalikan fase per spec untuk semua pane ber-spec. Batch supaya
`GET /specs` tak memicu satu `tmux list-panes` per spec.

```ts
// pty.ts — fase per spec dari semua sesi tmux, dalam satu list-panes (SPEC-168).
// Tak difilter `exited`: berkas fase pane mati (belum di-DELETE) tetap kebenaran terakhirnya;
// stageFor forward-only di pemanggil menjaga tak ada yang mundur.
export function sessionPhasesBySpec(): Map<string, Phase[]> {
  const out = new Map<string, Phase[]>();
  for (const p of listPanes()) {
    if (!p.specId || !p.flow || !p.phaseFile) continue;
    out.set(p.specId, readPhases(p.phaseFile, p.flow));
  }
  return out;
}
```

`listPanes`, `readPhases`, dan `Phase` sudah ada di modul itu — nol import baru.

### 2. Turunkan stage di `GET /specs`

```ts
// specs.ts
app.get("/specs", async (req) => {
  const { project, source } = req.query as { project?: string; source?: string };
  const specs = await prisma.spec.findMany({ where: { projectId: project, source }, orderBy: { id: "desc" } });
  // Stage live: selama sesi hidup, stage diturunkan dari berkas fase (ADR-0018/0019), tidak
  // dipersist tiap transisi. DELETE tetap memajukan Spec.stage ke keadaan finalnya. Hanya maju
  // (ADR-0008). (SPEC-168)
  const live = sessionPhasesBySpec();
  if (live.size === 0) return specs;
  return specs.map((s) => {
    const phases = live.get(s.id);
    if (!phases) return s;
    const next = stageFor(phases);
    if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
    return { ...s, stage: next };
  });
});
```

Import baru di `specs.ts`: `sessionPhasesBySpec` dari `../services/pty`, `stageFor` dari
`../services/session-phases`, `STAGES` dari `../services/stage-machine`, `type Stage` dari
`@hanoman/shared`.

### Kontrak

- `GET /specs` bentuk respons **tidak berubah** (tetap `Spec[]`); hanya nilai `stage` yang
  bisa lebih maju daripada baris DB saat spec-nya punya sesi hidup.
- Forward-only: stage turunan tak pernah lebih mundur dari `spec.stage` persist.
- Tanpa sesi apa pun: jalur cepat `if (live.size === 0) return specs` — nol perubahan perilaku
  dan nol `tmux` call di luar `list-panes` yang murah (kembali `[]` kalau server tmux mati).
- `advanceStage` di DELETE (`terminal.ts:121`) **tetap** — finalisasi durabel sesudah worktree
  dibuang.

## Test (fase Execute, TDD dulu)

Route test `server/test/specs.route.test.ts`, tanpa spawn `claude`/tmux — palsukan panes via
`HANOMAN_TMUX_SOCKET` yang sudah dipakai test lain, atau lebih ringan: uji `sessionPhasesBySpec`
+ turunan stage lewat berkas fase nyata di tmp dan monkeypatch `listPanes`? Pilih yang paling
sedikit gesekannya di plan; minimal ada **satu tes yang gagal sebelum fix**:

1. Spec di DB berstage `brainstorming` + berkas fase berisi `Objective done` untuk sesi
   spec-nya → `GET /specs` melaporkan `stage: "objective"`.
2. Spec tanpa sesi → `stage` = nilai DB apa adanya.
3. Berkas fase yang memetakan stage **lebih mundur** dari persist (mis. spec sudah `planned`,
   fase baru `Objective done`) → stage tetap `planned` (forward-only).

## Non-tujuan

- Tidak menambah SSE/WebSocket untuk daftar backlog. Poll 3 detik yang ada sudah cukup.
- Tidak mengubah `pty.ts` agar menulis DB, tidak menambah watcher/callback lintas lapisan.
- Tidak menyentuh frontend.
- Catatan laten di audit (sesi mati eksternal belum di-DELETE; `existing` tak cek `exited`)
  tetap di luar cakupan.

## Rujukan

- [audit SPEC-168](spec-168-backlog-realtime-audit.md)
- ADR-0018/0019 — turunkan-saat-baca. ADR-0008 — stage hanya maju. ADR-0024 — berkas fase.
