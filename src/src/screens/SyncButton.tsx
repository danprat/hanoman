/* SyncButton — pemicu sync manual (SPEC-268 · ADR-0066). Muncul HANYA di instance client
   (config.sync.running); di hub sync manual tak bermakna (data masuk otomatis dari client).
   Klik → POST /api/sync/now → toast hasil (↓pulled ↑pushed / konflik) → reload daftar (onDone). */
import React from "react";
import { Button } from "../ds";
import { api } from "../api/client";
import { ReconcileModal } from "./ReconcileModal";

// Status "instance ini client sync?" — di-cache modul (satu fetch config, dibagi 3 layar).
let cached: Promise<boolean> | null = null;
export function __resetSyncActiveCache(): void { cached = null; } // test-only
export function useSyncActive(): boolean {
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    // Robust: gagal/absen config → sembunyikan tombol (fallback aman, tak melempar ke layar).
    if (!cached) cached = (async () => { try { return (await api.getConfig()).sync?.running ?? false; } catch { return false; } })();
    let alive = true;
    cached.then((v) => { if (alive) setActive(v); });
    return () => { alive = false; };
  }, []);
  return active;
}

export function SyncButton({ onDone, onToast }:
  { onDone: () => void; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const active = useSyncActive();
  const [busy, setBusy] = React.useState<"" | "once" | "full">("");
  const [showModal, setShowModal] = React.useState(false);
  if (!active) return null;
  async function run(full: boolean) {
    setBusy(full ? "full" : "once");
    try {
      const r = full ? await api.syncNow({ full: true }) : await api.syncNow();
      if (!r.ok) onToast("Instance ini hub — tak ada sync manual", "info", "info");
      else onToast(
        `Sinkron: ↓${r.pulled ?? 0} ↑${r.pushed ?? 0}${r.conflicts ? ` · ${r.conflicts} konflik` : ""}`,
        r.conflicts ? "warn" : "ok", r.conflicts ? "triangle-alert" : "check");
      // SPEC-270 · ADR-0067 · ada konflik → buka modal rekonsil side-by-side.
      if (r.ok && r.conflicts) setShowModal(true);
      onDone();
    } catch { onToast("Gagal sync", "err", "x-circle"); }
    finally { setBusy(""); }
  }
  return (
    <>
      <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={() => run(false)} disabled={busy !== ""}>
        {busy === "once" ? "Menyinkron…" : "Sync"}
      </Button>
      {/* SPEC-382 · baris feed yang terlanjur dilompati kursor tak bisa ditarik siklus normal —
          hanya tarik ulang dari awal yang memulihkannya (mis. lampiran tiket yang hilang). */}
      <Button size="sm" variant="ghost" leftIcon="history" onClick={() => run(true)} disabled={busy !== ""}
        title="Tarik ulang seluruh feed dari awal — untuk data lama yang tak ikut tersinkron">
        {busy === "full" ? "Menarik ulang…" : "Tarik ulang"}
      </Button>
      <ReconcileModal open={showModal} onClose={() => setShowModal(false)} onResolved={onDone} />
    </>
  );
}
