import { Annotation } from "@langchain/langgraph";

function appendMessages(existing, incoming) {
  if (incoming == null) return existing;
  if (Array.isArray(incoming)) return [...existing, ...incoming];
  return [...existing, incoming];
}

function mergeApprovedIds(existing, incoming) {
  if (!incoming) return existing;
  const set = new Set(existing);
  if (Array.isArray(incoming)) incoming.forEach((id) => set.add(id));
  else set.add(incoming);
  return Array.from(set);
}

const AgentState = Annotation.Root({
  messages: Annotation({ reducer: appendMessages, default: () => [] }),

  userId:    Annotation({ reducer: (_, v) => v, default: () => "" }),
  userTier:  Annotation({ reducer: (_, v) => v, default: () => "free" }),
  unlimited: Annotation({ reducer: (_, v) => v, default: () => false }),
  creditsRemaining: Annotation({ reducer: (_, v) => v, default: () => 0 }),

  approvedToolCallIds: Annotation({ reducer: mergeApprovedIds, default: () => [] }),
  pendingConfirmation: Annotation({ reducer: (_, v) => v, default: () => null }),
  insufficientCredits: Annotation({ reducer: (_, v) => v, default: () => null }),
});

export default AgentState;
