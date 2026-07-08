import { z } from "zod";
export const zHanomanConfig = z.object({
  docsDir: z.string().default("internal/docs"),
  requireLinks: z.boolean().default(true),
  blockStale: z.boolean().default(true),
  coverageThreshold: z.number().int().min(0).max(100).default(100),
});
export type HanomanConfig = z.infer<typeof zHanomanConfig>;
