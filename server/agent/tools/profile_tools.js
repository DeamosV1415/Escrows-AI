import { z } from "zod";

export default function registerProfileTools(registry, { User }) {

  registry.register({
    category: "profile",
    name: "get_profile",
    description: "Get the signed-in user's profile (name, email, company, specialization, etc.).",
    creditCost: 1,
    sensitive: false,
    schema: z.object({}),
    handler: async (_a, userId) => {
      const u = await User.findById(userId).select("-password").lean();
      if (!u) throw new Error("User not found.");
      return {
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        phone: u.phone,
        company: u.company,
        jobTitle: u.jobTitle,
        licenseNumber: u.licenseNumber,
        yearsInBusiness: u.yearsInBusiness,
        location: u.location,
        specialization: u.specialization,
        teamSize: u.teamSize,
        profileComplete: u.profileComplete,
      };
    },
  });

  registry.register({
    category: "profile",
    name: "update_profile",
    description: "Update the signed-in user's profile fields (phone, company, job title, license, etc.). Cannot change name or email here.",
    creditCost: 1,
    sensitive: true,
    buildDescription: (a) => {
      const changes = Object.entries(a)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `**${k}** → ${v}`)
        .join(", ");
      return `Update your profile: ${changes || "no changes"}?`;
    },
    schema: z.object({
      phone:           z.string().optional(),
      company:         z.string().optional(),
      jobTitle:        z.string().optional(),
      licenseNumber:   z.string().optional(),
      yearsInBusiness: z.number().int().min(0).max(99).optional(),
      location:        z.string().optional(),
      specialization:  z.string().optional(),
      teamSize:        z.string().optional(),
    }),
    handler: async (a, userId) => {
      const updates = {};
      for (const [k, v] of Object.entries(a)) if (v !== undefined) updates[k] = v;
      if (Object.keys(updates).length === 0) throw new Error("No fields to update.");
      const u = await User.findByIdAndUpdate(userId, { $set: updates }, { returnDocument: "after" })
        .select("-password").lean();
      if (!u) throw new Error("User not found.");
      return { success: true, updated: updates };
    },
  });
}
