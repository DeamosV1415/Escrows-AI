// Shared test helpers.

export const node = (id, type, family, config = {}) => ({ id, type, family, config, position: { x: 0, y: 0 } });
export const edge = (source, target, handle = "out") => ({ id: `${source}:${handle}:${target}`, source, target, handle });

/** A minimal valid graph: trigger -> send_whatsapp -> end. */
export function simpleSendGraph(body = "Hi {client.name}") {
  return {
    nodes: [
      node("t", "client_created", "trigger"),
      node("s", "send_whatsapp", "action", { body }),
      node("e", "end", "exit", { goal: true }),
    ],
    edges: [edge("t", "s"), edge("s", "e")],
  };
}

/** A mock sender pair that records calls and writes outbound Message rows like the real one. */
export function mockSenders(models) {
  const calls = [];
  return {
    calls,
    senders: {
      async sendWhatsApp(_args, userId, p) {
        calls.push({ channel: "whatsapp", to: p.to, body: p.body });
        const ext = "wa_" + calls.length;
        const m = await models.Message.create({
          userId, channel: "whatsapp", contactIdentifier: p.to, contactName: p.contactName || p.to,
          externalId: ext, threadId: p.to, direction: "outbound", body: p.body, status: "delivered", timestamp: new Date(),
        });
        return { success: true, channel: "whatsapp", to: p.to, externalId: ext, messageId: String(m._id) };
      },
      async sendEmail(_args, userId, p) {
        calls.push({ channel: "gmail", to: p.to, body: p.body });
        const ext = "gm_" + calls.length;
        const m = await models.Message.create({
          userId, channel: "gmail", contactIdentifier: p.to, contactName: p.contactName || p.to,
          externalId: ext, direction: "outbound", body: p.body, subject: p.subject, status: "delivered", timestamp: new Date(),
        });
        return { success: true, channel: "gmail", to: p.to, subject: p.subject, externalId: ext, messageId: String(m._id) };
      },
    },
  };
}

/** A sender that always throws, to exercise retry/backoff. */
export function failingSenders() {
  let attempts = 0;
  return {
    get attempts() { return attempts; },
    senders: {
      async sendWhatsApp() { attempts++; throw new Error("provider down"); },
      async sendEmail() { attempts++; throw new Error("provider down"); },
    },
  };
}
