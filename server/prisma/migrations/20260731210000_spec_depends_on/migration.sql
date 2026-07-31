-- SPEC-447 · ADR-0093 · dependency antar-backlog.
--
-- ADITIF & nullable tanpa default → `ADD COLUMN` polos sudah cukup. Beda dari migration SPEC-408
-- yang harus meredefinisi tabel: yang dilarang SQLite adalah `ADD COLUMN … DEFAULT <non-konstan>`,
-- bukan `ADD COLUMN` itu sendiri. Baris lama tetap NULL, dan pembaca menerjemahkan NULL → []
-- (`dependsOnOf` di services/spec-deps.ts) — jadi tak ada backfill yang perlu dilakukan.
ALTER TABLE "Spec" ADD COLUMN "dependsOn" JSONB;
