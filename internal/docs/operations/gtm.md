# Go-to-market

hanoman internal. "Peluncuran" berarti **adopsi oleh tim nafanesia.id**, bukan penjualan — tak ada
harga, funnel, maupun kampanye. Lihat [pricing-rationale](../business/pricing-rationale.md).

## Definisi sukses (terukur)

1. **Semua project baru masuk lewat hanoman** — dibuat dari layar Projects (from-scratch ber-scaffold
   docs atau existing ber-reverse docs), bukan `git init` manual di terminal.
2. **Docs tersentuh diperbarui dalam commit yang sama** — terpantau lewat coverage per project di
   Overview; drift terlihat tanpa perlu ada yang melapor.
3. **Backlog bergerak lewat sesi, bukan tangan** — stage maju karena fase yang dilaporkan sesi, bukan
   karena seseorang menggeser kartu ([ADR-0027](../adr/0027-revert-stage-backward-only.md): mundur
   hanya lewat aksi manusia eksplisit).
4. **Laporan masuk jadi backlog tanpa salin-tempel** — tiket Help Center dan grup error tereskalasi
   langsung jadi spec.
5. **Operator baru produktif < 10 menit** — lihat [onboarding](../product/onboarding.md).

## Urutan adopsi

1. Satu operator, satu project — buktikan siklus penuh brief → spec → plan → execute → review → merge.
2. Tambah project existing lewat **Reverse docs**; SoT disusun dari kode yang sudah ada, bukan ditulis
   dari nol.
3. Nyalakan Help Center & error monitoring per project — di sinilah nilainya paling terasa, karena
   masukan datang tanpa diminta.
4. Nyalakan scheduler (opt-in, default mati) hanya setelah tiga langkah di atas stabil
   ([ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)).

## Distribusi yang memang sudah ada

Meski hanoman tak dijual, sebagian permukaannya publik:

- **Repo publik/open-source** — karena itu deploy-vps mewajibkan tak ada nilai sensitif (host, token,
  kunci) yang pernah masuk repo.
- **`hanoman-sdk` di npm** ([ADR-0063](../adr/0063-hanoman-sdk-npm-package.md)) — project lain memasang
  paketnya untuk mengirim error ke instance hanoman; lihat [sdk/README.md](../../../sdk/README.md).
- **Panduan integrasi AI agent** ([ADR-0065](../adr/0065-ai-agent-capability-agent-token.md)) — agen
  eksternal memakai `/api` lewat agent token ber-capability; lihat
  [agent-integration](../../../docs/agent-integration.md).
- **Help Center publik per project** — halaman `/help/<project>` yang dipakai pelapor di luar tim.

## Batas yang disengaja

**Satu workspace dulu** (nafanesia.id). Multi-tenant adalah pasca-MVP: tak ada RBAC, semua user setara,
dan cookie berarti akses penuh. Membuka hanoman untuk tim di luar nafanesia.id menuntut model izin lebih
dulu — itu keputusan produk, bukan pekerjaan konfigurasi. Lihat
[scope-principles](../product/scope-principles.md).
