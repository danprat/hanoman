/* DocDownload (SPEC-361 · ADR-0077) — sepasang tombol unduh untuk setiap pratinjau dokumen.
   Anchor sungguhan (bukan onClick) supaya `content-disposition` server yang menentukan nama
   berkas; cookie sesi ikut terkirim same-origin, jadi gate auth ADR-0028 berlaku apa adanya. */
import React from "react";
import { Button } from "./components/forms";

export function DocDownload({ href, disabled = false, size = "sm" }:
  { href: (fmt: "md" | "pdf") => string; disabled?: boolean; size?: "sm" | "md" }) {
  if (disabled) return null;
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <Button as="a" href={href("md")} download size={size} variant="ghost"
        leftIcon="download" title="Unduh sumber Markdown" aria-label="Unduh .md">.md</Button>
      <Button as="a" href={href("pdf")} download size={size} variant="ghost"
        leftIcon="file-down" title="Unduh sebagai PDF" aria-label="Unduh .pdf">.pdf</Button>
    </div>
  );
}
