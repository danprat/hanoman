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
- [audit SPEC-217 — path project optional](research/audit-spec-217-path-project-optional.md) — binding per-client SPEC-213 hanya setengah tersambung (spawn/IDE saja), tanpa UI & tak editable
- [audit SPEC-223 — scaffold project baru gagal (2 bug)](research/audit-spec-223-scaffold-repo-missing.md) — (1) `spawnSync git ENOENT` = cwd/repoDir hilang → `initRepo` idempoten sebelum `addWorktree`; (2) `tmux … command too long` = prompt besar inline di command tmux → prompt lewat berkas + `"$(cat)"` (ADR-0016)
- [audit SPEC-227 — review diff 500 `Not a valid object name main`](research/audit-spec-227-review-merge-base-main.md) — review worktree hidup hardcode fallback `main`; repo default `master`/`develop` → `git merge-base main HEAD` exit 128. Basis diff pakai `spec.baseSha` (fork tersimpan, SPEC-197/ADR-0030) lalu default repo yang benar-benar resolve, tak pernah literal "main"
- [audit SPEC-229 — merge via git graph selalu gagal (buntu tanpa sesi claude)](research/audit-spec-229-merge-git-graph-selalu-gagal.md) — jalur git graph (`runGitOp`) tak pernah warisi ADR-0031: konflik merusak working tree utama & "Force" gagal senyap, gerbang sesi aktif balas 409 di tiap merge. Fix: deterministik dulu, konflik/409 → sesi claude di worktree isolasi (pola integrate)
- [audit SPEC-230 — PRD jalan tanpa aksi lanjutan (review, merge/rebase)](research/audit-spec-230-prd-review-merge.md) — sesi PRD project-level tak punya `specId`; review+integrate terkopel `Spec` (frontend & server) → sel PRD polos. Fix: jalur review+integrate ber-skop sesi (branch `prd/<slug>` disimpan di sesi), tanpa perubahan skema (ADR-0054)

## architecture
- [stack](architecture/stack.md) · [data-model](architecture/data-model.md) · [api-contract](architecture/api-contract.md) · [nfr](architecture/nfr.md)
- [vps-compliance](architecture/vps-compliance.md) — kerangka kepatuhan checklist 232 item (SPEC-220 · ADR-0050)

## adr
> Nomor unik & imutable. ADR usang tidak dihapus — ditandai statusnya di bawah dan di header masing-masing.
- [0058 — Model & effort per fase, lewat `/model`+`/effort` in-session](adr/0058-model-effort-per-fase.md) — **mengamandemen 0024, sebagian menghidupkan 0003** (SPEC-238)
- [0057 — Audit-only sebagai source + flow (dokumen, tanpa perbaikan)](adr/0057-audit-only-source-flow.md) — SPEC-237
- [0056 — Terminal biasa = shell mentah di repoDir project (bukan claude)](adr/0056-terminal-shell-non-claude.md) — SPEC-236, pola ADR-0042
- [0055 — Git graph parity: taksonomi operasi + eksekusi berlapis](adr/0055-git-graph-parity-op-taxonomy.md) — **memperluas 0034/0053** (SPEC-233)
- [0054 — Review + integrate ber-skop sesi untuk sesi project-level (PRD)](adr/0054-review-integrate-ber-skop-sesi-untuk-prd.md) — **memperluas 0041**
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
- [0040 — Jalur cepat qa dielicit lewat prompt, diputuskan agen](adr/0040-jalur-cepat-qa-dielicit-prompt.md) — **supersedes mekanisme 0020**
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
- [0024 — Sesi Claude Code interaktif menggantikan run](adr/0024-sesi-interaktif-menggantikan-run.md) — **supersedes 0005/0012/0017/0022, sebagian 0010, melemahkan 0008**
- [0023 — Guardrail Source of Truth dicabut](adr/0023-guardrail-sot-dicabut.md) — **supersedes 0001**
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
