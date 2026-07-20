/* IntegrationGuideModal — menampilkan panduan integrasi SDK (isi `sdk/README.md`) di dalam web
   hanoman, dirender sebagai markdown. Dipakai dari header area Errors dan dari kartu DSN project.
   Sumber tunggal tetap file `sdk/README.md` di repo (dibaca lewat GET /api/errors/integration-guide). */
import React from "react";
import { Modal, MarkdownView, StateBlock, Button } from "../ds";
import { api } from "../api/client";

export function IntegrationGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");

  const load = React.useCallback(() => {
    setState("loading");
    api.getIntegrationGuide()
      .then((r) => { setText(r.text); setState("ready"); })
      .catch(() => setState("error"));
  }, []);
  // Muat sekali saat modal pertama dibuka; isi di-cache untuk buka berikutnya.
  React.useEffect(() => { if (open && text === null && state !== "error") load(); }, [open, text, state, load]);

  return (
    <Modal open={open} onClose={onClose} icon="book-open" eyebrow="error monitoring"
      title="Panduan integrasi SDK" width={760}
      footer={<Button size="sm" variant="ghost" onClick={onClose}>Tutup</Button>}>
      {state === "loading" ? <StateBlock kind="loading" title="Memuat panduan…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat panduan integrasi"
            hint="Pastikan server hanoman berjalan." action={load} actionLabel="Coba lagi" />
        : <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <MarkdownView text={text ?? ""} name="README.md" />
          </div>}
    </Modal>
  );
}
