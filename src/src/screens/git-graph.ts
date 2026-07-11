import type { GraphCommit } from "../api/client";

export type GraphRow = { commit: GraphCommit; lane: number; lanes: (string | null)[]; width: number };

// Algoritma lane klasik, satu-pass, commit terurut newest→oldest. `lanes[i]` = sha yang ditunggu
// di lane i (dipesan oleh anak yang sudah lewat). Commit menempati lane yang memesan sha-nya;
// parent pertama meneruskan lane itu, parent lain ambil lane baru. Parent yang sudah dipesan di
// lane lain (merge ke branch existing) dibiarkan — garis akan menyatu ke sana.
// ponytail: benar untuk linear/branch/merge biasa; octopus & criss-cross bisa tampak longgar —
//           upgrade ke penataan lane penuh (mis. @gitgraph/core) bila graf rumit muncul.
export function computeLanes(commits: GraphCommit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const lanes: (string | null)[] = [];
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.sha);
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) { lane = lanes.length; lanes.push(null); } }
    lanes[lane] = null; // lepaskan; dipesan ulang untuk parent
    commit.parents.forEach((p, i) => {
      if (lanes.indexOf(p) !== -1) return;       // parent sudah punya lane → biarkan menyatu
      if (i === 0) { lanes[lane] = p; return; }  // parent pertama meneruskan lane commit
      let free = lanes.indexOf(null);
      if (free === -1) { free = lanes.length; lanes.push(null); }
      lanes[free] = p;
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ commit, lane, lanes: [...lanes], width: Math.max(lanes.length, lane + 1) });
  }
  return rows;
}
