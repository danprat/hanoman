// SPEC-220 · skor kepatuhan = (pass + attested) / applicable (AC-6). Fungsi murni; katalog
// disuntik (default CATALOG) agar matematikanya bisa diuji lepas dari 232 item nyata.
import { CATALOG, type CatalogItem } from "./catalog/catalog";

export type ItemStatus = "pass" | "fail" | "warn" | "na" | "unknown";
export type ProbeStatus = "pass" | "fail" | "warn" | "unknown";
export type ItemState = { na?: boolean; attested?: boolean };
export type Scored = {
  total: number;                       // 0..100
  bySection: Record<string, number>;   // 0..100 per seksi
  status: Record<string, ItemStatus>;  // status turunan per item
};

type ScoreItem = Pick<CatalogItem, "id" | "section" | "mode">;

const pct = (fulfilled: number, applicable: number): number =>
  applicable === 0 ? 100 : Math.round((fulfilled / applicable) * 100);

export function scoreCompliance(
  probeStatus: Record<string, ProbeStatus>,
  states: Record<string, ItemState>,
  items: ScoreItem[] = CATALOG,
): Scored {
  const status: Record<string, ItemStatus> = {};
  const secApplicable: Record<string, number> = {};
  const secFulfilled: Record<string, number> = {};
  let totApplicable = 0;
  let totFulfilled = 0;

  for (const it of items) {
    const st = states[it.id] ?? {};
    if (st.na) { status[it.id] = "na"; continue; } // keluar pembilang & penyebut (AC-10)

    totApplicable++;
    secApplicable[it.section] = (secApplicable[it.section] ?? 0) + 1;

    let fulfilled = false;
    const ps = probeStatus[it.id];
    if (ps !== undefined) {
      status[it.id] = ps;            // item ber-probe: status = hasil probe (unknown ≠ pass, AC-7)
      fulfilled = ps === "pass";
    } else if (it.mode === "INFO" && st.attested) {
      status[it.id] = "pass";        // INFO ter-attest = terpenuhi (AC-11)
      fulfilled = true;
    } else {
      status[it.id] = "unknown";     // belum diprobe / belum di-attest
    }

    if (fulfilled) {
      totFulfilled++;
      secFulfilled[it.section] = (secFulfilled[it.section] ?? 0) + 1;
    }
  }

  const bySection: Record<string, number> = {};
  for (const sec of Object.keys(secApplicable)) {
    bySection[sec] = pct(secFulfilled[sec] ?? 0, secApplicable[sec]);
  }
  return { total: pct(totFulfilled, totApplicable), bySection, status };
}
