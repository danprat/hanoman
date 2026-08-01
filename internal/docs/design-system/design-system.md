# Design system — hanoman

Estetika **editorial instrument-panel**: bone paper hangat, ink text, satu aksen **brass** (gold-leaf wayang). Font IBM Plex (Serif display, Sans UI, Mono data/label). Hairline 1px, radius kontrol 5px / kartu 12px. Semantik earthy (leaf/amber/clay). Satu permukaan gelap: terminal log.

Detail token & komponen ada di paket design system terpisah (Hanoman Design System). Frontend wajib memakai token & komponennya — jangan menciptakan warna/tipografi baru.

## Placeholder: contoh nilai, bukan pengulangan label (SPEC-490)

Label, hint, dan placeholder menjawab tiga pertanyaan berbeda — jangan salah satu
mengerjakan pekerjaan yang lain:

| elemen | menjawab |
|---|---|
| `Field label` / `aria-label` | *field ini apa* — **wajib**, tak pernah digantikan placeholder |
| `Field hint` | *aturannya apa* (opsional: batasan & konsekuensi) |
| `placeholder` | *isinya kelihatan seperti apa* |

1. Placeholder berisi **contoh nilai nyata**, diawali `mis. ` bila nilainya bebas
   (`mis. erp-tumbuh-ai`), atau **bentuk formatnya apa adanya** bila formatnya terikat
   (`~/.ssh/id_ed25519`, `https://github.com/org/repo.git`, `-1001234567890`, `22`,
   `••••••••`).
2. **Bukan** pengulangan label (`Cari backlog…` untuk label "Cari backlog") dan **bukan**
   instruksi (`Ceritakan apa yang terjadi…`). Instruksi tempatnya di `hint`.
3. Placeholder tak pernah menggantikan label — ia hilang begitu diketik.
4. Field yang nilainya **sudah ada** boleh memakai placeholder sebagai penanda keadaan
   (`••••1234`, `biarkan kosong = pertahankan`); itu lebih berguna daripada contoh.

**Berlaku untuk** input teks (termasuk `password`/`number`/`email`/`search`),
`textarea`/`HnTextarea`, dan kolom cari combobox (`MultiSelect.searchPlaceholder` —
`placeholder`-nya adalah label tombol, bukan petunjuk kolom).

**Di luar aturan, dengan alasan:** `<Select>` native (selalu menampilkan opsi terpilih;
keadaan belum-memilih dilayani opsi pertama yang eksplisit — `Pilih branch…`), `type="date"`
dan kerabatnya (browser **mengabaikan** `placeholder` dan merender widget bawaan), serta
checkbox/radio/file. Field yang sah tak punya placeholder ditandai di call site-nya:

    {/* placeholder-exempt: <alasan> */}

Ditegakkan `src/test/placeholder-contract.test.ts` — lihat
[frontend-implementation](../frontend/frontend-implementation.md).
