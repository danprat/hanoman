import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { projects, backlog, runs, triggers, docFiles, defaultSetting } from "./proto-data";

export async function seed() {
  await prisma.$transaction([
    prisma.docFile.deleteMany(), prisma.trigger.deleteMany(), prisma.run.deleteMany(),
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
  ]);
  await prisma.project.createMany({ data: projects });
  await prisma.spec.createMany({ data: backlog });
  await prisma.run.createMany({ data: runs });
  await prisma.trigger.createMany({ data: triggers });
  await prisma.docFile.createMany({ data: docFiles });
  await prisma.setting.create({ data: { id: 1, data: defaultSetting as unknown as Prisma.InputJsonValue } });
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed().then(() => { console.log("seeded"); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
