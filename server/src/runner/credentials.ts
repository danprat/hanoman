// Env vars any one of which authenticates the Claude Agent SDK (SPEC-007). Order
// mirrors the SDK's resolution precedence; we only check presence (non-empty).
const ENV_CRED_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

export type CredCheck = { ok: boolean; hasEnvCred: boolean; found: string[]; reason?: string };

// Decide whether the worker may boot given the credentials in `env`. Pure: reads
// nothing beyond its args, so it is fully unit-testable. `ok:false` → refuse;
// `ok:true` + `hasEnvCred:false` → warn-and-boot.
export function checkRunnerCredentials(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): CredCheck {
  if ((env.HANOMAN_SKIP_CRED_CHECK ?? "").trim() !== "")
    return { ok: true, hasEnvCred: false, found: [], reason: "credential check bypassed via HANOMAN_SKIP_CRED_CHECK" };
  const found = ENV_CRED_VARS.filter((v) => (env[v] ?? "").trim() !== "");
  if (found.length) return { ok: true, hasEnvCred: true, found };
  if (isTTY)
    return { ok: true, hasEnvCred: false, found, reason: "no Claude credential in env; relying on keychain login (interactive)" };
  return { ok: false, hasEnvCred: false, found, reason: "no Claude credential in env; a headless worker cannot rely on the keychain" };
}
