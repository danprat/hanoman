# Audit SPEC-432 — hanoman-lead tak pernah memutuskan, denyutnya membakar giliran tanpa hasil

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-31
**Metode:** `superpowers:systematic-debugging` · **Menguji:** [ADR-0091](../adr/0091-hanoman-lead-agen-pemimpin.md) (SPEC-409)

## Keluhan

> "saat ini lead hanoman belum sesuai dengan pengambilan decisionnya. lead hanoman belum bisa
> mengambil keputusan, serta heartbeatnya spam tanpa ada hal yang bisa dilakukan."
>
> Diharapkan: "ketika ada session yang membutuhkan keputusan maka lead hanoman dapat melakukan
> pengambilan keputusan. tiap heartbeat tidak spam, jika tidak ada yang membutuhkan keputusan tidak
> perlu spawn."

## Ringkasan temuan

Keduanya benar, dan keduanya terukur di basis data operator — **bukan** kesan subjektif.

**Jejak keputusan berisi 7 baris. Tujuh-tujuhnya `gagal`, dengan alasan yang identik:**
`lead claude kehabisan waktu 120000 ms`. Nol keputusan `berlaku` pernah lahir. Ketujuh notifikasi
lead yang pernah terbit pun seluruhnya berbunyi "Lead gagal memutuskan" — itulah spam yang dilihat
operator: bukan lead yang bekerja terlalu rajin, melainkan lead yang **gagal berulang kali atas
pekerjaan yang sejak awal tak bisa mengubah apa pun**.

Empat cacat berlapis:

| # | Cacat | Akibat |
|---|-------|--------|
| A | `timeoutSec` default **120 dtk** melawan prompt yang memerintahkan "KUMPULKAN BUKTI DULU: `internal/docs/**`, ADR, plan, kode, riwayat git" pada `effort: xhigh` — dan prompt itu **tak pernah memberi tahu lead bahwa ia sedang dikejar waktu** | **100% keputusan gagal** (akar "lead tak bisa memutuskan") |
| B | `orderReadyWork` memanggil agen tanpa memeriksa apakah penataannya bisa dieksekusi siapa pun: scheduler `paused`, project non-`schedulerOptIn`, atau spec yang **sudah** ada di antrean (`enqueue` = upsert `update:{}` → penataan ulang = no-op) | **6 dari 7** panggilan lead terbakar untuk pekerjaan yang terbukti nihil (akar "spam") |
| C | `tick()` memegang **satu** flag `busy` untuk pintu deteksi (5 dtk) **dan** denyut proaktif (menit) | denyut yang lambat **melaparkan** pintu yang justru menjawab sesi mandek |
| D | Gerbang idempotensi denyut mencari `kind` yang **ditulis ulang** `decide()` jadi `"refusal"` | keputusan yang sama diulang tiap denyut **selamanya** (loop laten) |

Semuanya di dalam `server/src/services/lead/**` + satu default di `shared/src/entities.ts`. Tak ada
perubahan skema, kontrak API, maupun model data — ADR-0091 tetap berlaku apa adanya; yang salah
adalah angka default, satu gerbang yang hilang, satu flag yang dipakai bersama, dan satu kunci
kueri.

## Bukti — (A) setiap keputusan lead dihentikan paksa di detik ke-120

Jejak keputusan di DB operator (`~/.hanoman/hanoman.db`), apa adanya:

```
sqlite> select gate,kind,status,count(*) from LeadDecision group by 1,2,3;
detected|answer|gagal|1
pulse|order|gagal|6
```

Ketujuh baris `reason`-nya identik: `lead tak menghasilkan keputusan: lead claude kehabisan waktu
120000 ms`. Tak ada satu pun baris `berlaku`, `ditimpa`, atau `dibatalkan`.

Konfigurasi yang berlaku saat itu: `lead.timeoutSec = 120` (default `zLead`), `lead.engine.enabled
= false` → lead mewarisi `sessionAgentDefaults()` = **`claude` · `claude-opus-5` · effort `xhigh`**.

Yang diminta prompt itu dari agen tersebut (`services/lead/prompt.ts`):

> 1. KUMPULKAN BUKTI DULU sebelum memutuskan: `internal/docs/**` (Source of Truth) dan index-nya,
>    ADR yang relevan, plan `docs/superpowers/plans/**`, kode yang bersangkutan, dan riwayat git.
>    **Baca, jangan mengingat.**

**Prompt tidak pernah menyebut bahwa ada batas waktu.** Agen diberi mandat membaca seluruh Source of
Truth, tanpa anggaran, lalu di-SIGTERM di detik ke-120 di tengah pembacaan itu.

**Kontrol — argv-nya sehat, jadi bukan flag yang salah.** `claude --help` memang punya `--effort`
dan `--model`; argv `leadArgv()` dijalankan apa adanya lewat `execFile` yang sama dengan
`brain.think()` atas prompt sepele:

```
$ node repro-brain.mjs        # ["-p","--model","claude-opus-5","--effort","xhigh",…,"Jawab dengan satu kata: OK"]
elapsed_ms: 9317
err: none
stdout: "OK\n"
stderr: "Warning: no stdin data received in 3s, proceeding without it…"
```

Jadi biner, flag, dan pembacaan keluarannya benar. Yang tak muat hanyalah **pekerjaannya di dalam
120 detik**. Diukur dengan prompt `order` realistis (3 backlog, cwd checkout hanoman), agen dan
harness `execFile` yang sama, dua varian yang hanya berbeda pada ada-tidaknya baris anggaran waktu:

| Varian prompt | Durasi | Hasil |
|---|---|---|
| **tanpa** anggaran waktu (persis `leadPrompt` hari ini) | **306 236 ms ≈ 5 mnt 6 dtk** | selesai — tapi **2,55× melewati batas 120 dtk**, jadi di produksi ia selalu di-SIGTERM di tengah jalan |
| **dengan** anggaran waktu ("kamu punya 300 detik… berhenti membaca saat separuh waktu habis, lalu putuskan") | **101 136 ms ≈ 1 mnt 41 dtk** | selesai **dengan blok ```json yang sah**, dan **masih di bawah batas 120 dtk yang berlaku hari ini** |

Itu bukti langsung untuk akarnya: **agen tak tahu ia sedang dikejar waktu.** Satu paragraf anggaran
memangkas durasinya **3×** dan mengubah "selalu gagal" jadi "keputusan sah dalam batas yang sudah
ada". Menaikkan `timeoutSec` tetap dilakukan sebagai kelonggaran (306 dtk terukur > 120 dtk default),
tapi lever utamanya ada di prompt.

## Bukti — (B) denyut membakar giliran lead untuk penataan yang mustahil berdampak

Enam dari tujuh panggilan lead adalah `pulse|order` — "Ada N backlog siap dikerjakan. Urutkan…".
Tiga project meng-opt-in lead, jadi tiap denyut melahirkan tiga pertanyaan berurutan:

```
sqlite> select id,leadOptIn,schedulerOptIn from Project;
crm-tumbuh-ai|1|1
erp-tumbuh-ai|1|0        ← lead opt-in, scheduler TIDAK
hanoman|1|1
```

Keadaan yang membuat ketiganya nihil, ketiga-tiganya sekaligus:

**1 · Scheduler-nya dijeda.** `Setting.scheduler = {"enabled":true,"paused":true,…}`.
`scheduler/engine.ts` berhenti sebelum `drain()` saat `paused` → antrean tak pernah dikuras. Urutan
antrean yang ditata lead tak punya siapa pun yang membacanya.

**2 · Penataannya no-op untuk dua project.** `orderProject` mewujudkan urutan sebagai **urutan
enqueue**, tapi `enqueue()` adalah `upsert(..., update: {})` — spec yang sudah punya baris antrean
**tak berubah sama sekali**, termasuk `enqueuedAt` yang jadi tiebreak FIFO-nya. Berapa banyak
backlog siap-kerja yang sudah ada di antrean:

```
sqlite> select s.projectId, count(*) ready,
   ...>   sum(case when q.specId is null then 0 else 1 end) sudah_di_antrean
   ...> from Spec s left join SchedulerQueueItem q on q.specId = s.id
   ...> where s.baseSha is null group by 1;
crm-tumbuh-ai|8|8         ← 8 dari 8 sudah antre → penataan = no-op total
erp-tumbuh-ai|20|0
hanoman|20|20             ← 20 dari 20 sudah antre → no-op total
```

**3 · Project ketiga tak boleh disentuh scheduler.** `erp-tumbuh-ai` punya `leadOptIn=1` tapi
`schedulerOptIn=0`; `scheduler/sources/backlog.ts` menyaring `project: { schedulerOptIn: true }` dan
governor tak akan pernah meluncurkannya. Menata urutannya adalah menata antrean yang takkan pernah
dijalankan.

Ketiga panggilan per denyut karena itu **terbukti tak bisa mengubah apa pun**, bahkan seandainya
lead berhasil menjawab. Persis keluhan operator: *spawn tanpa ada hal yang bisa dilakukan*.

**Pemicunya sesering mutasi backlog.** Gerbang satu-satunya adalah tanda tangan himpunan siap-kerja
(`lastReadySig`, in-memory) — dan himpunan itu adalah `Spec.baseSha = null`, yang berubah **setiap
kali satu sesi lahir** (`baseSha` ditulis saat mulai) dan **setiap kali satu backlog masuk** (triase,
brief, breakdown). Terlihat di jejak: hitungan yang ditanyakan lead turun 27 → 21, 26 → 20, 9 → 8
dalam hitungan jam. Setiap perubahan itu membeli satu giliran agen per project.

**`everyMin` juga berhenti jadi lantai.** `engine.tick()` menstempel `lastPulseAt = now` di **awal**
denyut, sementara denyutnya sendiri berlangsung `jumlah_project × timeoutSec` (3 × 120 = 360 dtk >
`everyMin` 300 dtk). Begitu denyut selesai, tick berikutnya langsung jatuh tempo lagi — tak ada jeda
tenang sama sekali.

## Bukti — (C) denyut proaktif melaparkan pintu yang justru diminta operator

`engine.ts` memakai **satu** penjaga untuk dua irama yang ADR-0091 §5 sengaja pisahkan:

```ts
export async function tick(now: number, deps: LeadTickDeps = {}): Promise<void> {
  if (busy) return;                    // ← satu flag untuk KEDUA pintu
  busy = true;
  try {
    …
    try { await scanAndAnswer(…); } catch …      // pintu deteksi: seharusnya tiap 5 detik
    …
    try { await pulse(…); } catch …              // denyut proaktif: menit
  } finally { busy = false; }
}
```

Selama `pulse()` berjalan — 360 detik pada mesin operator — **setiap tick 5 detik berikutnya
langsung `return`**, jadi `scanAndAnswer()` tak dijalankan sama sekali. Pintu deteksi otomatis
adalah satu-satunya yang menjawab sesi mandek, yaitu tepat yang diminta operator ("ketika ada session
yang membutuhkan keputusan maka lead dapat mengambil keputusan"), dan ia dimatikan berkala oleh
pekerjaan yang sudah terbukti nihil di temuan (B). M1 ADR-0091 (median ≤ 2 menit) tak mungkin
tercapai di bawah kondisi ini.

## Bukti — (D) idempotensi denyut pecah persis saat lead mengusulkan tindakan terlarang

`decide()` menulis ulang `kind` ketika tindakan usulan lead di luar allowlist:

```ts
const allowed = leadActionAllowed(verdict.action);
const kind: LeadKind = allowed ? req.kind : "refusal";     // decide.ts
```

Sementara gerbang "sudah pernah diputuskan" di denyut mencari `kind` **aslinya**:

```ts
const seen = await prisma.leadDecision.findFirst({
  where: { sessionId: s.id, kind: "quality", gate: "pulse" } });   // pulse.ts · followUpFinished
```

Baris yang tersimpan ber-`kind: "refusal"` → kueri ini tak pernah cocok → sesi mati yang sama
ditanyakan ulang **tiap denyut, selamanya** (pane mati bertahan berhari-hari karena
`remain-on-exit on`). Ini persis gotcha #2 ADR-0091 ("idempotensi lewat JEJAK, bukan `Set` memori")
yang ditegakkan dengan kunci yang salah. Kueri tabrakan (`kind: "collision"`) punya cacat yang sama,
walau ia masih tertolong oleh `question: { contains: key }`.

Belum terpicu di lapangan hanya karena temuan (A) menggagalkan setiap keputusan lebih dulu —
`fail()` mempertahankan `kind` aslinya. Ia akan terpicu justru saat (A) diperbaiki.

## Akar masalah

1. **Prompt lead tak punya anggaran waktu, dan `timeoutSec` default tak punya hubungan dengan
   pekerjaan yang diminta prompt itu.** (A)
2. **Denyut memutuskan "ada yang perlu diputuskan?" dari perubahan himpunan backlog, bukan dari
   adanya tindakan yang benar-benar bisa dieksekusi.** (B)
3. **Dua irama yang sengaja dipisahkan ADR-0091 berbagi satu penjaga re-entrancy.** (C)
4. **Kunci idempotensi memakai kolom yang boleh ditulis ulang jalur keputusan.** (D)

## Perbaikan (Spec & Plan `skipped` — dokumen ini doc-of-record)

Diff kecil, terlokalisasi, tanpa ADR/skema/endpoint baru. ADR-0091 tak diamandemen: seluruh
perbaikan menegakkan apa yang sudah ia putuskan (§5 dua irama, OQ-2 "nol pekerjaan → nol panggilan
agen", gotcha #2 idempotensi lewat jejak).

| # | Perbaikan | Berkas |
|---|-----------|--------|
| 1 | Prompt memuat **anggaran waktu eksplisit** (detik yang benar-benar berlaku) + perintah berhenti membaca dan memutuskan sebelum habis; `timeoutSec` default 120 → **600** sebagai kelonggaran (plafon 900 tetap) | `services/lead/prompt.ts`, `services/lead/decide.ts`, `shared/src/entities.ts` |
| 2 | `orderReadyWork` hanya memanggil agen bila penataannya bisa dieksekusi: scheduler `enabled && !paused`, project `schedulerOptIn`, dan **≥ 2 backlog siap yang belum ada di antrean**; tanda tangan dihitung atas himpunan yang belum antre itu | `services/lead/pulse.ts` |
| 3 | `engine.tick()` memakai penjaga **terpisah** untuk pintu deteksi & denyut; `lastPulseAt` distempel ulang saat denyut **selesai** agar `everyMin` benar-benar jadi jeda tenang | `services/lead/engine.ts` |
| 4 | Gerbang idempotensi denyut menerima `kind` yang ditulis ulang jadi `refusal` | `services/lead/pulse.ts` |
| 5 | Notifikasi `gagal` tidak diulang untuk kegagalan sejenis yang beruntun (baris jejaknya tetap ditulis — AC-4 utuh) | `services/lead/decide.ts` |

Yang **tidak** diubah, sengaja: allowlist `LEAD_ACTIONS` (konstanta, AC-31/32), model data
`LeadDecision`, kontrak `POST /api/lead/decisions`, dan default MATI seluruh blok `Setting.lead`
(AC-30).
