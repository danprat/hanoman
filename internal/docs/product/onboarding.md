# Onboarding

Operator baru harus bisa memantau dalam < 10 menit.

1. Buat akun pertama / masuk (email + password; SPEC-169).
2. Tambah project: **from-scratch** (pilih folder → hanoman `git init` repo → tombol **Scaffold docs**, atau auto-start bila `autoScaffold` on → sesi interaktif brainstorm ide → objective → seluruh doc index; fase Brainstorm dijawab di Terminal) atau **existing** (pilih direktori → tombol **Reverse docs** menyusun Source of Truth lewat sesi interaktif; fase Wawancara dijawab di Terminal).
3. Buka backlog, mulai sesi untuk sebuah item (atau ambil dari Terminal).
4. Pantau di Overview & Terminal; review & rebase/merge branch saat backlog `done`.

## Telegram (opsional · SPEC-476/ADR-0096)

1. Buat satu bot di BotFather; simpan token hanya sebagai `HANOMAN_TELEGRAM_BOT_TOKEN`.
2. Isi `HANOMAN_TELEGRAM_ALLOWED_USER_IDS` dengan numeric user id private-chat yang diizinkan.
3. Di Settings → Akses AI Agent, hidupkan master switch dan buat AgentToken dengan capability yang
   memang boleh dipakai operator; simpan plaintext sekali itu sebagai `HANOMAN_TELEGRAM_AGENT_TOKEN`.
4. Restart service, buka Settings → Telegram, pastikan readiness hijau, lalu nyalakan gateway.
5. Kirim `/status`. Chat diikat ke satu session operator tmux dan pesan berikutnya kembali ke session
   yang sama. Token tidak pernah diisikan atau ditampilkan di UI/Telegram.
