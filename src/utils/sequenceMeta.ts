/**
 * Client-side mirror of the block catalog: enough metadata to render the palette,
 * the per-node config forms, and the correct edge handles on the canvas. The server's
 * BlockRegistry + graph validator remain the source of truth — this only shapes the UI;
 * every save is re-validated server-side.
 */

export type Family = "trigger" | "action" | "control" | "exit";

export interface SeqNode {
  id: string;
  type: string;
  family: Family;
  config: Record<string, any>;
  position: { x: number; y: number };
}
export interface SeqEdge {
  id: string;
  source: string;
  target: string;
  handle: string;
}
export interface SeqGraph {
  nodes: SeqNode[];
  edges: SeqEdge[];
}
export interface Sequence {
  _id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  version: number;
  triggerType: string;
  triggerConfig: Record<string, any>;
  graph: SeqGraph;
  settings: Record<string, any>;
  stats: { enrolled: number; active: number; completed: number; halted: number; failed: number };
  templateKey?: string | null;
  updatedAt: string;
}

export const STAGES = ["Lead", "Engaged", "Under Contract", "Closed"];
export const INTENTS = ["hot", "warm", "cold"];
export const PRIORITIES = ["high", "medium", "low"];
export const TXN_STATUSES = ["none", "active", "inspection", "appraisal", "loan", "clear_to_close", "closed"];
export const TXN_DATE_FIELDS = [
  "transaction.contractDate",
  "transaction.inspectionDate",
  "transaction.appraisalDate",
  "transaction.loanContingencyDate",
  "transaction.closingDate",
];

export const FAMILY_COLOR: Record<Family, string> = {
  trigger: "#8b5cf6", // purple
  action: "#14b8a6", // teal
  control: "#f59e0b", // gold
  exit: "#64748b", // slate
};

export const FAMILY_LABEL: Record<Family, string> = {
  trigger: "Trigger",
  action: "Action",
  control: "Control",
  exit: "Exit",
};

type Field =
  | { key: string; label: string; kind: "text" | "textarea" | "number"; placeholder?: string; merge?: boolean }
  | { key: string; label: string; kind: "select"; options: string[] }
  | { key: string; label: string; kind: "duration" }
  | { key: string; label: string; kind: "checklist"; options: string[] };

export interface BlockMeta {
  type: string;
  family: Family;
  label: string;
  description: string;
  fields: Field[];
  special?: "condition" | "update_client" | "enroll_in_sequence" | "wait_until";
  defaultConfig: () => Record<string, any>;
}

export const BLOCK_META: Record<string, BlockMeta> = {
  // ── Triggers ──
  client_created: {
    type: "client_created", family: "trigger", label: "New client created",
    description: "Enroll when a new client is created (optional stage/intent filter).",
    fields: [], defaultConfig: () => ({}),
  },
  stage_changed: {
    type: "stage_changed", family: "trigger", label: "Deal stage changed",
    description: "Enroll when a client's stage transitions to a target value.",
    fields: [
      { key: "toStage", label: "To stage", kind: "select", options: STAGES },
    ],
    defaultConfig: () => ({ toStage: "Under Contract" }),
  },
  manual_enroll: {
    type: "manual_enroll", family: "trigger", label: "Manual enroll",
    description: "Broker enrolls a client by hand.",
    fields: [], defaultConfig: () => ({}),
  },
  schedule: {
    type: "schedule", family: "trigger", label: "Recurring schedule",
    description: "Run on a daily/weekly clock (broker-scoped — powers the digest).",
    fields: [
      { key: "frequency", label: "Frequency", kind: "select", options: ["daily", "weekly"] },
      { key: "time", label: "Time (HH:MM)", kind: "text", placeholder: "08:00" },
    ],
    defaultConfig: () => ({ frequency: "daily", time: "08:00", tz: "UTC" }),
  },

  // ── Actions ──
  send_email: {
    type: "send_email", family: "action", label: "Send email",
    description: "Send a Gmail email. Subject/body support merge fields.",
    fields: [
      { key: "subject", label: "Subject", kind: "text", merge: true },
      { key: "body", label: "Body", kind: "textarea", merge: true },
    ],
    defaultConfig: () => ({ subject: "", body: "" }),
  },
  send_whatsapp: {
    type: "send_whatsapp", family: "action", label: "Send WhatsApp",
    description: "Send a WhatsApp message. Body supports merge fields.",
    fields: [{ key: "body", label: "Message", kind: "textarea", merge: true }],
    defaultConfig: () => ({ body: "" }),
  },
  update_client: {
    type: "update_client", family: "action", label: "Update client",
    description: "Set stage/intent/next action and/or append a note.",
    fields: [], special: "update_client",
    defaultConfig: () => ({ set: {} }),
  },
  notify_broker: {
    type: "notify_broker", family: "action", label: "Notify broker",
    description: "Push an in-app alert to the broker.",
    fields: [
      { key: "message", label: "Message", kind: "text", merge: true },
      { key: "priority", label: "Priority", kind: "select", options: PRIORITIES },
    ],
    defaultConfig: () => ({ message: "", priority: "medium" }),
  },
  compose_digest: {
    type: "compose_digest", family: "action", label: "Compose digest",
    description: "Summarize due actions / hot leads and notify the broker.",
    fields: [
      { key: "include", label: "Include", kind: "checklist", options: ["dueToday", "hotLeads", "nextActions"] },
      { key: "channel", label: "Channel", kind: "select", options: ["inapp", "whatsapp"] },
    ],
    defaultConfig: () => ({ include: ["dueToday", "hotLeads", "nextActions"], channel: "inapp" }),
  },
  request_documents: {
    type: "request_documents", family: "action", label: "Request documents",
    description: "Ask the client to upload a document. Pair with a 'Wait for document' step.",
    fields: [
      { key: "channel", label: "Channel", kind: "select", options: ["email", "whatsapp"] },
      { key: "docName", label: "Document name", kind: "text", placeholder: "e.g. Inspection report" },
      { key: "body", label: "Message", kind: "textarea", merge: true },
    ],
    defaultConfig: () => ({ channel: "email", docName: "", body: "" }),
  },

  // ── Control ──
  wait: {
    type: "wait", family: "control", label: "Wait",
    description: "Pause for a fixed duration.",
    fields: [{ key: "duration", label: "Wait", kind: "duration" }],
    defaultConfig: () => ({ value: 1, unit: "days" }),
  },
  condition: {
    type: "condition", family: "control", label: "Condition",
    description: "Branch on client data (intent / stage / budget / replied).",
    fields: [], special: "condition",
    defaultConfig: () => ({
      field: "client.intent",
      cases: [{ op: "eq", value: "hot", handle: "hot" }],
      elseHandle: "else",
    }),
  },
  wait_for_reply: {
    type: "wait_for_reply", family: "control", label: "Wait for reply",
    description: "Pause until the client replies (replied) or a timeout (timeout).",
    fields: [
      { key: "timeout", label: "Timeout", kind: "duration" },
      { key: "channel", label: "Channel", kind: "select", options: ["any", "whatsapp", "email"] },
    ],
    defaultConfig: () => ({ timeout: { value: 3, unit: "days" }, channel: "any" }),
  },
  wait_until: {
    type: "wait_until", family: "control", label: "Wait until date",
    description: "Pause until a transaction deadline, optionally N days before/after it.",
    fields: [], special: "wait_until",
    defaultConfig: () => ({ dateField: "transaction.closingDate", offset: { value: 3, unit: "days", direction: "before" } }),
  },
  wait_for_document: {
    type: "wait_for_document", family: "control", label: "Wait for document",
    description: "Pause until a file is uploaded to the client's inventory (received) or a timeout (timeout).",
    fields: [
      { key: "timeout", label: "Timeout", kind: "duration" },
      { key: "docName", label: "Document name", kind: "text", placeholder: "e.g. Inspection report" },
    ],
    defaultConfig: () => ({ timeout: { value: 5, unit: "days" }, docName: "" }),
  },
  enroll_in_sequence: {
    type: "enroll_in_sequence", family: "control", label: "Enroll in sequence",
    description: "Hand the client off to another sequence.",
    fields: [], special: "enroll_in_sequence",
    defaultConfig: () => ({ targetSequenceId: "" }),
  },

  // ── Exit ──
  end: {
    type: "end", family: "exit", label: "End",
    description: "Terminate the enrollment. Optionally record a goal/conversion.",
    fields: [],
    defaultConfig: () => ({}),
  },
};

/** Mirror of registry.handlesFor — the valid outgoing handles for a node. */
export function handlesFor(type: string, config: Record<string, any> = {}): string[] {
  if (type === "end") return [];
  if (type === "wait_for_reply") return ["replied", "timeout"];
  if (type === "wait_for_document") return ["received", "timeout"];
  if (type === "condition") {
    const hs = (config.cases || []).map((c: any) => c.handle).filter(Boolean);
    if (config.elseHandle) hs.push(config.elseHandle);
    return [...new Set(hs)] as string[];
  }
  return ["out"];
}

export const MERGE_FIELDS = [
  "{client.name}", "{client.firstName}", "{client.email}", "{client.phone}",
  "{client.company}", "{client.stage}", "{client.intent}", "{client.budget}",
  "{client.requirements}", "{client.nextAction}",
  "{transaction.status}", "{transaction.contractDate}", "{transaction.inspectionDate}",
  "{transaction.appraisalDate}", "{transaction.loanContingencyDate}", "{transaction.closingDate}",
  "{broker.name}", "{broker.company}", "{broker.phone}", "{broker.email}",
  "{date.today}",
];

let _seq = 0;
export function newNodeId(type: string): string {
  _seq += 1;
  return `${type}_${Date.now().toString(36)}_${_seq}`;
}
