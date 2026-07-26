# SPEC-332 — Backlog goals mode (`/goal` pada sesi claude hanoman)

**Status:** design disetujui · **Flow:** feature (brief) · **Prioritas:** tinggi
**ADR:** 0073 (baru) · **Skema DB:** tidak berubah (blok JSON `Setting.goal` lewat `.default()`)

## Masalah

Sesi backlog hanoman berjalan tak-berpenunggu dan sering **berhenti sebelum tuntas**: fase jadi
dangkal, plan masih menyisakan `- [ ]`, atau agen `end_turn` setelah subagent async. Yang menahannya
hari ini hanya **teks prompt** — `AUTONOMY_CLAUSE` (ADR-0035) dan cermin gate plan (ADR-0029) — yaitu
imbauan, bukan mekanisme. Server memang menahan stage di `executing` (ADR-0029), tetapi prosesnya
sendiri sudah mati; operator harus menyalakan ulang sesi secara manual.

Claude Code sejak 2.1.x punya mekanisme nyata untuk ini: **`/goal <kondisi>`** — "keep working until
the condition is met". hanoman belum memakainya sama sekali.

## Temuan mekanisme (Claude Code 2.1.220, diverifikasi dari binary terpasang)

- `/goal` = slash command built-in, `{type:"local", name:"goal", supportsNonInteractive:true}`,
  deskripsi "Set a goal — keep working until the condition is met".
  Sub-perintah: `/goal <kondisi>` set · `/goal` / `/goal active` status · `/goal clear` lepas.
- Mesinnya: memasang **Stop hook bertipe `prompt`** — `sessionHooksRegistry.add(cwd, "Stop", "",
  {type:"prompt", prompt:<kondisi>})` — lalu men-set `appState.activeGoal`.
- Tipe hook `prompt` adalah **warga kelas satu di schema `--settings`**: `{type:"prompt", prompt,
  if?, timeout?, model?, continueOnBlock?, statusMessage?, once?}` — dideskripsikan "LLM prompt hook type".
- **Tidak ada flag CLI `--goal`.** Satu-satunya jalan non-interaktif adalah memasang hook itu sendiri.
- Gate `/goal`: workspace trusted (`--dangerously-skip-permissions` memenuhinya) + hooks tak dibatasi
  (`disableAllHooks`/`allowManagedHooksOnly` mematikannya). Batas panjang kondisi **4000 karakter**.
- Evaluator hook `prompt` berjalan dengan system prompt: *"You are evaluating a hook condition in
  Claude Code… Answer based on transcript evidence only"*, mengembalikan `{"ok":bool,"reason":string}`
  lewat json_schema, memakai **model kecil-cepat** (bisa di-override `model`).
  → **Ia tidak punya tool; ia hanya membaca transkrip.**
- Transkrip Stop yang panjang **dipotong**; instruksinya: bila bukti mungkin ada di bagian yang
  dibuang, kembalikan `{"ok":false,"reason":"insufficient evidence in transcript"}`.
- Claude Code sendiri mengenali "condition judged impossible" → goal gagal ("Goal could not be
  achieved"), jadi kondisi mustahil tidak membuat sesi berputar selamanya.
- `Rlt(appState, cwd, "Stop")` — sumber yang dibaca `/goal` untuk mencari goal lama — membaca
  **hanya `appState.sessionHooks`**, bukan hook dari settings. Konsekuensi penting: hook Stop dari
  `--settings` **tak terlihat** oleh `/goal`; keduanya bisa hidup berdampingan, dan `/goal clear`
  tak akan pernah menghapus hook settings.

## Keputusan (jawaban operator saat brainstorm)

| Pertanyaan | Keputusan |
|---|---|
| Mekanisme | **Keduanya** — Stop hook via `--settings` (jaminan) **dan** keystroke `/goal` ke tmux (visibilitas TUI) |
| Cakupan | **Sesi backlog saja** (spec-flow `feature`/`qa`), Start manual + peluncuran scheduler |
| Kondisi | **Default turunan DoD hanoman, boleh di-override** teks bebas per sesi |
| Default | **Setting global (default MATI)** + toggle per sesi di modal "Mulai sesi" |

## Arsitektur

Empat lapis, masing-masing satu tanggung jawab dan bisa diuji sendiri.

### 1. Kondisi — `runner/src/goal.ts` (library murni, tanpa DB/IO)

```ts
export const GOAL_MAX = 4000;                       // batas Claude Code
export function defaultGoalCondition(a: GoalArgs): string;   // template DoD hanoman
export function resolveGoalCondition(a: GoalArgs, override?: string): string;
export function goalOneLine(cond: string): string;  // untuk send-keys (newline = submit)
```

`GoalArgs = { flow, specId, branchTo, phases }`.

Template default dirakit dari kontrak hanoman sendiri, dan **sengaja menuntut bukti segar** karena
evaluator hanya melihat transkrip terbaru:

> Sesi backlog hanoman `<specId>` (`<flow>`) hanya boleh berhenti bila **transkrip terbaru** memuat
> bukti langsung ketiganya:
> 1. output `cat "$HANOMAN_PHASE_FILE"` yang memuat baris untuk SETIAP fase `<phases>` sampai fase
>    terakhir, masing-masing `done` atau `skipped`;
> 2. output `grep -rn -- "- \[ \]" docs/superpowers/plans/` yang **kosong** untuk plan backlog ini
>    (atau bukti bahwa flow ini memang tak punya plan);
> 3. output `git push origin HEAD:refs/heads/<branchTo>` yang **sukses** sesudah commit terakhir.
>
> Bila salah satu bukti tak ada di transkrip terbaru, kondisi BELUM terpenuhi: jalankan perintah
> verifikasinya, tuntaskan yang kurang, jangan berhenti.

Klausa 2 dilewati untuk flow tanpa fase Plan+Execute (mengikuti `phaseInstruction` yang sudah ada).

### 2. Pemasangan saat sesi lahir — `runner/src/settings.ts` + `server/src/services/pty.ts`

`guardSettings(decisionFile?, goal?)` menambah, di samping hook Notification/UserPromptSubmit yang
sudah ada:

```jsonc
{ "hooks": { "Stop": [ { "hooks": [ { "type": "prompt", "prompt": "<kondisi>" } ] } ] } }
```

`CreateOpts.goal?: string` diteruskan `createSession` ke `guardSettings`. Hook ini **deterministik**:
ia sudah ada sejak proses claude lahir, tak bergantung timing TUI maupun kepatuhan agen.

### 3. Visibilitas TUI — keystroke `/goal`, best-effort

Sesudah `new-session`, `createSession` memicu (fire-and-forget, tak memblok respons HTTP)
`armGoalInTui(id, condition)` di `pty.ts`:

1. tunggu pane siap (poll `capture-pane`, batas percobaan tetap);
2. `tmux send-keys -t <name> -l "/goal <kondisi satu baris>"` lalu `send-keys -t <name> Enter`;
3. verifikasi `capture-pane` memuat penanda goal; ulangi maksimal N kali;
4. gagal → **menyerah diam-diam** (hook settings tetap jadi jaminan), catat di log server saja.

Karena `/goal` tak melihat hook settings, keystroke ini menambah hook Stop **kedua** di session
registry dengan kondisi yang sama. Konsekuensi yang diterima sadar: saat keduanya terpasang, satu
percobaan stop dievaluasi dua kali (dua panggilan model kecil). Imbalannya `activeGoal` tampil di
TUI, `/goal` status berfungsi, dan goal ikut dipulihkan saat sesi di-resume.

### 4. Kebijakan & kontrak

`startSpecSession(spec, { flow, model, effort, autonomy, goal?, goalCondition? })` — satu titik
resolusi untuk **kedua** pemanggil (route manual & governor scheduler):

```
goal === false            → mati
goal === undefined        → ikut Setting.goal.enabled
goal === true             → nyala
kondisi = goalCondition ?? Setting.goal.condition (bila tak kosong) ?? defaultGoalCondition(...)
```

Kontrak & penyimpanan:

- `shared/dto.ts` · varian spec `zTerminalSession` bertambah
  `goal: z.boolean().optional()` dan `goalCondition: z.string().max(4000).optional()`.
- `shared/entities.ts` · `zGoal = { enabled: false, condition: "" }`, dipasang ke `zSetting` lewat
  `.default(GOAL_DEFAULTS)` — mengikuti pola `scheduler` (SPEC-294) sehingga **baris Setting lama
  tetap parse dan tidak butuh migration**. `Setting` adalah kolom `Json`; skema Prisma tak berubah.
- UI: `StartSessionModal` (App.tsx) mendapat toggle "Mode goal" + textarea kondisi (prefill kondisi
  efektif, editable); `SettingsScreen` mendapat kartu "Mode goal (sesi backlog)" berisi toggle
  default global + textarea template. Toggle memakai pola `Button` (bukan DS `Switch`) mengikuti
  pelajaran SPEC-299.

## Aliran data

```
Settings (global, default mati) ─┐
Modal Mulai sesi (override)  ────┼→ startSpecSession → resolveGoalCondition
Governor scheduler (ikut global) ┘                          │
                                                            ▼
                             createSession({ goal }) → guardSettings → claude --settings
                                                            │              (Stop prompt hook = jaminan)
                                                            └→ armGoalInTui → tmux send-keys "/goal …"
                                                                               (activeGoal tampil di TUI)
```

## Penanganan error

| Kejadian | Perilaku |
|---|---|
| tmux `send-keys` gagal / pane belum siap | retry terbatas, lalu menyerah diam-diam; hook settings tetap aktif |
| Kondisi > 4000 char | ditolak zod di route (400) dan dipangkas defensif di runner |
| Evaluator menilai kondisi mustahil | Claude Code menandai goal gagal — sesi boleh berhenti (tak ada loop abadi) |
| Operator ingin menghentikan sesi | Esc/interrupt **tetap bekerja** (interrupt bukan event Stop); lepas total = kill sesi dari dashboard |
| Setting lama tanpa blok `goal` | `.default()` mengisinya — mode goal mati, perilaku sesi tidak berubah |

## Testing

- **runner (murni):** `defaultGoalCondition` memuat ketiga klausa & id/branch/fase yang benar; klausa
  plan hilang untuk flow tanpa Plan+Execute; `resolveGoalCondition` prioritas override → template →
  default; `goalOneLine` membuang newline; `guardSettings` menghasilkan `hooks.Stop` hanya saat goal
  ada dan tak merusak hook Notification/UserPromptSubmit.
- **shared:** `zSetting` backward-compat (baris lama tanpa `goal` tetap parse, default mati);
  `zTerminalSession` menerima/menolak `goal`/`goalCondition`.
- **server:** `startSpecSession` mematuhi presedens override → global → default; goal mati saat
  Setting mati & tak ada override; `createSession` menaruh Stop hook di argv `--settings`.
- **pty/tmux nyata:** pane dengan proses pembaca (bukan claude) menerima teks `/goal …` dari
  `armGoalInTui` — membuktikan jalur keystroke tanpa memanggil claude sungguhan.
- **UI:** modal mengirim `goal`/`goalCondition`; kartu Settings menyimpan template.
- **Smoke nyata (wajib, CLAUDE.md):** boot server + `curl` `PUT/GET /api/settings` dan
  `POST /api/terminal/sessions`, verifikasi argv tmux memuat Stop hook. Plus satu smoke
  `claude --settings '<Stop prompt hook>'` berumur pendek untuk membuktikan gate benar-benar menahan
  stop pada CLI terpasang.

## Non-goals

- Sesi `prd`, `reverse`, `scaffold`, `breakdown`, `audit`, dan terminal biasa — di luar cakupan.
  (`prd`/`reverse` memang sesi bergiliran dengan manusia; Stop gate melawan sifatnya.)
- Hook tipe `agent` (yang boleh memakai tool untuk memverifikasi kondisi) — lebih kuat, tapi bukan
  mesin `/goal`; dicatat sebagai kelanjutan yang mungkin.
- Tombol "lepas goal" dari dashboard: hook settings tak bisa dilepas dari dalam sesi. Interrupt dan
  kill sesi sudah cukup untuk kendali manusia.
- Persist status goal per sesi di DB / tampilan "goal aktif" di daftar sesi.

## Dampak pada keputusan lama

- **ADR-0037 (guardrail deny dicabut) tidak dibalik.** Yang dipasang di sini adalah **gate
  kelanjutan** di event `Stop` — ia tak pernah menolak tool call, tak membatasi apa yang boleh
  dikerjakan agen, dan tak mengembalikan `runner/src/safety.ts`. Isolasi worktree tetap satu-satunya
  batas keamanan.
- **ADR-0035 diperkuat:** otonomi lintas-fase berubah dari imbauan prompt menjadi mekanisme.
- **ADR-0029 mendapat cermin runtime:** gate "plan harus terceklist penuh" kini juga menahan proses,
  bukan hanya stage di server.
- **ADR-0061 (model/effort per sesi) diikuti polanya:** knob dipilih saat Start, jadi argv saat sesi
  lahir — andal penuh, tak bergantung agen mengetik apa pun.
