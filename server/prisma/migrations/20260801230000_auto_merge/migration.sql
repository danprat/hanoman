-- SPEC-486 · ADR-0103 · kebijakan auto-merge saat sesi selesai.
--
-- ADITIF & nullable tanpa default → `ADD COLUMN` polos (pola migration SPEC-447). Yang dilarang
-- SQLite adalah `ADD COLUMN … DEFAULT <non-konstan>`, bukan `ADD COLUMN` itu sendiri. Baris lama
-- tetap NULL, dan NULL berarti "tanpa auto-merge" di Project / "warisi project" di Spec —
-- jadi tak ada backfill, dan project lama tak berubah perilaku satu langkah git pun.
ALTER TABLE "Project" ADD COLUMN "autoMerge" JSONB;
ALTER TABLE "Spec" ADD COLUMN "autoMerge" JSONB;
