import { z } from "zod";
import mongoose from "mongoose";

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectContact(c) {
  return {
    id: String(c._id),
    name: c.name,
    email: c.email,
    phone: c.phone,
    source: c.source,
    channels: c.channels,
    clientRef: c.clientRef ? String(c.clientRef) : null,
  };
}

export default function registerContactTools(registry, { TrackedContact, Client }) {

  registry.register({
    category: "contacts",
    name: "search_contacts",
    description: "Search tracked contacts (inbox roster). Filter by name/email/phone substring, or by source (client / imported).",
    creditCost: 1,
    sensitive: false,
    schema: z.object({
      search: z.string().optional(),
      source: z.enum(["all", "client", "imported"]).optional(),
      limit:  z.number().int().min(1).max(100).optional(),
    }),
    handler: async (args, userId) => {
      const filter = { userId };
      if (args.source && args.source !== "all") filter.source = args.source;
      if (args.search?.trim()) {
        const s = escapeRegex(args.search.trim());
        filter.$or = [
          { name:  { $regex: s, $options: "i" } },
          { email: { $regex: s, $options: "i" } },
          { phone: { $regex: s, $options: "i" } },
        ];
      }
      const rows = await TrackedContact.find(filter).sort({ name: 1 }).limit(args.limit || 50).lean();
      return { count: rows.length, contacts: rows.map(projectContact) };
    },
  });

  registry.register({
    category: "contacts",
    name: "sync_contacts_from_clients",
    description: "Create tracked contacts for any clients that don't already have one. Safe to run repeatedly — existing contacts are skipped.",
    creditCost: 2,
    sensitive: true,
    buildDescription: () =>
      "Auto-create tracked contacts for every client without one. Existing contacts will be skipped. Proceed?",
    schema: z.object({}),
    handler: async (_a, userId) => {
      const clients = await Client.find({ userId }).lean();
      let created = 0, skipped = 0;
      for (const c of clients) {
        try {
          const exists = await TrackedContact.findOne({ userId, email: c.email.toLowerCase() });
          if (exists) { skipped++; continue; }
          await TrackedContact.create({
            userId,
            name: c.name,
            email: c.email.toLowerCase(),
            phone: c.phone || "",
            source: "client",
            clientRef: c._id,
            channels: { gmail: !!c.email, whatsapp: !!c.phone, sms: !!c.phone },
          });
          created++;
        } catch (e) {
          if (e.code === 11000) skipped++;
          else throw e;
        }
      }
      return { success: true, total: clients.length, created, skipped };
    },
  });

  registry.register({
    category: "contacts",
    name: "create_contact",
    description: "Manually add a tracked contact (e.g. someone you want in your inbox but who isn't a client yet).",
    creditCost: 1,
    sensitive: true,
    buildDescription: (a) => `Create tracked contact **${a.name}** (${a.email})?`,
    schema: z.object({
      name:  z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
    }),
    handler: async (a, userId) => {
      const email = a.email.toLowerCase();
      const dup = await TrackedContact.findOne({ userId, email });
      if (dup) throw new Error(`A contact with email ${email} already exists.`);
      const contact = await TrackedContact.create({
        userId,
        name: a.name,
        email,
        phone: a.phone || "",
        source: "imported",
        channels: { gmail: true, whatsapp: !!a.phone, sms: !!a.phone },
      });
      return { success: true, contact: projectContact(contact.toObject()) };
    },
  });

  registry.register({
    category: "contacts",
    name: "update_contact",
    description: "Update a tracked contact's name / email / phone.",
    creditCost: 1,
    sensitive: true,
    buildDescription: async (a, ctx) => {
      const changes = Object.entries(a)
        .filter(([k, v]) => k !== "contactId" && v !== undefined)
        .map(([k, v]) => `**${k}** → ${v}`)
        .join(", ");
      const c = await TrackedContact.findOne({ _id: a.contactId, userId: ctx?.userId }).select("name").lean().catch(() => null);
      const label = c ? `**${c.name}**` : `contact \`${a.contactId}\``;
      return `Update ${label}: ${changes || "no changes"}?`;
    },
    schema: z.object({
      contactId: z.string(),
      name:  z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    }),
    handler: async (a, userId) => {
      if (!mongoose.isValidObjectId(a.contactId)) throw new Error("Invalid contactId");
      const contact = await TrackedContact.findOne({ _id: a.contactId, userId });
      if (!contact) throw new Error("Contact not found.");

      if (a.email && a.email.toLowerCase() !== contact.email) {
        const dup = await TrackedContact.findOne({
          userId,
          email: a.email.toLowerCase(),
          _id: { $ne: contact._id },
        });
        if (dup) throw new Error("Another contact with that email already exists.");
        contact.email = a.email.toLowerCase();
      }
      if (a.name  !== undefined) contact.name  = a.name;
      if (a.phone !== undefined) contact.phone = a.phone;
      await contact.save();
      return { success: true, contact: projectContact(contact.toObject()) };
    },
  });

  registry.register({
    category: "contacts",
    name: "delete_contact",
    description: "Permanently delete a tracked contact. Does NOT delete the underlying client (if any).",
    creditCost: 2,
    sensitive: true,
    buildDescription: async (a, ctx) => {
      const c = await TrackedContact.findOne({ _id: a.contactId, userId: ctx?.userId }).select("name email").lean().catch(() => null);
      const label = c ? `**${c.name}**${c.email ? ` (${c.email})` : ""}` : `contact \`${a.contactId}\``;
      return `Delete tracked contact ${label} — proceed?`;
    },
    schema: z.object({ contactId: z.string() }),
    handler: async ({ contactId }, userId) => {
      if (!mongoose.isValidObjectId(contactId)) throw new Error("Invalid contactId");
      const removed = await TrackedContact.findOneAndDelete({ _id: contactId, userId });
      if (!removed) throw new Error("Contact not found.");
      return { success: true, deleted: { name: removed.name, email: removed.email } };
    },
  });
}
