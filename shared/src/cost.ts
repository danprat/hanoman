// Runs authenticate with an OAuth subscription (CLAUDE_CODE_OAUTH_TOKEN), so the
// total_cost_usd claude reports is what an API-key user *would* have paid — not an invoice.
// Render it as an estimate everywhere. One formatter so the server writer, the SSE reducer,
// and the seed row cannot drift apart.
export const fmtEstCost = (usd: number) => `~$${usd.toFixed(2)}`;

// Budget math strips everything but digits and ".", so the "~" prefix is safe.
export const parseEstCost = (s: unknown): number => parseFloat(String(s).replace(/[^0-9.]/g, "")) || 0;
