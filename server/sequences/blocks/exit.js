import { z } from "zod";

export default function registerExit(registry) {
  registry.register({
    type: "end",
    family: "exit",
    label: "End",
    description: "Terminates the enrollment. Optionally records a conversion/goal.",
    configSchema: z.object({
      goal: z.boolean().optional(),
      goalName: z.string().optional(),
    }),
    handles: [], // terminal — no outgoing edges
    execute: async (ctx) => ({
      kind: "complete",
      goal: !!ctx.node.config.goal,
      goalName: ctx.node.config.goalName || null,
    }),
  });
}
