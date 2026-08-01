-- SPEC-480 · ADR-0098 · putusan lead yang bisa dipakai mesin: pilihan tersimpan sebagai data.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — empat kolom NULLABLE tanpa default, tak ada tabel diredefinisi, tak
-- ada baris disentuh. Larangan SQLite atas `ADD COLUMN … DEFAULT <non-konstan>` (lihat migration
-- SPEC-408) tak berlaku di sini karena tak ada default sama sekali.
--
-- `options` menyimpan menu yang DIKIRIM PEMINTA. Tanpa itu jejaknya tak bisa dibaca ulang:
-- `question` tersimpan, opsinya tidak, jadi "lead memilih opsi 2" tak bisa diverifikasi kemudian.
ALTER TABLE "LeadDecision" ADD COLUMN "choice" TEXT;
ALTER TABLE "LeadDecision" ADD COLUMN "choiceIndex" INTEGER;
ALTER TABLE "LeadDecision" ADD COLUMN "options" JSONB;
ALTER TABLE "LeadDecision" ADD COLUMN "missing" JSONB;
