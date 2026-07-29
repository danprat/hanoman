# Market sizing

hanoman adalah **alat internal** nafanesia.id, bukan produk berbayar. "Sizing" karena itu berarti
**kapasitas satu host**, bukan ukuran pasar: berapa banyak project dan sesi agen yang muat sebelum
mesinnya sendiri jadi penghalang.

## Yang di-size

| Dimensi | Angka | Dasar |
|---|---|---|
| Project aktif yang dipantau | ~5–20 | target operasi nafanesia.id |
| Sesi agen konkuren per host | **2** (default `maxConcurrent`) | `SCHEDULER_DEFAULTS` di `shared/src/entities.ts`, dijaga `shared/src/scheduler.test.ts` |
| Backlog item hidup per project | puluhan | `GET /specs` menyajikan set penuh dengan overlay live ([ADR-0038](../adr/0038-paginasi-di-response-layer.md)) |
| Item checklist kepatuhan per VPS | 232 | [vps-compliance](../architecture/vps-compliance.md) (ADR-0050) |

## Batas yang sebenarnya: RAM & CPU, bukan jumlah project

Yang lebih dulu habis bukan storage atau koneksi DB, melainkan **RAM dan CPU saat beberapa sesi agen
berbagi satu mesin**. Tiap sesi backlog adalah proses agen penuh di worktree sendiri, dan pekerjaan
terberatnya bukan menulis kode melainkan **memverifikasi**: repo ini punya **269 berkas test** di enam
paket workspace, dan satu `pnpm -r typecheck` menyalakan enam proses `tsc` sekaligus.

Itulah sebabnya `verifyScope` ada ([ADR-0080](../adr/0080-scope-verifikasi-per-sesi.md)). Ukuran yang
terukur di ADR itu: perubahan di modul inti (`shared/src/{enums,entities,dto}.ts`) menyeret **217 berkas
test / 1 589 test / 177 detik** lewat `vitest --changed` — praktis setara suite penuh; perubahan berdaun
jauh lebih murah. Jadi kapasitas konkurensi bukan fungsi jumlah project, melainkan fungsi **letak
perubahan** yang sedang dikerjakan sesi-sesi itu.

Governor scheduler ([ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)) menegakkan
cap itu dengan menghitung sesi hidup dari `pty.listSessions` sebelum men-drain antrean — tmux, bukan DB,
yang jadi sumber kebenarannya.

## Beban server (bukan beban agen)

Server sendiri ringan dan sengaja dijaga begitu: satu proses Fastify + Postgres, tanpa message queue,
Redis, worker terpisah, maupun cron eksternal
([ADR-0024](../adr/0024-sesi-interaktif-menggantikan-run.md)). Kerja latar hanya beberapa `setInterval`
in-process. Realtime memakai satu WebSocket siar
([ADR-0039](../adr/0039-realtime-lewat-websocket-siar.md)) plus satu WebSocket PTY per pane terbuka —
jumlahnya terikat pada berapa pane yang dibuka operator, bukan berapa project yang terdaftar.

## Yang belum divalidasi

Angka di atas adalah kapasitas **rancangan**, bukan hasil beban nyata. Yang belum diukur: titik jenuh
`maxConcurrent` di host produksi, dan laju tumbuh `SyncLog`/`ErrorEvent` pada instance hub jangka
panjang. Validasi menunggu beban sungguhan — naikkan cap hanya dengan angka, bukan firasat.
