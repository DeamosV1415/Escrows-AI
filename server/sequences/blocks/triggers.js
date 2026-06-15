import { z } from "zod";

const STAGE = z.enum(["Lead", "Engaged", "Under Contract", "Closed"]);
const INTENT = z.enum(["hot", "warm", "cold"]);

/**
 * Trigger blocks are ENTRY markers. The engine sets an enrollment's currentNodeId to the
 * trigger's "out" target at enroll time, so these executors are not normally invoked during
 * flow — but they advance harmlessly if ever reached.
 */
export default function registerTriggers(registry) {
  registry.register({
    type: "client_created",
    family: "trigger",
    label: "New client created",
    description: "Enrolls when a new client is created (optionally filtered by stage/intent).",
    configSchema: z.object({
      filter: z.object({ stageIs: STAGE.optional(), intentIs: INTENT.optional() }).optional(),
    }),
    handles: ["out"],
    execute: async () => ({ kind: "next", handle: "out" }),
  });

  registry.register({
    type: "stage_changed",
    family: "trigger",
    label: "Deal stage changed",
    description: "Enrolls when a client's stage transitions to the target stage.",
    configSchema: z.object({ toStage: STAGE, fromStage: STAGE.optional() }),
    handles: ["out"],
    execute: async () => ({ kind: "next", handle: "out" }),
  });

  registry.register({
    type: "manual_enroll",
    family: "trigger",
    label: "Manual enroll",
    description: "Broker enrolls a client by hand; also the landing point for enroll_in_sequence handoffs.",
    configSchema: z.object({}),
    handles: ["out"],
    execute: async () => ({ kind: "next", handle: "out" }),
  });

  registry.register({
    type: "schedule",
    family: "trigger",
    label: "Recurring schedule",
    description: "Broker-scoped recurring run (daily/weekly at a time) — powers the digest.",
    configSchema: z.object({
      frequency: z.enum(["daily", "weekly"]),
      time: z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:MM"),
      weekday: z.number().int().min(0).max(6).optional(),
      tz: z.string().optional(),
    }),
    handles: ["out"],
    execute: async () => ({ kind: "next", handle: "out" }),
  });
}
