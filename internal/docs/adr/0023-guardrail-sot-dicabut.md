# ADR-0023 — Guardrail Source of Truth dicabut

**Status:** diterima · 2026-07-10 · SPEC-160 · **supersedes ADR-0001**

## Konteks

ADR-0001 menegakkan `internal/docs/**` sebagai Source of Truth lewat gerbang mekanis: gate
Execute (`deps.verify` di `runner/src/run.ts`) yang menggagalkan run, subprocess `hanoman docs
verify`, dan Stop hook (`hanoman hook stop`) yang menahan giliran agen. Backlog SPEC-160
(severity major) meminta gerbang itu dicabut: *"hanoman tidak perlu ikut campur … cukup gunakan
hooks yang ada pada project nya"*.

Audit menemukan tak ada bug aktif — nol run `failed`, dua bug historis (crash path CLI RUN-8801;
switch dashboard diabaikan subprocess, `caff8d3`) sudah diperbaiki. Empat opsi ditawarkan;
manusia memilih **hapus mekanisme** secara eksplisit, menerima bahwa ini membalik ADR-0001 dan
menimpa larangan `CLAUDE.md`.

## Keputusan

Cabut keempat penegak guardrail Source of Truth: gate Execute, subprocess `docs verify`, Stop
hook (`hanoman hook stop` + `.claude/settings.json`), verify in-process CLI, plus switch dashboard
(`blockStale`/`requireLinks`) dan config knob-nya. `internal/docs/**` **tetap** Source of Truth
secara **konvensi** — didokumentasikan, diperbarui per commit — tetapi **tidak lagi ditegakkan
mesin**.

Yang **dipertahankan**: tampilan coverage/docStatus dashboard (`server/src/services/scan.ts`,
terpisah), perintah `hanoman docs scan`/`index`/`link` (read-only), dan **guardrail deny
tool-call** (`runner/src/safety.ts`: perintah destruktif seperti hapus paksa direktori, push
paksa ke `main`, atau `git worktree add`) — gerbang izin terakhir run headless (ADR-0010), di
luar cakupan tiket ini.

## Konsekuensi

- Tak ada run yang bisa berstatus `failed` karena docs stale/coverage/unlinked. `plan diblok` dan
  `guardrail tool error` (ADR-0009) menjadi jalur mati.
- Konsistensi docs kini bergantung disiplin manusia + agen, bukan gerbang. Fast-path QA (ADR-0020)
  kehilangan justifikasi "gate menjaga Execute" — perencanaan tetap dipangkas oleh keputusan
  audit, hanya tanpa gerbang di ujung.
- `Setting` kehilangan dua field JSON (`blockStale`, `requireLinks`) — tanpa migration (bukan
  kolom). Baris lama tetap terbaca.
- ADR-0001 superseded. ADR-0009 (crash fails loud) historis. `CLAUDE.md` diperbarui: larangan
  bypass diganti pernyataan pencabutan.

## Alternatif yang ditolak

- **Matikan default saja / relax ke opt-in.** Ditolak manusia — diminta cabut mekanisme, bukan
  sembunyikan switch.
- **Cabut juga deny tool-call.** Di luar cakupan; menghapusnya = run headless tanpa gerbang izin.
