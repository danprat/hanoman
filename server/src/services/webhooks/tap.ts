import {
  diffFields, entityDefForModel,
  type WebhookAction, type WebhookEntityDef,
} from "@hanoman/shared";

// SPEC-481 · ADR-0100 · SATU choke point untuk seluruh peristiwa perubahan.
//
// Kenapa di layer Prisma dan bukan di call site: hanoman sudah tiga kali kena kelas bug "satu
// definisi, N call site" (SPEC-431 predikat, SPEC-448 env spawn, SPEC-475 efek samping), dan
// SPEC-475 mencatat bahwa efek samping paling licin karena tak punya tipe yang memaksanya
// konsisten. "Pancarkan peristiwa" adalah efek samping murni. Di sini ia tak bisa dilupakan.
//
// Modul ini sengaja TIDAK meng-import `../../db`: `db.ts` yang mem-`$extends` dengannya, jadi
// import balik akan melingkar. Klien dasar dioper sebagai argumen; sink didaftarkan belakangan
// (cermin `registerSessionHooks`, ADR-0079) sehingga sebelum `installWebhooks()` tap benar-benar
// tak melakukan apa pun.

export type TapEmit = {
  def: WebhookEntityDef;
  action: WebhookAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed: string[];
  cascade?: Record<string, number>;
};

export type TapSink = { active: () => boolean; emit: (i: TapEmit) => void };

let sink: TapSink | null = null;
export function registerWebhookTap(s: TapSink): void { sink = s; }
export function __resetWebhookTap(): void { sink = null; }   // test-only

type Row = Record<string, unknown>;
type Delegate = {
  findUnique: (a: unknown) => Promise<Row | null>;
  findMany: (a: unknown) => Promise<Row[]>;
  count: (a: unknown) => Promise<number>;
};
export type TapBase = Record<string, unknown>;

const delegateName = (model: string): string => model[0]!.toLowerCase() + model.slice(1);
const del = (base: TapBase, model: string): Delegate =>
  (base as Record<string, Delegate>)[delegateName(model)]!;

/** Aktif hanya bila sink terpasang DAN ada endpoint yang mendengarkan. */
const on = (model: string): WebhookEntityDef | null => {
  if (!sink?.active()) return null;
  return entityDefForModel(model) ?? null;
};

const fire = (i: TapEmit): void => { try { sink?.emit(i); } catch { /* jangan sentuh jalur tulis */ } };

/** Jumlah anak yang akan ikut terhapus cascade DB — satu-satunya jejak yang tersisa dari mereka. */
async function cascadeCounts(
  base: TapBase, def: WebhookEntityDef, id: string,
): Promise<Record<string, number> | undefined> {
  if (!def.cascade?.length) return undefined;
  const out: Record<string, number> = {};
  for (const child of def.cascade) {
    try { out[child] = await (base as Record<string, Delegate>)[child]!.count({ where: { projectId: id } }); }
    catch { /* anak yang tak bisa dihitung dilewati, bukan menggagalkan delete */ }
  }
  return out;
}

type Ctx<A, R> = { model: string; args: A; query: (a: A) => Promise<R> };

export function webhookTap(base: TapBase) {
  const pre = async (model: string, where: unknown): Promise<Row | null> => {
    try { return await del(base, model).findUnique({ where }); } catch { return null; }
  };

  return {
    name: "hanoman-webhook-tap",
    query: {
      $allModels: {
        async create({ model, args, query }: Ctx<unknown, Row>) {
          const after = await query(args);
          const def = on(model);
          if (def) fire({ def, action: "created", before: null, after, changed: [] });
          return after;
        },

        async update({ model, args, query }: Ctx<{ where: unknown }, Row>) {
          const def = on(model);
          const before = def ? await pre(model, args.where) : null;
          const after = await query(args);
          if (def && before) {
            const changed = diffFields(def, before, after);
            if (changed.length) fire({ def, action: "updated", before, after, changed });
          }
          return after;
        },

        async upsert({ model, args, query }: Ctx<{ where: unknown }, Row>) {
          const def = on(model);
          const before = def ? await pre(model, args.where) : null;
          const after = await query(args);
          if (def) {
            if (!before) fire({ def, action: "created", before: null, after, changed: [] });
            else {
              const changed = diffFields(def, before, after);
              if (changed.length) fire({ def, action: "updated", before, after, changed });
            }
          }
          return after;
        },

        async delete({ model, args, query }: Ctx<{ where: unknown }, Row>) {
          const def = on(model);
          const before = def ? await pre(model, args.where) : null;
          const cascade = def && before ? await cascadeCounts(base, def, String(before.id)) : undefined;
          const out = await query(args);
          if (def && before) fire({ def, action: "deleted", before, after: null, changed: [], cascade });
          return out;
        },

        // `liveSpecs` memajukan stage lewat CAS `updateMany` — jalur perubahan stage yang PALING
        // sering dipakai. Melewatkannya berarti melewatkan peristiwa yang paling diminta.
        async updateMany({ model, args, query }: Ctx<{ where?: unknown }, { count: number }>) {
          const def = on(model);
          if (!def) return query(args);
          let before: Row[] = [];
          try { before = await del(base, model).findMany({ where: args.where }); } catch { /* biar lewat */ }
          const out = await query(args);
          if (before.length) {
            const ids = before.map((r) => r.id);
            let after: Row[] = [];
            try { after = await del(base, model).findMany({ where: { id: { in: ids } } }); } catch { /* — */ }
            const byId = new Map(after.map((r) => [r.id, r]));
            for (const b of before) {
              const aft = byId.get(b.id);
              if (!aft) continue;
              const changed = diffFields(def, b, aft);
              if (changed.length) fire({ def, action: "updated", before: b, after: aft, changed });
            }
          }
          return out;
        },

        async deleteMany({ model, args, query }: Ctx<{ where?: unknown }, { count: number }>) {
          const def = on(model);
          if (!def) return query(args);
          let before: Row[] = [];
          try { before = await del(base, model).findMany({ where: args.where }); } catch { /* — */ }
          const out = await query(args);
          for (const b of before)
            fire({ def, action: "deleted", before: b, after: null, changed: [] });
          return out;
        },
      },
    },
  };
}
