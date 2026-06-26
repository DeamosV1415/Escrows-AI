import { z } from "zod";
import { durationToMs, WAIT_FOR_REPLY_DEFAULT_TIMEOUT } from "../constants.js";

const DURATION = z.object({
  value: z.number().int().min(1),
  unit: z.enum(["minutes", "hours", "days"]),
});

function readField(field, ctx) {
  switch (field) {
    case "client.intent": return ctx.client?.intent ?? null;
    case "client.stage": return ctx.client?.stage ?? null;
    case "client.budget": return ctx.client?.budget ?? null;
    case "replied": return ctx._repliedSinceEnroll === true; // precomputed by engine
    default: return null;
  }
}

function cmp(val, op, target) {
  switch (op) {
    case "eq": return val === target;
    case "ne": return val !== target;
    case "gt": return Number(val) > Number(target);
    case "lt": return Number(val) < Number(target);
    case "in": return Array.isArray(target) && target.includes(val);
    default: return false;
  }
}

export default function registerControl(registry) {
  registry.register({
    type: "wait",
    family: "control",
    label: "Wait",
    description: "Pause for a fixed duration before the next step.",
    configSchema: DURATION,
    handles: ["out"],
    execute: async (ctx) => ({ kind: "delay", ms: durationToMs(ctx.node.config), handle: "out" }),
  });

  registry.register({
    type: "condition",
    family: "control",
    label: "Condition",
    description:
      "Branch on client data (client.intent/stage/budget or whether the client has replied).",
    configSchema: z
      .object({
        field: z.enum(["client.intent", "client.stage", "client.budget", "replied"]),
        cases: z
          .array(
            z.object({
              op: z.enum(["eq", "ne", "gt", "lt", "in"]),
              value: z.any(),
              handle: z.string().min(1),
            }),
          )
          .min(1),
        elseHandle: z.string().min(1),
      }),
    // dynamic: a condition's valid handles are its case handles + the else handle
    handles: (config) => {
      const hs = (config.cases || []).map((c) => c.handle);
      if (config.elseHandle) hs.push(config.elseHandle);
      return [...new Set(hs)];
    },
    execute: async (ctx) => {
      const { field, cases, elseHandle } = ctx.node.config;
      const val = readField(field, ctx);
      for (const c of cases) {
        if (cmp(val, c.op, c.value)) {
          return { kind: "next", handle: c.handle, detail: `${field} ${c.op} ${JSON.stringify(c.value)}` };
        }
      }
      return { kind: "next", handle: elseHandle, detail: `${field} → else` };
    },
  });

  registry.register({
    type: "wait_for_reply",
    family: "control",
    label: "Wait for reply",
    description: "Pause until the client replies (branch: replied) or a timeout elapses (branch: timeout).",
    configSchema: z.object({
      timeout: DURATION.optional(),
      channel: z.enum(["any", "whatsapp", "email"]).optional(),
    }),
    handles: ["replied", "timeout"],
    execute: async (ctx) => {
      const timeoutMs = durationToMs(ctx.node.config.timeout || WAIT_FOR_REPLY_DEFAULT_TIMEOUT);
      const wc = ctx.enrollment.waitContext;
      const armed = wc && wc.nodeId === ctx.node.id && wc.startedAt;
      if (!armed) {
        return { kind: "await", timeoutMs }; // engine arms waitContext + nextRunAt
      }
      if (ctx._repliedSinceWait === true) {
        return { kind: "next", handle: "replied" };
      }
      const deadline = new Date(wc.startedAt).getTime() + timeoutMs;
      if (ctx.now.getTime() >= deadline) {
        return { kind: "next", handle: "timeout" };
      }
      return { kind: "await", timeoutMs }; // not due yet; engine keeps existing startedAt
    },
  });

  registry.register({
    type: "enroll_in_sequence",
    family: "control",
    label: "Enroll in sequence",
    description: "Hand the client off to another sequence (e.g. New Lead → Nurturing).",
    configSchema: z.object({ targetSequenceId: z.string().min(1) }),
    handles: ["out"],
    execute: async (ctx) => ({
      kind: "enroll",
      targetSequenceId: ctx.node.config.targetSequenceId,
      handle: "out",
    }),
  });

  // ─── Tier-2: pause until a deal deadline (optionally offset before/after) ───
  registry.register({
    type: "wait_until",
    family: "control",
    label: "Wait until date",
    description:
      "Pause until a transaction deadline (optionally N days before/after it). If the date is unset or already passed, advances immediately so a flow never stalls.",
    configSchema: z.object({
      dateField: z.enum([
        "transaction.contractDate",
        "transaction.inspectionDate",
        "transaction.appraisalDate",
        "transaction.loanContingencyDate",
        "transaction.closingDate",
      ]),
      offset: z
        .object({
          value: z.number().int().min(0),
          unit: z.enum(["minutes", "hours", "days"]),
          direction: z.enum(["before", "after"]),
        })
        .optional(),
    }),
    handles: ["out"],
    execute: async (ctx) => {
      const cfg = ctx.node.config;
      const key = cfg.dateField.split(".")[1]; // e.g. "closingDate"
      const raw = ctx.client?.transaction?.[key];
      if (!raw) return { kind: "next", handle: "out", skipped: "no_date" }; // missing → don't stall
      let target = new Date(raw).getTime();
      if (Number.isNaN(target)) return { kind: "next", handle: "out", skipped: "bad_date" };
      if (cfg.offset && cfg.offset.value) {
        const ms = durationToMs(cfg.offset);
        target += cfg.offset.direction === "before" ? -ms : ms;
      }
      const delta = target - ctx.now.getTime();
      if (delta <= 0) return { kind: "next", handle: "out", detail: "date already passed" };
      return { kind: "delay", ms: delta, handle: "out" };
    },
  });

  // ─── Tier-2: pause until the client uploads a document (or a timeout) ───
  registry.register({
    type: "wait_for_document",
    family: "control",
    label: "Wait for document",
    description: "Pause until a file is uploaded to the client's inventory (received) or a timeout elapses (timeout).",
    configSchema: z.object({
      timeout: DURATION.optional(),
      docName: z.string().optional(),
    }),
    handles: ["received", "timeout"],
    execute: async (ctx) => {
      const timeoutMs = durationToMs(ctx.node.config.timeout || { value: 5, unit: "days" });
      const wc = ctx.enrollment.waitContext;
      const armed = wc && wc.nodeId === ctx.node.id && wc.startedAt;
      if (!armed) return { kind: "await", timeoutMs };
      if (ctx._documentSinceWait === true) return { kind: "next", handle: "received" };
      const deadline = new Date(wc.startedAt).getTime() + timeoutMs;
      if (ctx.now.getTime() >= deadline) return { kind: "next", handle: "timeout" };
      return { kind: "await", timeoutMs };
    },
  });
}
