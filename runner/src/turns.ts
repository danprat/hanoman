import type { ClaudeSession, CliMessage } from "./types";

export type TurnResult = {
  sessionId?: string; subtype: string; isError: boolean; apiErrorStatus?: number;
  tokensIn: number; tokensOut: number; costUsd: number;
};

// Satu pesan pengguna menghasilkan tepat satu `result` — diverifikasi terhadap claude
// v2.1.205. Karena itu batas giliran dihitung, bukan ditebak dari matinya proses. Penyamaan
// "fase selesai" dengan "stream berakhir" itulah yang dulu membuat fase Execute menggantung.
export async function takeTurn(
  s: ClaudeSession, text: string, onMessage?: (m: CliMessage) => void,
): Promise<TurnResult> {
  s.send(text);
  let sessionId: string | undefined;
  for (;;) {
    const m = await s.next();
    if (m === null) throw new Error("sesi claude berakhir sebelum `result` tiba");
    onMessage?.(m);
    if (m.type === "result") {
      return {
        sessionId: m.session_id ?? sessionId, subtype: m.subtype,
        isError: m.is_error === true, apiErrorStatus: m.api_error_status,
        tokensIn: m.usage.input_tokens, tokensOut: m.usage.output_tokens, costUsd: m.total_cost_usd,
      };
    }
    sessionId = m.session_id ?? sessionId;
  }
}
