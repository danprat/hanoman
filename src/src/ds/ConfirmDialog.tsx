// SPEC-269 · dialog konfirmasi reusable (di atas Modal). Dipakai untuk aksi hapus data.
import React from "react";
import { Modal } from "./kit";
import { Button } from "./components/forms";

export function ConfirmDialog({
  open, title, message, eyebrow, confirmLabel = "Hapus", cancelLabel = "Batal",
  tone = "danger", busy = false, onConfirm, onCancel,
}: {
  open: boolean; title: React.ReactNode; message?: React.ReactNode; eyebrow?: React.ReactNode;
  confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "default"; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal
      open={open} title={title} eyebrow={eyebrow} width={440}
      icon={tone === "danger" ? "trash-2" : "help-circle"}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button size="sm" variant="primary" leftIcon={tone === "danger" ? "trash-2" : "check"}
            onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        </>
      }>
      {message && <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55 }}>{message}</div>}
    </Modal>
  );
}
