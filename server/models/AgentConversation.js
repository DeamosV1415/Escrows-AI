import mongoose from "mongoose";

/**
 * Stores the running chat thread for a single user.
 *
 * `messages[]` is the wire format we send to the frontend and pass back
 * into the LangGraph agent (after rehydration into LangChain messages):
 *   {
 *     role: "user" | "assistant" | "tool",
 *     content: string,
 *     toolCalls?: [{ id, name, args }],
 *     toolCallId?: string,   // present for role="tool"
 *     toolName?: string,
 *     timestamp: Date
 *   }
 *
 * `pendingConfirmation` is the sensitive-tool gate set by the agent's
 * confirm_gate node. It is non-null while a request is awaiting a yes/no
 * from the user.
 */
const messageSubSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "tool"], required: true },
    content: { type: String, default: "" },
    toolCalls: { type: mongoose.Schema.Types.Mixed, default: null },
    toolCallId: { type: String, default: null },
    toolName: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const agentConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    messages: { type: [messageSubSchema], default: [] },
    pendingConfirmation: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export default agentConversationSchema;
