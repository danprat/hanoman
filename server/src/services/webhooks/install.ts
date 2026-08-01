import { refreshWebhookCache, webhooksActive } from "./endpoints";
import { registerWebhookTap } from "./tap";
import { emitWebhook } from "./emit";

// SPEC-481 · ADR-0099 · menghubungkan tap (yang tak boleh meng-import `db.ts`) dengan pengirimnya
// (yang harus). Dipanggil `server.ts` sebelum request pertama; sebelum itu tap diam total.
export async function installWebhooks(): Promise<void> {
  await refreshWebhookCache();
  registerWebhookTap({
    active: webhooksActive,
    // Fire-and-forget: tulisan yang memicunya tak boleh menunggu fan-out (janji "endpoint lambat
    // tak memperlambat hanoman"). `emitWebhook` sudah menelan galatnya sendiri.
    emit: (i) => { void emitWebhook(i); },
  });
}
