import { effectiveStr } from "../config";
import { enqueueOutbox } from "./outbox";
import { publishLocal, isEntity } from "./sync";

// SPEC-268 · ADR-0066 · sebarkan write LOKAL ke peer, sadar-peran:
//  - client (SYNC_SERVER_URL ada) → enqueueOutbox → syncOnce push ke hub (perilaku lama).
//  - hub (SYNC_SERVER_URL kosong) → publishLocal → masuk change-feed sendiri → client pull.
// Best-effort: kegagalan TIDAK menggagalkan write utama (cermin enqueueOutbox).
export async function notifySynced(entity: string, id: string): Promise<void> {
  try {
    if (!isEntity(entity)) return;
    if (effectiveStr("SYNC_SERVER_URL")) await enqueueOutbox(entity, id);
    else await publishLocal(entity, id);
  } catch { /* jangan blok write utama */ }
}
