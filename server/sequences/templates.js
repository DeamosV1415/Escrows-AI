/**
 * The four Tier-1 templates, expressed as the SAME graph artifact every sequence uses.
 * Templates are pure data: the router instantiates one by copying its graph onto a new
 * Sequence (denormalizing triggerType/triggerConfig from the trigger node) and running it
 * through the shared validator before save. Every graph here is built to pass that validator
 * (exactly one trigger, all handles wired, every path reaches an end, loops contain a wait).
 *
 * Note: the seed templates are intentionally self-contained — they do NOT use
 * `enroll_in_sequence` (which needs a concrete target sequence id that only exists per-user).
 * Brokers can wire cross-sequence handoffs manually in the builder.
 */

// Small builders to keep the graphs readable and auto-position nodes on a grid.
function mk() {
  const nodes = [];
  const edges = [];
  let row = 0;
  const node = (id, type, family, config = {}, pos) => {
    nodes.push({
      id,
      type,
      family,
      config,
      position: pos || { x: 240 * (nodes.length % 4), y: 140 * row++ },
    });
    return id;
  };
  const edge = (source, target, handle = "out") =>
    edges.push({ id: `${source}__${handle}__${target}`, source, target, handle });
  return { nodes, edges, node, edge, graph: () => ({ nodes, edges }) };
}

/* ───────────────────────── T1 · New Lead Follow-Up ───────────────────────── */
function newLeadFollowUp() {
  const g = mk();
  g.node("t", "client_created", "trigger", {});
  g.node("notify1", "notify_broker", "action", {
    message: "New lead {client.name} — call them today.",
    priority: "high",
  });
  g.node("wa1", "send_whatsapp", "action", {
    body: "Hi {client.firstName}, this is {broker.name}. Thanks for reaching out — happy to help you find the right place. When's a good time to chat?",
  });
  g.node("w1", "wait", "control", { value: 1, unit: "days" });
  g.node("wfr1", "wait_for_reply", "control", { timeout: { value: 2, unit: "days" }, channel: "any" });
  g.node("upd1", "update_client", "action", { set: { intent: "warm" } });
  g.node("notify2", "notify_broker", "action", { message: "{client.name} replied — follow up personally.", priority: "high" });
  g.node("endReplied", "end", "exit", { goal: true, goalName: "lead_replied" });
  g.node("em1", "send_email", "action", {
    subject: "Still here to help, {client.firstName}",
    body: "Hi {client.firstName},\n\nJust circling back in case my message got buried. I'd love to learn what you're looking for. Reply any time.\n\nBest,\n{broker.name}",
  });
  g.node("w2", "wait", "control", { value: 3, unit: "days" });
  g.node("wfr2", "wait_for_reply", "control", { timeout: { value: 3, unit: "days" }, channel: "any" });
  g.node("endReplied2", "end", "exit", { goal: true, goalName: "lead_replied" });
  g.node("upd2", "update_client", "action", { set: { intent: "cold", nextAction: "Add to long-term nurture" } });
  g.node("notify3", "notify_broker", "action", { message: "{client.name} went cold after 3 touches — add to nurture.", priority: "medium" });
  g.node("endCold", "end", "exit", {});

  g.edge("t", "notify1");
  g.edge("notify1", "wa1");
  g.edge("wa1", "w1");
  g.edge("w1", "wfr1");
  g.edge("wfr1", "upd1", "replied");
  g.edge("wfr1", "em1", "timeout");
  g.edge("upd1", "notify2");
  g.edge("notify2", "endReplied");
  g.edge("em1", "w2");
  g.edge("w2", "wfr2");
  g.edge("wfr2", "endReplied2", "replied");
  g.edge("wfr2", "upd2", "timeout");
  g.edge("upd2", "notify3");
  g.edge("notify3", "endCold");
  return g.graph();
}

/* ───────────────── T2 · Lead Nurturing / Drip (temperature-segmented) ───────────────── */
function leadNurturing() {
  const g = mk();
  g.node("t", "manual_enroll", "trigger", {});
  g.node("seg", "condition", "control", {
    field: "client.intent",
    cases: [
      { op: "eq", value: "hot", handle: "hot" },
      { op: "eq", value: "warm", handle: "warm" },
    ],
    elseHandle: "cold",
  });
  g.edge("t", "seg");

  // Each branch: send → wait → re-check stage → loop while still "Lead", else exit on goal.
  const branch = (prefix, channelType, body, waitDays, fromHandle) => {
    const send = `${prefix}Send`;
    const wait = `${prefix}Wait`;
    const check = `${prefix}Check`;
    const end = `${prefix}End`;
    const cfg = channelType === "send_whatsapp" ? { body } : { subject: "A quick update from {broker.name}", body };
    g.node(send, channelType, "action", cfg);
    g.node(wait, "wait", "control", { value: waitDays, unit: "days" });
    g.node(check, "condition", "control", {
      field: "client.stage",
      cases: [{ op: "eq", value: "Lead", handle: "again" }],
      elseHandle: "advanced",
    });
    g.node(end, "end", "exit", { goal: true, goalName: "stage_advanced" });
    g.edge("seg", send, fromHandle);
    g.edge(send, wait);
    g.edge(wait, check);
    g.edge(check, send, "again"); // loop (contains the wait above)
    g.edge(check, end, "advanced");
  };

  branch("hot", "send_whatsapp", "Hi {client.firstName}! A few new listings just hit the market that match what you're after. Want me to send them over?", 2, "hot");
  branch("warm", "send_email", "Hi {client.firstName},\n\nThought you might find this market update useful. Let me know if anything catches your eye.\n\n{broker.name}", 3, "warm");
  branch("cold", "send_email", "Hi {client.firstName},\n\nHere's the latest in your area — no pressure, just keeping you in the loop.\n\n{broker.name}", 7, "cold");
  return g.graph();
}

/* ───────────────────────── T3 · Post-Showing Follow-Up ───────────────────────── */
function postShowing() {
  const g = mk();
  g.node("t", "manual_enroll", "trigger", {});
  g.node("seg", "condition", "control", {
    field: "client.intent",
    cases: [
      { op: "eq", value: "hot", handle: "hot" },
      { op: "eq", value: "warm", handle: "warm" },
    ],
    elseHandle: "cold",
  });
  g.edge("t", "seg");

  // hot
  g.node("hWa", "send_whatsapp", "action", { body: "Hi {client.firstName}! What did you think of the place? Happy to talk next steps whenever you're ready." });
  g.node("hNotify", "notify_broker", "action", { message: "Hot buyer {client.name} just toured — call in the AM.", priority: "high" });
  g.node("hUpd", "update_client", "action", { set: { nextAction: "Offer prep" } });
  g.node("hEnd", "end", "exit", { goal: true, goalName: "showing_followup" });
  g.edge("seg", "hWa", "hot");
  g.edge("hWa", "hNotify");
  g.edge("hNotify", "hUpd");
  g.edge("hUpd", "hEnd");

  // warm
  g.node("wEm1", "send_email", "action", { subject: "Thanks for touring with me, {client.firstName}", body: "Hi {client.firstName},\n\nGreat seeing you today! I'll send a few similar options over the next days. Reply with any thoughts.\n\n{broker.name}" });
  g.node("wWait", "wait", "control", { value: 3, unit: "days" });
  g.node("wEm2", "send_email", "action", { subject: "A few more you might like", body: "Hi {client.firstName}, here are a couple more places worth a look. Want to schedule a second showing?\n\n{broker.name}" });
  g.node("wEnd", "end", "exit", { goal: true, goalName: "showing_followup" });
  g.edge("seg", "wEm1", "warm");
  g.edge("wEm1", "wWait");
  g.edge("wWait", "wEm2");
  g.edge("wEm2", "wEnd");

  // cold
  g.node("cWa1", "send_whatsapp", "action", { body: "Hi {client.firstName}, thanks for coming by. I'll check in now and then — just say the word if anything changes." });
  g.node("cWait", "wait", "control", { value: 7, unit: "days" });
  g.node("cWa2", "send_whatsapp", "action", { body: "Hi {client.firstName}, a quick market update for your area. Still keeping an eye out for you!" });
  g.node("cEnd", "end", "exit", {});
  g.edge("seg", "cWa1", "cold");
  g.edge("cWa1", "cWait");
  g.edge("cWait", "cWa2");
  g.edge("cWa2", "cEnd");
  return g.graph();
}

/* ───────────────── T5 · Contract-to-Close (Tier-2 escrow orchestration) ───────────────── */
function contractToClose() {
  const g = mk();
  g.node("t", "stage_changed", "trigger", { toStage: "Under Contract" });
  g.node("openAlert", "notify_broker", "action", {
    message: "Escrow opened for {client.name} — kick off the file and set the deadline dates.",
    priority: "high",
  });
  g.node("kickoff", "send_email", "action", {
    subject: "We're under contract, {client.firstName}! 🎉",
    body: "Hi {client.firstName},\n\nCongratulations — we're officially under contract! Over the next few weeks I'll guide you through inspection, appraisal, financing, and closing. I'll keep you posted at every step.\n\nTarget closing date: {transaction.closingDate}\n\nReach out any time,\n{broker.name}",
  });
  g.node("setInspection", "update_client", "action", { set: { transactionStatus: "inspection" } });
  g.node("reqDocs", "request_documents", "action", {
    channel: "email",
    docName: "Inspection report",
    body: "Hi {client.firstName}, once the inspection is complete please upload the report here so I can review it with you. Thanks!\n\n{broker.name}",
  });
  g.node("waitDocs", "wait_for_document", "control", { timeout: { value: 5, unit: "days" }, docName: "Inspection report" });
  g.node("gotDocs", "notify_broker", "action", { message: "Inspection report received for {client.name} — review it.", priority: "medium" });
  g.node("chaseDocs", "notify_broker", "action", { message: "No inspection report yet for {client.name} — follow up.", priority: "high" });

  g.node("waitInspection", "wait_until", "control", { dateField: "transaction.inspectionDate", offset: { value: 2, unit: "days", direction: "before" } });
  g.node("remindInspection", "send_whatsapp", "action", { body: "Hi {client.firstName}, a quick reminder that your inspection window is coming up. Let me know if you have any questions!" });

  g.node("setLoan", "update_client", "action", { set: { transactionStatus: "loan" } });
  g.node("waitClosing", "wait_until", "control", { dateField: "transaction.closingDate", offset: { value: 3, unit: "days", direction: "before" } });
  g.node("remindClosing", "send_email", "action", {
    subject: "Closing is almost here, {client.firstName}",
    body: "Hi {client.firstName},\n\nWe're just days from closing ({transaction.closingDate}). I'll send final walkthrough and signing details shortly. Let me know if anything's unclear.\n\n{broker.name}",
  });
  g.node("waitCloseDay", "wait_until", "control", { dateField: "transaction.closingDate" });
  g.node("setClosed", "update_client", "action", { set: { stage: "Closed", transactionStatus: "closed" } });
  g.node("congrats", "send_email", "action", {
    subject: "Congratulations on your new home, {client.firstName}! 🏡",
    body: "Hi {client.firstName},\n\nIt's official — congratulations! It was a pleasure guiding you through this. I'm always here if you need anything down the road, and referrals are the greatest compliment.\n\nWarmly,\n{broker.name}",
  });
  g.node("end", "end", "exit", { goal: true, goalName: "deal_closed" });

  g.edge("t", "openAlert");
  g.edge("openAlert", "kickoff");
  g.edge("kickoff", "setInspection");
  g.edge("setInspection", "reqDocs");
  g.edge("reqDocs", "waitDocs");
  g.edge("waitDocs", "gotDocs", "received");
  g.edge("waitDocs", "chaseDocs", "timeout");
  g.edge("gotDocs", "waitInspection");
  g.edge("chaseDocs", "waitInspection"); // both branches converge
  g.edge("waitInspection", "remindInspection");
  g.edge("remindInspection", "setLoan");
  g.edge("setLoan", "waitClosing");
  g.edge("waitClosing", "remindClosing");
  g.edge("remindClosing", "waitCloseDay");
  g.edge("waitCloseDay", "setClosed");
  g.edge("setClosed", "congrats");
  g.edge("congrats", "end");
  return g.graph();
}

/* ───────────────────────── T4 · Broker Daily Digest ───────────────────────── */
function dailyDigest() {
  const g = mk();
  g.node("t", "schedule", "trigger", { frequency: "daily", time: "08:00", tz: "UTC" });
  g.node("digest", "compose_digest", "action", { include: ["dueToday", "hotLeads", "nextActions"], channel: "inapp" });
  g.node("end", "end", "exit", {});
  g.edge("t", "digest");
  g.edge("digest", "end");
  return g.graph();
}

export const TEMPLATES = [
  {
    key: "new-lead-follow-up",
    name: "New Lead Follow-Up",
    description: "Fast first touch on a brand-new lead, then a timed multi-touch follow-up that branches on whether they reply.",
    graph: newLeadFollowUp(),
  },
  {
    key: "lead-nurturing",
    name: "Lead Nurturing (Drip)",
    description: "Temperature-segmented drip: hot leads get WhatsApp + a broker nudge, warm/cold get paced email value until their stage advances.",
    graph: leadNurturing(),
  },
  {
    key: "post-showing",
    name: "Post-Showing Follow-Up",
    description: "After a showing, follow up based on buyer temperature — feedback ask for hot, recommendations for warm, light check-ins for cold.",
    graph: postShowing(),
  },
  {
    key: "contract-to-close",
    name: "Contract-to-Close",
    description: "From signing to keys: opens escrow on 'Under Contract', collects the inspection doc, fires deadline reminders before each milestone, and congratulates the client at closing. Runs through Closed and keeps going if the client replies.",
    // Critical: this sequence must NOT halt when the deal closes or the client replies —
    // escrow is exactly when both happen. Per-sequence overrides of the engine defaults.
    settings: { stopOnClosed: false, stopOnReply: false },
    graph: contractToClose(),
  },
  {
    key: "daily-digest",
    name: "Broker Daily Digest",
    description: "Every morning, summarize your due actions and hot leads into one in-app digest. Broker-scoped — never messages a client.",
    settings: { timezone: "UTC" },
    graph: dailyDigest(),
  },
];

export function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null;
}

// Derive denormalized trigger fields from a graph's trigger node.
export function triggerOf(graph) {
  const trigger = (graph.nodes || []).find((n) => n.family === "trigger");
  return {
    triggerType: trigger?.type || "manual_enroll",
    triggerConfig: trigger?.config || {},
  };
}
