-- SPEC-484 · ADR-0101 · penyaring mesin sesi per definisi agen.
--
-- NULLABLE TANPA DEFAULT, dan itu yang membuat migration ini satu baris: setiap baris lama tetap
-- NULL = "ikut sesi induk" = perilaku ADR-0094 apa adanya, jadi tak ada backfill dan tak ada satu
-- pun roster yang berubah saat rilis ini mendarat. Larangan SQLite atas
-- `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` (migration SPEC-408) tak berlaku di sini justru karena
-- kolomnya tanpa default — tabel tak perlu diredefinisi.
ALTER TABLE "CustomAgent" ADD COLUMN "runtime" TEXT;
