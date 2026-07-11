/* file-tree — tree file dari path datar (dipakai Review & IDE Explorer, SPEC-189). */
import React from "react";
import { Icon } from "../ds";
import type { ChangedFile } from "../api/client";

export type FileNode = { name: string; path: string; kids: FileNode[]; leaf: boolean };
export function buildFileTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", path: "", kids: [], leaf: false };
  for (const p of paths) {
    let cur = root;
    const segs = p.split("/");
    segs.forEach((seg, i) => {
      const leaf = i === segs.length - 1;
      const path = cur.path ? cur.path + "/" + seg : seg;
      let next = cur.kids.find((k) => k.name === seg && k.leaf === leaf);
      if (!next) { next = { name: seg, path, kids: [], leaf }; cur.kids.push(next); }
      cur = next;
    });
  }
  const sort = (n: FileNode) => {
    n.kids.sort((a, b) => (a.leaf === b.leaf ? a.name.localeCompare(b.name) : a.leaf ? 1 : -1));
    n.kids.forEach(sort);
  };
  sort(root);
  return root.kids;
}

export const ST_COLOR: Record<string, string> = { A: "var(--leaf-600)", M: "var(--brass-600)", D: "var(--clay-500)" };

export function TreeRow({ node, selected, onSelect, depth = 0, meta, defaultOpen = false }:
  { node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number;
    meta?: Record<string, ChangedFile>; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (node.leaf) {
    const on = node.path === selected;
    const cf = meta?.[node.path];
    return (
      <button onClick={() => onSelect(node.path)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 8px", paddingLeft: 22 + depth * 12, border: "none", cursor: "pointer",
        textAlign: "left", background: on ? "var(--brass-100)" : "transparent",
      }}>
        {cf
          ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: ST_COLOR[cf.status] }}>{cf.status}</span>
          : <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />}
        <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: on ? "var(--brass-700)" : "var(--text-body)", fontWeight: on ? 600 : 400 }}>{node.name}</span>
        {cf && !cf.binary && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <span style={{ color: "var(--leaf-600)" }}>+{cf.add}</span>{" "}
          <span style={{ color: "var(--clay-500)" }}>−{cf.del}</span>
        </span>}
      </button>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 6px", paddingLeft: 6 + depth * 12, border: "none",
        background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color="var(--brass-500)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{node.name}/</span>
      </button>
      {open && node.kids.map((k) => <TreeRow key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1} meta={meta} defaultOpen={defaultOpen} />)}
    </div>
  );
}
