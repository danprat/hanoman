# ADR 0006 — GitHub App schema deltas

**Status:** accepted

## Konteks
GitHub App (SPEC-006) butuh memetakan installation → repo/project dan melacak sha commit
untuk status check. Push webhook harus menemukan project dari `repository.full_name`, dan
run yang dipicu push harus tahu commit + repo mana yang dilaporkan status-nya.

## Keputusan
Tambah tabel `GithubInstallation { id Int @id; account String; repos String[] }`,
kolom `Project.installationId Int?`, serta `Run.commitSha String?` + `Run.reportRepo String?`.
Token installation **tidak disimpan** — di-mint on demand lewat `createAppAuth`
(`type: "installation"`) dan tak pernah dikirim ke client.

## Konsekuensi
- (+) push webhook terverifikasi → run; status check (`pending`/`success`/`failure`) bisa
  dilaporkan balik ke commit.
- (−) satu tabel + tiga kolom baru; butuh migration.
