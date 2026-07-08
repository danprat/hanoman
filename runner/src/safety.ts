export function deniesDangerous(tool: string, input: Record<string, unknown>): boolean {
  const cmd = String((input as { command?: unknown }).command ?? "");
  if (tool === "Bash" && /\brm\s+-rf\b/.test(cmd)) return true;
  if (tool === "Bash" && /git\s+push\b.*\bmain\b/.test(cmd)) return true;
  return false;
}
export const canUseTool = async (tool: string, input: Record<string, unknown>) =>
  deniesDangerous(tool, input)
    ? { behavior: "deny" as const, message: "ditolak oleh guardrail hanoman" }
    : { behavior: "allow" as const, updatedInput: input };
