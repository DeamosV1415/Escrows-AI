import express from "express";

// Escape special regex characters to prevent ReDoS (mirrors clients.js).
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Universal search across the broker's whole workspace.
 *
 * One endpoint fans out to every searchable collection in parallel and returns a
 * normalized, grouped payload the header command-palette renders directly. Every
 * query is scoped to req.userId, and the raw query is regex-escaped before use.
 *
 *   GET /api/search?q=chinmay&limit=5
 *   → { query, clients[], inventory[], inbox[], sequences[] }
 *
 * Each result carries enough to deep-link from the frontend:
 *   clients:    { id, title, subtitle, intent, stage }
 *   inventory:  { id, title, subtitle, kind: "folder"|"file", folderId, clientId }
 *   inbox:      { contactIdentifier, title, snippet, channel, when }
 *   sequences:  { id, title, subtitle, status }
 */
export default function createSearchRouter({ Client, InventoryItem, Message, TrackedContact, Sequence }) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const raw = (req.query.q || "").toString().trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 10);

    // Nothing to search — return empty groups so the client can render its empty state.
    if (!raw) {
      return res.json({ query: "", clients: [], inventory: [], inbox: [], sequences: [] });
    }

    const s = escapeRegex(raw);
    const rx = { $regex: s, $options: "i" };
    const userId = req.userId;

    try {
      const [clientDocs, inventoryDocs, contactDocs, sequenceDocs] = await Promise.all([
        Client.find({ userId, $or: [{ name: rx }, { email: rx }, { company: rx }] })
          .sort({ updatedAt: -1 })
          .limit(limit)
          .lean(),

        InventoryItem.find({ userId, name: rx })
          .sort({ type: 1, updatedAt: -1 }) // folders before files
          .limit(limit)
          .lean(),

        TrackedContact.find({ userId, $or: [{ name: rx }, { email: rx }, { phone: rx }] })
          .limit(limit)
          .lean(),

        Sequence.find({ userId, status: { $ne: "archived" }, $or: [{ name: rx }, { description: rx }] })
          .sort({ updatedAt: -1 })
          .limit(limit)
          .lean(),
      ]);

      // ─── Enrich inventory with the owning client's name ("in Chinmay Rao") ───
      const clientIds = [...new Set(inventoryDocs.map((i) => String(i.clientId)).filter(Boolean))];
      const ownerNames = {};
      if (clientIds.length) {
        const owners = await Client.find({ _id: { $in: clientIds }, userId }, { name: 1 }).lean();
        for (const o of owners) ownerNames[String(o._id)] = o.name;
      }

      const inventory = inventoryDocs.map((i) => {
        const owner = ownerNames[String(i.clientId)];
        return {
          id: String(i._id),
          title: i.name,
          kind: i.type, // "folder" | "file"
          // Folders are opened directly; files open their parent folder.
          folderId: i.type === "folder" ? String(i._id) : i.parentId ? String(i.parentId) : null,
          clientId: i.clientId ? String(i.clientId) : null,
          subtitle: i.type === "folder" ? "Folder" : owner ? `File · in ${owner}` : "File",
        };
      });

      // ─── Inbox: a matched contact + its latest message for snippet/channel ───
      const inbox = await Promise.all(
        contactDocs.map(async (c) => {
          const last = await Message.findOne({
            userId,
            contactIdentifier: { $in: [c.email, c.phone].filter(Boolean) },
          })
            .sort({ timestamp: -1 })
            .lean();
          return {
            contactIdentifier: c.email || c.phone || String(c._id),
            title: c.name,
            snippet: last ? (last.subject || last.body || "").slice(0, 80) : "No messages yet",
            channel: last ? last.channel : c.channels?.gmail ? "gmail" : c.channels?.whatsapp ? "whatsapp" : "sms",
            when: last ? last.timestamp : null,
          };
        }),
      );

      res.json({
        query: raw,
        clients: clientDocs.map((c) => ({
          id: String(c._id),
          title: c.name,
          subtitle: [c.company, c.email].filter(Boolean).join(" · ") || "—",
          intent: c.intent,
          stage: c.stage,
        })),
        inventory,
        inbox,
        sequences: sequenceDocs.map((seq) => ({
          id: String(seq._id),
          title: seq.name,
          subtitle: seq.description ? seq.description.slice(0, 80) : "Sequence",
          status: seq.status,
        })),
      });
    } catch (err) {
      console.error("Error in universal search:", err.message);
      res.status(500).json({ error: "Search failed." });
    }
  });

  return router;
}
