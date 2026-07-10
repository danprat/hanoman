import { z } from "zod";
// Knob guardrail (requireLinks/blockStale/coverageThreshold) dicabut, SPEC-160. Sisa `docsDir`
// dipakai untuk menemukan direktori docs (resolveRepo, server/services/scan).
export const zHanomanConfig = z.object({
  docsDir: z.string().default("internal/docs"),
});
export type HanomanConfig = z.infer<typeof zHanomanConfig>;
