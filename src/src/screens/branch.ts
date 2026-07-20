// SPEC-143 · opsi dropdown branch, dipakai form spec baru dan detail backlog.
// "" = kirim null/undefined ke server = default project (main).
// Hidup di modulnya sendiri: App meng-import BacklogScreen, jadi menaruhnya di salah satu
// dari keduanya membuat import melingkar.
// SPEC-244 · remoteOnly menandai branch yang hanya ada di origin (mis. prd/<slug>, hanoman/<audit-id>).
export function branchOptions(branches: string[], remoteOnly?: Set<string>) {
  return [{ value: "", label: branches.length ? "main (default project)" : "project belum punya repo" }]
    .concat(branches.map((b) => ({ value: b, label: remoteOnly?.has(b) ? `${b} · origin` : b })));
}

// SPEC-244 · branch yang dibuat sesi PRD, diturunkan dari path dokumennya (docs/prd/<slug>.md → prd/<slug>).
export const prdBranchOf = (prdPath: string) =>
  `prd/${prdPath.replace(/^docs\/prd\//, "").replace(/\.md$/, "")}`;
