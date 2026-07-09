// Berdiri sebagai `claude -p --input-format stream-json` di test ClaudeSession.
// Mengabaikan argv (flag claude tak berarti baginya) dan menegakkan kontrak yang
// diverifikasi terhadap binary asli v2.1.205: satu pesan pengguna → tepat satu
// `result`, satu `session_id` sepanjang proses, dan proses hidup sampai stdin EOF.
import { createInterface } from "node:readline";

let n = 0;
createInterface({ input: process.stdin })
  .on("line", (line) => {
    if (!line.trim()) return;
    n++;
    process.stdout.write(JSON.stringify({
      type: "result", subtype: "success", session_id: "sess-1",
      total_cost_usd: 0.01 * n, usage: { input_tokens: 1, output_tokens: n },
    }) + "\n");
  })
  .on("close", () => process.exit(0));
