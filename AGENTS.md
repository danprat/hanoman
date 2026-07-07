# AGENTS.md

Kontrak untuk **setiap agent** (Claude Code, Codex) yang bekerja di repo hanoman. Dibaca otomatis sebelum mengeksekusi apa pun.

## Aturan
1. **Docs adalah Source of Truth.** `internal/docs/**` menang atas ingatan/asumsi. Ragu → baca doc.
2. **Jangan execute melewati docs stale.** Bila doc acuan usang, perbarui index dulu. Stop hook memblokir bila dilanggar.
3. **Alur fitur:** spec → plan → execute. **Alur QA:** audit → spec → plan → execute.
4. **Setiap perubahan** menyentuh docs yang relevan & menautkannya di index (`internal/docs/README.md`).
5. **Setiap run terisolasi di git worktree sendiri.** Pull dari branch mana pun, push ke branch mana pun. Jangan menyentuh worktree run lain.

## Perintah
```bash
hanoman spec SPEC-xxx      # tulis spec dari brief/finding
hanoman plan SPEC-xxx      # rencanakan langkah
hanoman execute SPEC-xxx   # jalankan + test + update docs
hanoman scaffold --project P --from objective   # scaffold doc index (from-scratch)
hanoman reverse --project P --dir <path>        # reverse-engineer docs (existing)
```

## Definition of done
- Test hijau.
- Docs yang tersentuh diperbarui + ter-link.
- Diff bersih di worktree; siap push ke target branch.
