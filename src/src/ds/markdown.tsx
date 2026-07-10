/* Renderer Markdown bersama (marked + kelas `.hn-md`). Diangkat dari DocsWorkspace
   (SPEC-170) supaya DocsWorkspace dan SpecDocsModal berbagi satu renderer. */
import React from "react";
import { marked } from "marked";

function hnRender(md: string) {
  try { return marked.parse(md || "", { gfm: true, breaks: false }) as string; }
  catch { return "<pre>" + String(md || "").replace(/[&<>]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c])) + "</pre>"; }
}
function hnLang(name: string) {
  return /\.json$/.test(name) ? "json" : /\.toml$/.test(name) ? "toml"
    : /\.ya?ml$/.test(name) ? "yaml" : /\.(ts|tsx|js)$/.test(name) ? "ts" : "";
}
export function hnDocHtml(text: string, name: string) {
  const md = /\.md$/.test(name) ? (text || "") : ("```" + hnLang(name) + "\n" + (text || "") + "\n```");
  return hnRender(md);
}
export function MarkdownView({ text, name }: { text: string; name: string }) {
  return <div className="hn-md" dangerouslySetInnerHTML={{ __html: hnDocHtml(text, name) }} />;
}
