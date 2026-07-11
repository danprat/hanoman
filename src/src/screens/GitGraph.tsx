import React from "react";
import type { GitOp } from "../api/client";
// Stub — diisi penuh di Task 7 (SPEC-182).
export function GitGraph(_: { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>; onOpenFile: (p: string, ref: string) => void }) {
  return <div />;
}
