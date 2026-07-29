# Pricing rationale

hanoman **tidak dijual** — tak ada harga, tier, maupun metering. Yang perlu dijelaskan bukan harga jual
melainkan **bagaimana biaya dikendalikan**, karena satu-satunya biaya variabel yang berarti adalah token
model yang dibakar sesi agen.

## Prinsip: biaya adalah estimasi, bukan gerbang

[ADR-0012](../adr/0012-cost-is-an-estimate-not-a-guardrail.md) memutuskan biaya **tidak menggerakkan apa
pun**. Tak ada `dailyBudget`, tak ada `maxConcurrent` berbasis anggaran, tak ada sesi yang dihentikan
karena melewati angka. Alasannya: estimasi biaya token tak pernah cukup akurat untuk dipercaya sebagai
gerbang, dan sesi yang dibunuh di tengah fase merugikan lebih banyak daripada yang dihemat. Manusia yang
memutuskan kapan berhenti.

## Kendali nyata yang tersedia

### 1. Model & effort per sesi

Dipilih saat **Start** lewat picker `StartSessionModal`, jadi argv saat sesi lahir — andal penuh, tak
bergantung agen mengetik apa pun ([ADR-0061](../adr/0061-model-effort-per-sesi-picker-start.md)). Satu
sesi = satu proses = satu model seumur hidupnya.

| Agen | Model | Effort |
|---|---|---|
| claude | `claude-opus-5` · `claude-sonnet-5` · `claude-haiku-4-5` · `claude-fable-5` | `xhigh` · `high` · `medium` · `low` · `max` · `ultracode` |
| codex | `gpt-5.6-sol` · `gpt-5.6-terra` (ultra…low) · `gpt-5.6-luna` (tanpa ultra) · `gpt-5.5` (xhigh…low) | per-model — picker wajib `codexEfforts(model)` |

Katalognya hidup di `shared/src/entities.ts`. Effort adalah properti **model**, bukan properti CLI
(SPEC-339) — kombinasi yang ditolak model tak boleh muncul di picker.

### 2. Default global & default sesi konflik

Setelan default ada di Settings tab "Model sesi", tersusun **bersumbu agen**. Sesi penyelesai konflik
rebase/merge punya blok sendiri yang **opt-in**
([ADR-0081](../adr/0081-default-sesi-konflik-opt-in.md)): menyelesaikan konflik itu pekerjaan sempit,
tak berfase, dan sering beruntun — tak perlu effort sesi Execute. Selama blok itu mati, ia mewarisi
default global tanpa selisih satu argv pun.

### 3. Scope verifikasi

Penghematan terbesar yang bukan soal model: sesi ber-`verifyScope=changed` hanya menguji berkas yang
berubah ([ADR-0080](../adr/0080-scope-verifikasi-per-sesi.md)). Menjalankan suite penuh + `pnpm -r
typecheck` tiap task menghabiskan token **dan** RAM/CPU sesi tetangga.

## Pemantauan: dua indikator, sengaja tidak digabung

| | claude | codex |
|---|---|---|
| Sumber | panggilan usage API live | snapshot `rate_limits` dari rollout sesi |
| Kesegaran | cache TTL 30 detik | `stale` bila > 12 jam |
| Jaringan | ya | **nol** |

Keduanya punya badge dan grup siar terpisah. Menggabungkannya akan menyembunyikan fakta bahwa
kesegarannya berbeda ordo — angka codex bisa berumur setengah hari
([ADR-0074](../adr/0074-codex-sebagai-mesin-sesi.md)).

## Biaya infrastruktur

Kecil dan tetap: satu VPS single-host di belakang reverse proxy TLS + satu Postgres dalam Docker. Tanpa
message queue, Redis, worker terpisah, maupun layanan pihak ketiga di jalur eksekusi
([ADR-0024](../adr/0024-sesi-interaktif-menggantikan-run.md)). Lihat
[deploy-vps](../operations/deploy-vps.md).
