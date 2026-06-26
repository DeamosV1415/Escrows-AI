import { z } from "zod";
import { resolveMerge } from "../merge.js";

const STAGE = z.enum(["Lead", "Engaged", "Under Contract", "Closed"]);
const INTENT = z.enum(["hot", "warm", "cold"]);
const PRIORITY = z.enum(["high", "medium", "low"]);

// Optional per-node quiet hours. When enabled, the engine holds the send if `now` falls
// inside [start, end) — evaluated in the CLIENT's timezone — and re-sends at the window's
// end. Times are 24-hour "HH:MM". Off by default → the node sends the moment it's reached.
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM");
const QUIET_HOURS = z
  .object({
    enabled: z.boolean().default(false),
    start: HHMM.default("21:00"),
    end: HHMM.default("08:00"),
  })
  .optional();

/**
 * Action blocks. Sends return a `{ kind:"send" }` directive (rendered, but NOT yet sent) —
 * the ENGINE performs the actual delivery so crash-safety/idempotency/dedupe live in ONE place.
 * If the contact identifier for a channel is missing, the send is skipped (recorded, not fatal)
 * so a missing phone number can't kill an email-based follow-up.
 */
export default function registerActions(registry) {
  registry.register({
    type: "send_email",
    family: "action",
    label: "Send email",
    description: "Send a Gmail email to the client. Body/subject support merge fields.",
    configSchema: z.object({
      subject: z.string().default(""),
      body: z.string().min(1),
      replyInThread: z.boolean().optional(),
      quietHours: QUIET_HOURS,
    }),
    handles: ["out"],
    mergeFields: ["subject", "body"],
    execute: async (ctx) => {
      const to = ctx.client?.email;
      if (!to) return { kind: "next", handle: "out", skipped: "missing_email" };
      return {
        kind: "send",
        channel: "gmail",
        to,
        subject: resolveMerge(ctx.node.config.subject || "", ctx),
        body: resolveMerge(ctx.node.config.body || "", ctx),
        contactName: ctx.client?.name,
        quiet: ctx.node.config.quietHours || null,
        handle: "out",
      };
    },
  });

  registry.register({
    type: "send_whatsapp",
    family: "action",
    label: "Send WhatsApp",
    description: "Send a WhatsApp message to the client. Body supports merge fields.",
    configSchema: z.object({ body: z.string().min(1), quietHours: QUIET_HOURS }),
    handles: ["out"],
    mergeFields: ["body"],
    execute: async (ctx) => {
      const to = ctx.client?.phone;
      if (!to) return { kind: "next", handle: "out", skipped: "missing_phone" };
      return {
        kind: "send",
        channel: "whatsapp",
        to,
        body: resolveMerge(ctx.node.config.body || "", ctx),
        contactName: ctx.client?.name,
        quiet: ctx.node.config.quietHours || null,
        handle: "out",
      };
    },
  });

  registry.register({
    type: "update_client",
    family: "action",
    label: "Update client",
    description: "Set stage/intent/nextAction/priority on the client and/or append a note.",
    configSchema: z
      .object({
        set: z
          .object({
            stage: STAGE.optional(),
            intent: INTENT.optional(),
            nextAction: z.string().optional(),
            nextActionPriority: PRIORITY.optional(),
            // Transaction milestone status (Tier-2). Dates are set via the client modal,
            // not the block, since they're deal-specific values not flow constants.
            transactionStatus: z
              .enum(["none", "active", "inspection", "appraisal", "loan", "clear_to_close", "closed"])
              .optional(),
          })
          .optional(),
        appendNote: z.string().optional(),
      })
      .refine((c) => c.set || c.appendNote, { message: "update_client needs `set` or `appendNote`" }),
    handles: ["out"],
    mergeFields: ["appendNote"],
    execute: async (ctx) => {
      if (ctx.dryRun || !ctx.client) {
        return { kind: "next", handle: "out", detail: "would update client" };
      }
      const cfg = ctx.node.config;
      const set = {};
      for (const k of ["stage", "intent", "nextAction", "nextActionPriority"]) {
        if (cfg.set && cfg.set[k] != null) set[k] = cfg.set[k];
      }
      if (cfg.set?.transactionStatus != null) set["transaction.status"] = cfg.set.transactionStatus;
      if (cfg.appendNote) {
        const note = resolveMerge(cfg.appendNote, ctx);
        set.notes = (ctx.client.notes ? ctx.client.notes + "\n" : "") + note;
      }
      if (Object.keys(set).length) {
        await ctx.models.Client.updateOne({ _id: ctx.client._id }, { $set: set });
      }
      return { kind: "next", handle: "out", detail: "client updated" };
    },
  });

  registry.register({
    type: "notify_broker",
    family: "action",
    label: "Notify broker",
    description: "Push an in-app alert to the broker (e.g. 'call this lead today').",
    configSchema: z.object({
      message: z.string().min(1),
      priority: PRIORITY.optional(),
    }),
    handles: ["out"],
    mergeFields: ["message"],
    execute: async (ctx) => {
      const message = resolveMerge(ctx.node.config.message || "", ctx);
      return {
        kind: "next",
        handle: "out",
        detail: `notify: ${message}`,
        notify: { message, priority: ctx.node.config.priority || "medium" },
      };
    },
  });

  registry.register({
    type: "request_documents",
    family: "action",
    label: "Request documents",
    description: "Ask the client for a document over email or WhatsApp. Pairs with a 'wait for document' step.",
    configSchema: z.object({
      channel: z.enum(["email", "whatsapp"]).default("email"),
      docName: z.string().min(1),
      body: z.string().min(1),
    }),
    handles: ["out"],
    mergeFields: ["body"],
    execute: async (ctx) => {
      const channel = ctx.node.config.channel === "whatsapp" ? "whatsapp" : "gmail";
      const to = channel === "gmail" ? ctx.client?.email : ctx.client?.phone;

      // Record a trackable, pending document request (idempotent per enrollment+node) so a
      // wait_for_document step waits on THIS request, not on any unrelated upload.
      if (!ctx.dryRun && ctx.models?.DocumentRequest && ctx.enrollment?._id) {
        await ctx.models.DocumentRequest.updateOne(
          { enrollmentId: ctx.enrollment._id, nodeId: ctx.node.id },
          {
            $setOnInsert: {
              userId: ctx.enrollment.userId,
              clientId: ctx.client?._id || null,
              sequenceId: ctx.enrollment.sequenceId,
              enrollmentId: ctx.enrollment._id,
              nodeId: ctx.node.id,
              docName: ctx.node.config.docName || "Document",
              status: "pending",
            },
          },
          { upsert: true },
        ).catch(() => {});
      }

      if (!to) return { kind: "next", handle: "out", skipped: channel === "gmail" ? "missing_email" : "missing_phone" };
      return {
        kind: "send",
        channel,
        to,
        subject: `Document request: ${ctx.node.config.docName}`,
        body: resolveMerge(ctx.node.config.body || "", ctx),
        contactName: ctx.client?.name,
        handle: "out",
      };
    },
  });

  registry.register({
    type: "compose_digest",
    family: "action",
    label: "Compose digest",
    description: "Summarize the broker's due actions / hot leads and notify them (digest only).",
    configSchema: z.object({
      include: z.array(z.enum(["dueToday", "hotLeads", "nextActions"])).min(1),
      channel: z.enum(["inapp", "whatsapp"]).default("inapp"),
    }),
    handles: ["out"],
    execute: async (ctx) => {
      const Client = ctx.models.Client;
      const userId = ctx.enrollment.userId;
      const include = ctx.node.config.include || ["hotLeads", "nextActions"];
      const parts = [];
      if (include.includes("hotLeads")) {
        const hot = await Client.countDocuments({ userId, intent: "hot", stage: { $ne: "Closed" } });
        parts.push(`${hot} hot lead(s)`);
      }
      if (include.includes("nextActions") || include.includes("dueToday")) {
        const na = await Client.countDocuments({
          userId,
          nextAction: { $nin: ["", null] },
          stage: { $ne: "Closed" },
        });
        parts.push(`${na} pending next action(s)`);
      }
      const text = `Daily digest — ${parts.join(", ") || "nothing due"}.`;
      return { kind: "next", handle: "out", detail: text, notify: { message: text, priority: "low" } };
    },
  });
}
