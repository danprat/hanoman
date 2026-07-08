import { prisma } from "../db";
import type { StepModels } from "@hanoman/runner";
async function data() { return (await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).data as any; }
export async function stepModels(): Promise<StepModels> { return (await data()).steps; }
export async function maxConcurrent(): Promise<number> { return (await data()).maxConcurrent ?? 3; }
export async function dailyBudget(): Promise<number> { return (await data()).dailyBudget ?? 50; }
