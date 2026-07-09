// SPEC-143 · opsi dropdown branch, dipakai form spec baru dan detail backlog.
// "" = kirim null/undefined ke server = default project (main).
// Hidup di modulnya sendiri: App meng-import BacklogScreen, jadi menaruhnya di salah satu
// dari keduanya membuat import melingkar.
export function branchOptions(branches: string[]) {
  return [{ value: "", label: branches.length ? "main (default project)" : "project belum punya repo" }]
    .concat(branches.map((b) => ({ value: b, label: b })));
}
