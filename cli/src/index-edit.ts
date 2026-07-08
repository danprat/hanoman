import { readFileSync, writeFileSync } from "node:fs";
export function addLink(indexPath: string, relPath: string, category: string): void {
  let md = readFileSync(indexPath, "utf8");
  if (md.includes(`(${relPath})`)) return;
  const base = relPath.split("/").pop()!.replace(/\.md$/, "");
  const line = `- [${base}](${relPath})`;
  const head = `## ${category}`;
  if (md.includes(head)) {
    const i = md.indexOf(head) + head.length;
    const nl = md.indexOf("\n", i);
    md = md.slice(0, nl + 1) + line + "\n" + md.slice(nl + 1);
  } else {
    md = md.replace(/\n*$/, "\n") + `\n${head}\n${line}\n`;
  }
  writeFileSync(indexPath, md);
}
