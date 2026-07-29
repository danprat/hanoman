/* DocPreviewModal (SPEC-385) — pratinjau `.md` terender di ruang baca lebar, dipanggil sebagai
   AKSI dari permukaan yang berorientasi diff/kode (IDE Explorer, Git Graph, Review). Sengaja
   tak tahu apa-apa soal spec/ide/review: pemanggil menyerahkan isi + (opsional) URL unduh
   ADR-0078, jadi komponen ini tak pernah menyentuh api client.

   Tinggi diwarisi dari panel modal lewat `fillHeight` (SPEC-363) — jangan menaruh angka px/vh
   di rantai ini; `.hn-md` sudah memasang overflow-wrap/table-layout/pre-wrap secara global. */
import React from "react";
import { Modal } from "./kit";
import { StateBlock } from "./components/state";
import { MarkdownView } from "./markdown";
import { DocDownload } from "./DocDownload";

export function DocPreviewModal({ path, text, eyebrow, download, onClose }: {
  path: string; text: string; eyebrow?: React.ReactNode;
  download?: (fmt: "md" | "pdf") => string; onClose: () => void;
}) {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  return (
    <Modal open title={name} eyebrow={eyebrow ?? path} icon="book-open"
      onClose={onClose} width={980} fillHeight>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {download && (
          <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 6,
            borderBottom: "1px solid var(--border-hair)", marginBottom: 8 }}>
            <DocDownload href={download} />
          </div>
        )}
        <div data-testid="doc-preview-scroll"
          style={{ flex: "1 1 0", minHeight: 0, overflow: "auto", padding: "0 4px 8px" }}>
          {text
            ? <MarkdownView text={text} name={path} />
            : <StateBlock kind="empty" icon="file-text" title="Berkas kosong" hint={path} />}
        </div>
      </div>
    </Modal>
  );
}
