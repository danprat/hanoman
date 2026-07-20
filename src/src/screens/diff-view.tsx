/* diff-view — render unified diff berwarna (dipakai Review & IDE Explorer, SPEC-234). */
import React from "react";
import { StateBlock } from "../ds";

export function DiffView({ diff }: { diff: string }) {
  if (!diff) return <StateBlock kind="empty" icon="check" title="Tidak ada perubahan pada file ini"
    hint="File ini bagian dari project tapi tak diubah." />;
  return (
    <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6 }}>
      {diff.split("\n").map((line, i) => {
        const plus = line.startsWith("+") && !line.startsWith("+++");
        const minus = line.startsWith("-") && !line.startsWith("---");
        const hunk = line.startsWith("@@");
        const color = plus ? "var(--leaf-600)" : minus ? "var(--clay-600)" : hunk ? "var(--brass-700)" : "var(--text-body)";
        const bg = plus ? "color-mix(in srgb, var(--leaf-500) 10%, transparent)"
          : minus ? "color-mix(in srgb, var(--clay-500) 10%, transparent)" : "transparent";
        return <div key={i} style={{ color, background: bg, padding: "0 12px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || " "}</div>;
      })}
    </pre>
  );
}
