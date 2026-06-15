/**
 * Merge-field resolver. Messages personalize via {client.name}, {broker.company}, etc.
 * The vocabulary is FIXED: the graph validator rejects unknown tokens at save time, so a
 * broken token can never reach a real send. At runtime a missing value renders as "" — we
 * never print a raw {token} to a client.
 */

// Render a Date as a friendly "Month D, YYYY"; missing → "".
function fmtDate(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { dateStyle: "long" });
}

// token -> (ctx) => string
const RESOLVERS = {
  "client.name": (c) => c.client?.name || "",
  "client.firstName": (c) => (c.client?.name || "").trim().split(/\s+/)[0] || "",
  "client.email": (c) => c.client?.email || "",
  "client.phone": (c) => c.client?.phone || "",
  "client.company": (c) => c.client?.company || "",
  "client.stage": (c) => c.client?.stage || "",
  "client.intent": (c) => c.client?.intent || "",
  "client.budget": (c) => (c.client?.budget != null ? String(c.client.budget) : ""),
  "client.requirements": (c) => c.client?.requirements || "",
  "client.nextAction": (c) => c.client?.nextAction || "",
  "transaction.status": (c) => c.client?.transaction?.status || "",
  "transaction.contractDate": (c) => fmtDate(c.client?.transaction?.contractDate),
  "transaction.inspectionDate": (c) => fmtDate(c.client?.transaction?.inspectionDate),
  "transaction.appraisalDate": (c) => fmtDate(c.client?.transaction?.appraisalDate),
  "transaction.loanContingencyDate": (c) => fmtDate(c.client?.transaction?.loanContingencyDate),
  "transaction.closingDate": (c) => fmtDate(c.client?.transaction?.closingDate),
  "broker.name": (c) => c.user?.name || "",
  "broker.company": (c) => c.user?.company || "",
  "broker.phone": (c) => c.user?.phone || "",
  "broker.email": (c) => c.user?.email || "",
  "date.today": () => new Date().toLocaleDateString("en-US", { dateStyle: "long" }),
};

export const KNOWN_MERGE_FIELDS = Object.keys(RESOLVERS);

const TOKEN_RE = /\{\s*([a-zA-Z0-9_.]+)\s*\}/g;

/** All tokens referenced in a piece of text (deduped). */
export function extractTokens(text) {
  if (typeof text !== "string") return [];
  const out = new Set();
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

/** Tokens that are NOT in the known vocabulary — used by the validator. */
export function unknownTokens(text) {
  return extractTokens(text).filter((t) => !(t in RESOLVERS));
}

/** Resolve all known tokens; unknown/missing render as "". */
export function resolveMerge(text, ctx = {}) {
  if (typeof text !== "string") return text;
  return text.replace(TOKEN_RE, (_full, token) => {
    const fn = RESOLVERS[token];
    if (!fn) return ""; // validator should have caught this; fail closed
    try {
      return String(fn(ctx) ?? "");
    } catch {
      return "";
    }
  });
}
