# internal/docs — Source of Truth index

Ini **index Source of Truth** hanoman. Setiap dokumen sebaiknya ter-link dari sini — konvensi, bukan lagi
gerbang mekanis (guardrail dicabut, ADR-0023). Kategori mengikuti vocabulary tetap.

## entrypoints
- [blueprint](entrypoints/blueprint.md) — gambaran satu halaman
- [brd](entrypoints/brd.md) · [prd](entrypoints/prd.md) · [frd](entrypoints/frd.md) · [rd](entrypoints/rd.md)

## product
- [blueprint](product/blueprint.md) · [scope-principles](product/scope-principles.md) · [onboarding](product/onboarding.md)

## business
- [brd](business/brd.md) · [pricing-rationale](business/pricing-rationale.md)

## requirements
- [prd](requirements/prd.md) · [frd](requirements/frd.md) · [rd](requirements/rd.md) · [acceptance-criteria (EARS)](requirements/acceptance-criteria-ears-standard.md)

## research
- [market-sizing](research/market-sizing.md) · [competitor-analysis](research/competitor-analysis.md) · [moat](research/moat.md)

> **Dokumen audit tidak diarsipkan di sini.** Laporan `research/audit-<spec>-<slug>.md` yang ditulis flow
> audit (ADR-0057) **berumur**: ia hidup sampai eskalasinya diputuskan dan spec turunannya tuntas, lalu
> dihapus berikut entri indexnya — lihat [ADR-0083](adr/0083-retensi-dokumen-audit.md). Yang permanen
> adalah ADR yang lahir darinya. 27 laporan (SPEC-217…383) dihapus di SPEC-386; ledger jejaknya ada di
> ADR-0083.

## architecture
- [stack](architecture/stack.md) · [data-model](architecture/data-model.md) · [api-contract](architecture/api-contract.md) · [nfr](architecture/nfr.md)
- [vps-compliance](architecture/vps-compliance.md) — kerangka kepatuhan checklist 232 item (SPEC-220 · ADR-0050)

## integrasi (untuk project yang memakai hanoman)
- [SDK error monitoring — npm `hanoman-sdk`](../../sdk/README.md) — cara project lain mengirim error ke hanoman: `npm i hanoman-sdk` → `init({ dsn })` + `captureError()` (Node/browser) atau POST JSON generik langsung → grouping & eskalasi ke backlog (SPEC-249/254 · ADR-0060/0063)
- [Integrasi AI agent — agent token + capability](../../docs/agent-integration.md) — panduan berhadapan-agen: nyalakan akses di Settings → buat token `hnm_agt_…` → `Authorization: Bearer` ke seluruh `/api`, digerbang capability per-domain; ditaut dari panel "Akses AI Agent" di UI (SPEC-257/265 · ADR-0065)

## adr
> Nomor unik & imutable. ADR usang tidak dihapus — ditandai statusnya.
> **Narasi tiap keputusan — apa yang diperluas/dicabut/diamandemen, berikut gotcha-nya — ada di
> [adr/README.md](adr/README.md).** Daftar di bawah sengaja satu baris per ADR: index ini dibaca
> setiap sesi agen, sub-index hanya saat butuh riwayatnya (SPEC-386).
- [0083 — Retensi dokumen audit: artefak diagnosis berumur, bukan SoT abadi](adr/0083-retensi-dokumen-audit.md)
- [0082 — Kontrak apply changefeed: record tertunda, kursor tak melompat, tarik ulang penuh](adr/0082-kontrak-apply-changefeed-record-tertunda.md)
- [0081 — Default sesi konflik: blok `Setting.conflict` opt-in yang mewarisi saat mati](adr/0081-default-sesi-konflik-opt-in.md)
- [0080 — Scope verifikasi per sesi: klausa prompt + env, bukan hook deny](adr/0080-scope-verifikasi-per-sesi.md)
- [0079 — Riwayat sesi terminal: store LOCAL-only + transkrip berkas, hook di dua titik cekik pty](adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md)
- [0078 — Unduh dokumen: query `?download=` di endpoint dokumen + render PDF server-side](adr/0078-unduh-dokumen-md-pdf.md)
- [0077 — Hapus branch tak terpakai: daftar ter-merge turunan + pagar proteksi per-branch](adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md)
- [0076 — Eskalasi audit dinamis: manifest rekomendasi di dokumen audit + tiga pintu (QA · brief · PRD)](adr/0076-eskalasi-audit-dinamis-manifest-rekomendasi.md)
- [0075 — Audit lintas project: relasi `ProjectLink` + flow `cross-audit` + kunci log ber-scope sesi](adr/0075-audit-lintas-project-projectlink-kunci-sesi.md)
- [0074 — Codex sebagai mesin sesi: `Agent` per sesi, hook lewat `-c`, mode goal deterministik](adr/0074-codex-sebagai-mesin-sesi.md)
- [0073 — Mode goal sesi backlog: Stop hook bertipe `prompt` saat sesi lahir + keystroke `/goal`](adr/0073-mode-goal-stop-hook-per-sesi.md)
- [0072 — Fondasi scheduler otonom: engine in-process, antrean durable, cap concurrency](adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)
- [0071 — Link ticket triase: deep-link backlog (hash SPA) + token bagikan status publik](adr/0071-link-ticket-triase-deeplink-sharetoken.md)
- [0070 — Symbolication source-map server-side (parity Sentry)](adr/0070-symbolication-source-map-server-side.md)
- [0069 — Breakdown PRD → backlog paralel-independen (sesi breakdown + manifest + materialize)](adr/0069-breakdown-prd-ke-backlog-paralel.md)
- [0068 — Lampiran tiket masuk record-sync (metadata di feed, byte lazy-fetch)](adr/0068-lampiran-tiket-masuk-record-sync.md)
- [0067 — Sync self-healing: backfill feed + rekonsil konflik manual (LWW-default)](adr/0067-sync-lww-reconciliation-manual.md)
- [0066 — Errors & tickets masuk record-sync (publish asal-hub) + pemicu sync manual](adr/0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md)
- [0065 — AI agent capability: agent token + capability scope per-domain gating `/api`](adr/0065-ai-agent-capability-agent-token.md)
- [0064 — `Project.id` renameable lewat operasi rename khusus (cascade + merambat sync)](adr/0064-project-id-renameable.md)
- [0063 — hanoman-sdk sebagai npm package publik (extensible, errors dulu)](adr/0063-hanoman-sdk-npm-package.md)
- [0062 — Help Center: model tiket + endpoint publik ber-scope-project + jembatan triase→backlog](adr/0062-help-center-tiket-publik-triase.md)
- [0061 — Model & effort per sesi (picker saat Start), mencabut matrix per-fase](adr/0061-model-effort-per-sesi-picker-start.md)
- [0060 — Error monitoring: model baru + ingest ber-DSN sebagai pengecualian auth](adr/0060-error-monitoring-ingest-ber-dsn.md)
- [0059 — Kontinuitas branch take-to-backlog (PRD→brief, audit→QA) + skip-audit qa lanjutan audit](adr/0059-kontinuitas-branch-take-to-backlog-dan-skip-audit.md)
- [0058 — Model & effort per fase, lewat `/model`+`/effort` in-session](adr/0058-model-effort-per-fase.md) — *mekanisme per-fase dicabut oleh 0061*
- [0057 — Audit-only sebagai source + flow (dokumen, tanpa perbaikan)](adr/0057-audit-only-source-flow.md)
- [0056 — Terminal biasa = shell mentah di repoDir project (bukan claude)](adr/0056-terminal-shell-non-claude.md)
- [0055 — Git graph parity: taksonomi operasi + eksekusi berlapis](adr/0055-git-graph-parity-op-taxonomy.md)
- [0054 — Review + integrate ber-skop sesi untuk sesi project-level (PRD)](adr/0054-review-integrate-ber-skop-sesi-untuk-prd.md)
- [0053 — Merge via git graph: deterministik di worktree isolasi, konflik → sesi claude (pola integrate)](adr/0053-git-graph-merge-worktree-isolasi-sesi-claude.md)
- [0052 — Scaffold flow: project from-scratch dari ide → SoT penuh (git-init + startScaffoldPrompt)](adr/0052-scaffold-flow-from-ide.md)
- [0051 — Kepatuhan VPS Fase 3: drift derived + Notification agregat, applicability app-layer advisory](adr/0051-vps-fase3-drift-applicability.md)
- [0050 — Kepatuhan VPS: katalog 232 item di git + model state + scoring + remediasi dry-run](adr/0050-vps-compliance-katalog-scoring.md)
- [0049 — Config runtime: store + registry (knob sync di Settings)](adr/0049-config-runtime-store-registry.md)
- [0048 — Auto-update: deteksi versi read-only, tanpa self-mutation](adr/0048-auto-update-deteksi-read-only.md)
- [0047 — Ringkasan hasil sesi = SessionResult append-only, whitelist, purge manual](adr/0047-activity-log-session-result.md)
- [0046 — Kanal WebSocket sync terpisah, token-authed pada upgrade](adr/0046-kanal-ws-sync-terpisah.md)
- [0045 — Sync record via SyncLog change-feed + version-stamp optimistic concurrency](adr/0045-skema-sync-synclog-version-stamp.md)
- [0044 — Identitas mesin lewat device token per-device (hash-at-rest, revocable)](adr/0044-device-token-machine-identity.md)
- [0043 — Sync server↔client = server-to-server, peran ditentukan konfigurasi](adr/0043-sync-arsitektur-hub-client-server-to-server.md)
- [0042 — Open Console = ssh mentah di tmux hanoman lokal, bukan tmux remote](adr/0042-vps-console-ssh-tmux-lokal.md)
- [0041 — PRD adalah dokumen + flow project-level, bukan entitas DB](adr/0041-prd-sebagai-dokumen-flow-project-level.md)
- [0040 — Jalur cepat qa dielicit lewat prompt, diputuskan agen](adr/0040-jalur-cepat-qa-dielicit-prompt.md)
- [0039 — Data real-time dashboard lewat satu WebSocket siar, bukan polling klien](adr/0039-realtime-lewat-websocket-siar.md)
- [0038 — Paginasi/filter daftar di response layer, overlay atas set penuh](adr/0038-paginasi-di-response-layer.md)
- [0037 — Cabut guardrail deny perintah (PreToolUse) sepenuhnya](adr/0037-cabut-guardrail-safety.md)
- [0034 — IDE Visual boleh memutasi working tree, digerbang sesi + force](adr/0034-ide-mutasi-working-tree-utama.md)
- [0036 — Notifikasi human decision dari hook Claude](adr/0036-notifikasi-human-decision.md)
- [0035 — Sesi menembus batas fase tanpa berhenti kecuali butuh keputusan manusia](adr/0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md)
- [0033 — Notifikasi saat backlog selesai](adr/0033-notifikasi-backlog-selesai.md)
- [0032 — Branch adalah properti backlog item](adr/0032-branch-adalah-properti-backlog-item.md)
- [0031 — Rebase & merge branch done spec dari dashboard](adr/0031-rebase-merge-backlog.md)
- [0030 — `Spec` menyimpan baseSha/headSha; review done men-diff darinya](adr/0030-spec-menyimpan-base-head-sha.md)
- [0029 — `Execute done` hanya sah bila plan terceklist penuh](adr/0029-execute-done-butuh-plan-terceklist.md)
- [0028 — Auth: sesi opaque revocable di DB, bind 127.0.0.1 + reverse proxy TLS](adr/0028-auth-sesi-opaque-di-db.md)
- [0027 — Stage boleh mundur atas perintah human eksplisit](adr/0027-revert-stage-backward-only.md)
- [0026 — Reverse docs sebagai sesi interaktif project-level](adr/0026-reverse-docs-sesi-interaktif-project-level.md)
- [0025 — Modul VPS: tabel sendiri, script deterministik, tanpa queue](adr/0025-modul-vps-script-deterministik.md)
- [0024 — Sesi Claude Code interaktif menggantikan run](adr/0024-sesi-interaktif-menggantikan-run.md)
- [0023 — Guardrail Source of Truth dicabut](adr/0023-guardrail-sot-dicabut.md)
- [0022 — Agen bertanya, run berstatus `awaiting`](adr/0022-pertanyaan-agen-berstatus-awaiting.md) — *superseded by 0024*
- [0021 — Nomor SPEC diklaim docs, bukan hanya database](adr/0021-nomor-spec-diklaim-docs-bukan-hanya-database.md)
- [0020 — Fase perencanaan QA dipangkas oleh keputusan audit](adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md) — *mekanisme superseded by 0040*
- [0019 — SHA disimpan, diff diturunkan](adr/0019-sha-disimpan-diff-diturunkan.md)
- [0018 — Coverage diturunkan saat dibaca, bukan disimpan](adr/0018-coverage-nilai-turunan.md)
- [0017 — Run terputus melanjutkan sesinya](adr/0017-run-terputus-melanjutkan-sesinya.md) — *superseded by 0024*
- [0016 — Sesi terminal hidup di tmux](adr/0016-sesi-terminal-hidup-di-tmux.md)
- [0015 — Satu backlog, satu sesi Claude](adr/0015-one-session-per-backlog.md)
- [0014 — Sesi interaktif lewat PTY di proses API](adr/0014-pty-terminal-di-proses-api.md)
- [0013 — SoT coverage scoped to docsDir](adr/0013-sot-coverage-scoped-to-docsdir.md)
- [0012 — Biaya adalah estimasi, bukan guardrail](adr/0012-cost-is-an-estimate-not-a-guardrail.md) — *superseded by 0024*
- [0011 — Docs adalah filesystem nyata, bukan salinan DB](adr/0011-docs-realtime-filesystem.md)
- [0010 — Runner spawn `claude` CLI langsung, bukan Agent SDK](adr/0010-runner-spawns-claude-cli.md) — *sebagian superseded by 0024 (gate PreToolUse tetap)*
- [0009 — Guardrail yang crash gagal keras](adr/0009-guardrail-crash-fails-loud.md) — *historis per 0023*
- [0008 — Spec stage mirrors a real run](adr/0008-stage-mirrors-run.md) — *diamandemen 0024/0027/0029*
- [0007 — Run.finishedAt untuk durasi nyata](adr/0007-run-finished-at.md) — *de-facto obsolete (0024)*
- [0006 — GitHub App schema](adr/0006-github-app-schema.md) — *de-facto obsolete (0024)*
- [0005 — Antrian durable (BullMQ/Redis) + worker](adr/0005-durable-queue-and-worker.md) — *superseded by 0024*
- [0004 — Foundation schema deltas](adr/0004-foundation-schema-deltas.md)
- [0003 — Pemilihan model per step](adr/0003-per-step-model-selection.md) — *de-facto obsolete (0024)*
- [0002 — Isolasi run dengan git worktree](adr/0002-git-worktree-isolation.md)
- [0001 — Docs sebagai Source of Truth](adr/0001-docs-as-source-of-truth.md) — *superseded by 0023*

## operations
- [roadmap](operations/roadmap.md) · [gtm](operations/gtm.md) · [agent-documentation-workflow](operations/agent-documentation-workflow.md)
- [production](operations/production.md) — menjalankan instance prod di samping dev (database + port terpisah)
- [deploy-vps](operations/deploy-vps.md) — deploy single-host ke VPS publik di belakang reverse proxy TLS

## security
- [security-standard](security/security-standard.md)

## design-system
- [design-system](design-system/design-system.md)

## frontend
- [frontend-implementation](frontend/frontend-implementation.md)

> Chiranjivi — docs bertahan lebih lama dari satu commit atau sesi. Jaga index ini tetap sinkron.
