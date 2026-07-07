# Security standard

- **Kredensial**: token GitHub App & API model disimpan terenkripsi (server-side), tak pernah ke client.
- **Permissions agent**: dibatasi via `.claude/settings.json` (deny `rm -rf`, deny push langsung ke `main`).
- **Isolasi**: run di worktree; tak ada akses ke luar direktori project.
- **Webhook**: verifikasi signature GitHub.
- **Anggaran**: batas harian mencegah biaya liar.
