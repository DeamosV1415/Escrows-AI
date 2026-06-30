import React, { useState, useEffect, useCallback } from "react";
import "./SettingsPage.css";
import { authFetch } from "../utils/authFetch";
import { useAuth } from "../components/AuthContext";

/* WhatsApp self-serve onboarding is gated until Meta business verification
   clears review. Backend (connect/disconnect/webhooks) stays wired up so we
   can flip this to false the moment we're approved. */
const WHATSAPP_COMING_SOON = false;

/* ─── Types ─── */
interface ProfileForm {
  name: string;
  email: string;
  company: string;
  phone: string;
  jobTitle: string;
  licenseNumber: string;
  yearsInBusiness: string;
  location: string;
  specialization: string;
  teamSize: string;
}

interface SeqSettings {
  killSwitch: boolean;
  defaultTimezone: string;
  defaultQuietHours: { start: string; end: string };
  maxPerClientPerDay: number;
  stopOnReply: boolean;
  stopOnClosed: boolean;
}

interface IntegrationStatus {
  gmail: { connected: boolean; email: string | null };
  whatsapp: { connected: boolean; phone: string | null };
}

interface BillingInfo {
  plan: string;
  planLabel: string;
  interval: "month" | "year" | null;
  status: string | null;
  price: { month: number; year: number };
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasBillingAccount: boolean;
  billingConfigured: boolean;
}

const SUPPORT_EMAIL = "support@escrowsai.com";

/* Upgrade options shown to free users in the Billing section. */
const UPGRADE_PLANS = [
  { id: "growth", name: "Growth", price: { month: 35, year: 30 }, points: ["8 active sequences", "250 AI credits/mo", "2 GB storage"], popular: true },
  { id: "pro", name: "Pro", price: { month: 70, year: 60 }, points: ["15 active sequences", "700 AI credits/mo", "10 GB storage", "Advanced deal signals"], popular: false },
];

interface CreditsInfo {
  tierLabel: string;
  credits: number | null; // null = unlimited
  creditsDisplay: string;
  monthlyAllocation: number;
  unlimited: boolean;
  totalUsed: number;
  lastRefill: string | null;
}
interface UsageEntry {
  toolName: string;
  cost: number;
  timestamp: string;
}

/* ─── Section catalog (live + stubbed) ─── */
type SectionId =
  | "profile"
  | "sequences"
  | "integrations"
  | "security"
  | "notifications"
  | "billing"
  | "credits"
  | "data"
  | "about";

// Live sections first (in a sensible order), then the not-yet-built ones grouped
// at the bottom under a "Coming soon" label so the nav reads cleanly.
const SECTIONS: { id: SectionId; label: string; live: boolean }[] = [
  { id: "profile", label: "Account & Profile", live: true },
  { id: "sequences", label: "Sequences & Automation", live: true },
  { id: "integrations", label: "Integrations", live: true },
  { id: "billing", label: "Billing & Subscription", live: true },
  { id: "credits", label: "Credits & Usage", live: true },
  { id: "about", label: "About & Support", live: true },
  { id: "security", label: "Security & Access", live: false },
  { id: "notifications", label: "Notifications", live: false },
  { id: "data", label: "Data & Privacy", live: false },
];

/* Small line icons per section — improves scannability of the nav. */
const SECTION_ICONS: Record<SectionId, React.ReactNode> = {
  profile: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0" />,
  sequences: <path d="M4 12h3l2 6 4-14 2 8h5" />,
  integrations: <path d="M6 3v6a6 6 0 0012 0V3M9 3v3M15 3v3M12 15v6" />,
  billing: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
  credits: <><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10h3.5a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3H15" /></>,
  about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  security: <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />,
  notifications: <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />,
  data: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
};

/* A curated set of common zones; we also inject the browser-detected one. */
const COMMON_TZ = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
];

/* ─── Small presentational helpers ─── */
const Field: React.FC<{ label: string; hint: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="settings-field">
    <label className="settings-field__label">{label}</label>
    {children}
    <p className="settings-field__hint">{hint}</p>
  </div>
);

const Toggle: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ label, hint, checked, onChange, disabled }) => (
  <div className="settings-field settings-field--toggle">
    <div className="settings-field__toggle-row">
      <span className="settings-field__label">{label}</span>
      <button
        type="button"
        className={`settings-toggle ${checked ? "settings-toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        aria-pressed={checked}
      >
        <span className="settings-toggle__knob" />
      </button>
    </div>
    <p className="settings-field__hint">{hint}</p>
  </div>
);

const SettingsPage: React.FC = () => {
  const { user, updateUser } = useAuth();
  // Allow deep-linking to a section via hash (e.g. /dashboard/settings#integrations),
  // used by the dashboard "Get started" checklist CTAs.
  const initialSection = (() => {
    const h = window.location.hash.replace("#", "");
    return SECTIONS.some((s) => s.id === h) ? (h as SectionId) : "profile";
  })();
  const [active, setActive] = useState<SectionId>(initialSection);
  // Mobile drill-down: the section list (level 1) vs a single section page (level 2).
  // Desktop ignores this (CSS shows both panes). Deep-links open straight to the page.
  const [mobileDetail, setMobileDetail] = useState<boolean>(
    () => window.location.hash.replace("#", "") !== "" &&
      SECTIONS.some((s) => s.id === window.location.hash.replace("#", "")),
  );
  const openSection = useCallback((id: SectionId) => {
    setActive(id);
    setMobileDetail(true);
  }, []);

  /* ─── Profile ─── */
  const [profile, setProfile] = useState<ProfileForm>({
    name: "",
    email: "",
    company: "",
    phone: "",
    jobTitle: "",
    licenseNumber: "",
    yearsInBusiness: "",
    location: "",
    specialization: "",
    teamSize: "",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  /* ─── Sequence settings ─── */
  const [seq, setSeq] = useState<SeqSettings>({
    killSwitch: false,
    defaultTimezone: "UTC",
    defaultQuietHours: { start: "21:00", end: "08:00" },
    maxPerClientPerDay: 5,
    stopOnReply: true,
    stopOnClosed: true,
  });
  const [seqSaving, setSeqSaving] = useState(false);
  const [seqSaved, setSeqSaved] = useState(false);

  /* ─── Integrations ─── */
  const [integrations, setIntegrations] = useState<IntegrationStatus>({
    gmail: { connected: false, email: null },
    whatsapp: { connected: false, phone: null },
  });
  const [connectBusy, setConnectBusy] = useState(false);
  const [showWaForm, setShowWaForm] = useState(false);
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waError, setWaError] = useState("");

  /* ─── Credits & Usage ─── */
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [usage, setUsage] = useState<UsageEntry[]>([]);

  /* ─── About & Support ─── */
  const [emailCopied, setEmailCopied] = useState(false);
  const copySupportEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      /* clipboard blocked — the address is visible to copy manually */
    }
  };

  /* ─── Billing ─── */
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [billingBusy, setBillingBusy] = useState(""); // "portal" | "growth" | "pro"
  const [billingAnnual, setBillingAnnual] = useState(false);
  const [billingError, setBillingError] = useState("");
  const billingNotice = (() => {
    const p = new URLSearchParams(window.location.search).get("billing");
    return p === "success" ? "success" : p === "cancelled" ? "cancelled" : null;
  })();

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /* ─── Loaders ─── */
  const loadProfile = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/me");
      if (!res.ok) return;
      const { user: u } = await res.json();
      setProfile({
        name: u.name || "",
        email: u.email || "",
        company: u.company || "",
        phone: u.phone || "",
        jobTitle: u.jobTitle || "",
        licenseNumber: u.licenseNumber || "",
        yearsInBusiness: u.yearsInBusiness != null ? String(u.yearsInBusiness) : "",
        location: u.location || "",
        specialization: u.specialization || "",
        teamSize: u.teamSize || "",
      });
    } catch {
      /* leave defaults */
    }
  }, []);

  const loadSeq = useCallback(async () => {
    try {
      const res = await authFetch("/api/sequences/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSeq({
        killSwitch: !!data.killSwitch,
        defaultTimezone: data.defaultTimezone || "UTC",
        defaultQuietHours: data.defaultQuietHours || { start: "21:00", end: "08:00" },
        maxPerClientPerDay: data.maxPerClientPerDay ?? 5,
        stopOnReply: data.stopOnReply ?? true,
        stopOnClosed: data.stopOnClosed ?? true,
      });
    } catch {
      /* leave defaults */
    }
  }, []);

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await authFetch("/api/integrations/status");
      if (!res.ok) return;
      setIntegrations(await res.json());
    } catch {
      /* leave defaults */
    }
  }, []);

  const loadBilling = useCallback(async () => {
    try {
      const res = await authFetch("/api/billing/me");
      if (!res.ok) return;
      setBilling(await res.json());
    } catch {
      /* leave null */
    }
  }, []);

  const loadCredits = useCallback(async () => {
    try {
      const [cRes, uRes] = await Promise.all([
        authFetch("/api/agent/credits"),
        authFetch("/api/agent/usage"),
      ]);
      if (cRes.ok) setCredits(await cRes.json());
      if (uRes.ok) {
        const d = await uRes.json();
        setUsage(Array.isArray(d.history) ? d.history : []);
      }
    } catch {
      /* leave defaults */
    }
  }, []);

  useEffect(() => {
    loadProfile();
    loadSeq();
    loadIntegrations();
    loadBilling();
    loadCredits();
  }, [loadProfile, loadSeq, loadIntegrations, loadBilling, loadCredits]);

  /* Redirect to Stripe Checkout (upgrade from Settings) or the Customer Portal. */
  const startCheckout = async (planId: string) => {
    setBillingBusy(planId);
    setBillingError("");
    try {
      const res = await authFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, interval: billingAnnual ? "year" : "month", context: "settings" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn’t start checkout");
      window.location.href = data.url;
    } catch (err: unknown) {
      setBillingError(err instanceof Error ? err.message : "Couldn’t start checkout");
      setBillingBusy("");
    }
  };

  const openPortal = async () => {
    setBillingBusy("portal");
    setBillingError("");
    try {
      const res = await authFetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn’t open billing portal");
      window.location.href = data.url;
    } catch (err: unknown) {
      setBillingError(err instanceof Error ? err.message : "Couldn’t open billing portal");
      setBillingBusy("");
    }
  };

  /* ─── Savers ─── */
  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          company: profile.company,
          phone: profile.phone,
          jobTitle: profile.jobTitle,
          licenseNumber: profile.licenseNumber,
          yearsInBusiness: profile.yearsInBusiness ? Number(profile.yearsInBusiness) : null,
          location: profile.location,
          specialization: profile.specialization,
          teamSize: profile.teamSize,
        }),
      });
      if (res.ok) {
        const { user: u } = await res.json();
        if (user) updateUser({ ...user, name: u.name }); // reflect name in sidebar
        setProfileSaved(true);
        setTimeout(() => setProfileSaved(false), 2500);
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const saveSeq = async () => {
    setSeqSaving(true);
    setSeqSaved(false);
    try {
      // Kill switch has its own endpoint.
      await authFetch("/api/sequences/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: seq.killSwitch }),
      });
      const res = await authFetch("/api/sequences/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultTimezone: seq.defaultTimezone,
          defaultQuietHours: seq.defaultQuietHours,
          maxPerClientPerDay: seq.maxPerClientPerDay,
          stopOnReply: seq.stopOnReply,
          stopOnClosed: seq.stopOnClosed,
        }),
      });
      if (res.ok) {
        setSeqSaved(true);
        setTimeout(() => setSeqSaved(false), 2500);
      }
    } finally {
      setSeqSaving(false);
    }
  };

  /* ─── Integration actions (mirror the Inbox flow) ─── */
  const connectGmail = async () => {
    setConnectBusy(true);
    try {
      const res = await authFetch("/api/integrations/gmail/auth-url");
      const data = await res.json();
      if (data.url) {
        const popup = window.open(data.url, "Gmail Authorization", "width=600,height=700,left=200,top=100");
        const timer = setInterval(() => {
          if (popup?.closed) {
            clearInterval(timer);
            loadIntegrations();
          }
        }, 1000);
      }
    } finally {
      setConnectBusy(false);
    }
  };

  const disconnectGmail = async () => {
    setConnectBusy(true);
    try {
      await authFetch("/api/integrations/gmail/disconnect", { method: "DELETE" });
      await loadIntegrations();
    } finally {
      setConnectBusy(false);
    }
  };

  const connectWhatsApp = async () => {
    if (!waPhoneId.trim() || !waToken.trim()) {
      setWaError("Both fields are required.");
      return;
    }
    setConnectBusy(true);
    setWaError("");
    try {
      const res = await authFetch("/api/integrations/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId: waPhoneId.trim(), accessToken: waToken.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        await loadIntegrations();
        setShowWaForm(false);
        setWaPhoneId("");
        setWaToken("");
      } else {
        setWaError(data.error || "Connection failed.");
      }
    } catch {
      setWaError("Network error. Please try again.");
    } finally {
      setConnectBusy(false);
    }
  };

  const disconnectWhatsApp = async () => {
    setConnectBusy(true);
    try {
      await authFetch("/api/integrations/whatsapp/disconnect", { method: "DELETE" });
      await loadIntegrations();
    } finally {
      setConnectBusy(false);
    }
  };

  /* ─── Section renderers ─── */
  const renderProfile = () => (
    <div className="settings-panel">
      <div className="settings-panel__head">
        <h2 className="settings-panel__title">Account & Profile</h2>
        <p className="settings-panel__sub">
          Your identity across the app. Several of these feed the merge fields used in
          sequences (e.g. company and phone appear in your outgoing messages).
        </p>
      </div>

      <div className="settings-grid">
        <Field label="Full name" hint="Shown in the app and signs off your messages where the merge field is used.">
          <input
            className="settings-input"
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          />
        </Field>

        <Field label="Email address" hint="Used to sign in. Changing it needs re-verification — coming soon, so it's locked for now.">
          <input className="settings-input" value={profile.email} disabled />
        </Field>

        <Field label="Company / brokerage" hint="Inserted wherever a sequence uses the {broker.company} merge field.">
          <input
            className="settings-input"
            value={profile.company}
            onChange={(e) => setProfile({ ...profile, company: e.target.value })}
          />
        </Field>

        <Field label="Phone number" hint="Inserted wherever a sequence uses the {broker.phone} merge field.">
          <input
            className="settings-input"
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
          />
        </Field>

        <Field label="Job title" hint="Display only — e.g. ‘Principal Broker’ or ‘Sales Associate’.">
          <input
            className="settings-input"
            value={profile.jobTitle}
            onChange={(e) => setProfile({ ...profile, jobTitle: e.target.value })}
          />
        </Field>

        <Field label="License number" hint="Your real-estate / broker license. Kept for your records and compliance footers.">
          <input
            className="settings-input"
            value={profile.licenseNumber}
            onChange={(e) => setProfile({ ...profile, licenseNumber: e.target.value })}
          />
        </Field>

        <Field label="Years in business" hint="Optional. Used for your profile and any experience-based messaging.">
          <input
            className="settings-input"
            type="number"
            min={0}
            value={profile.yearsInBusiness}
            onChange={(e) => setProfile({ ...profile, yearsInBusiness: e.target.value })}
          />
        </Field>

        <Field label="Location" hint="City / state you operate in. Helps tailor templates to your market.">
          <input
            className="settings-input"
            value={profile.location}
            onChange={(e) => setProfile({ ...profile, location: e.target.value })}
          />
        </Field>

        <Field label="Specialization" hint="e.g. Residential, Commercial, Land. Context for AI-generated copy.">
          <input
            className="settings-input"
            value={profile.specialization}
            onChange={(e) => setProfile({ ...profile, specialization: e.target.value })}
          />
        </Field>

        <Field label="Team size" hint="Solo, 2–5, 6–20, 20+. Used to right-size suggestions and future seat planning.">
          <input
            className="settings-input"
            value={profile.teamSize}
            onChange={(e) => setProfile({ ...profile, teamSize: e.target.value })}
          />
        </Field>
      </div>

      <div className="settings-actions">
        <button className="settings-btn settings-btn--primary" onClick={saveProfile} disabled={profileSaving}>
          {profileSaving ? "Saving…" : "Save profile"}
        </button>
        {profileSaved && <span className="settings-saved">Saved ✓</span>}
      </div>
    </div>
  );

  const renderSequences = () => (
    <div className="settings-panel">
      <div className="settings-panel__head">
        <h2 className="settings-panel__title">Sequences & Automation</h2>
        <p className="settings-panel__sub">
          Account-wide defaults the sequence engine obeys. These apply to every sequence you run.
        </p>
      </div>

      <Toggle
        label="Pause all sending (kill switch)"
        hint="Instantly halts every sequence from sending anything. Enrollments keep their place and resume the moment you turn this off — nothing is lost. Use it if something looks wrong."
        checked={seq.killSwitch}
        onChange={(v) => setSeq({ ...seq, killSwitch: v })}
      />

      <Field
        label="Max messages per client, per day"
        hint="The most messages any single client receives in 24 hours — counted across ALL your sequences combined, so a client enrolled in several won't get flooded. Extra messages aren't dropped; they're held and sent later. Set 0 to disable capping."
      >
        <input
          className="settings-input settings-input--narrow"
          type="number"
          min={0}
          max={50}
          value={seq.maxPerClientPerDay}
          onChange={(e) => setSeq({ ...seq, maxPerClientPerDay: Number(e.target.value) })}
        />
      </Field>

      <Field
        label="Default timezone"
        hint={`Used for scheduling and quiet hours when a client has no timezone of their own. Your browser detected ${detectedTz}.`}
      >
        <div className="settings-tz-row">
          <select
            className="settings-input"
            value={seq.defaultTimezone}
            onChange={(e) => setSeq({ ...seq, defaultTimezone: e.target.value })}
          >
            {Array.from(new Set([detectedTz, ...COMMON_TZ])).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          {seq.defaultTimezone !== detectedTz && (
            <button
              type="button"
              className="settings-btn settings-btn--ghost"
              onClick={() => setSeq({ ...seq, defaultTimezone: detectedTz })}
            >
              Use detected
            </button>
          )}
        </div>
      </Field>

      <Field
        label="Default quiet hours"
        hint="A nightly window where messages are held until morning. This is the account default; individual send steps can still override it. Evaluated in the recipient's timezone."
      >
        <div className="settings-quiet-row">
          <input
            className="settings-input settings-input--time"
            type="time"
            value={seq.defaultQuietHours.start}
            onChange={(e) => setSeq({ ...seq, defaultQuietHours: { ...seq.defaultQuietHours, start: e.target.value } })}
          />
          <span className="settings-quiet-row__to">to</span>
          <input
            className="settings-input settings-input--time"
            type="time"
            value={seq.defaultQuietHours.end}
            onChange={(e) => setSeq({ ...seq, defaultQuietHours: { ...seq.defaultQuietHours, end: e.target.value } })}
          />
        </div>
      </Field>

      <Toggle
        label="Stop a sequence when the client replies"
        hint="A safety net for drip sequences: if a client replies, pull them out so they don't keep getting automated follow-ups while you're talking. Sequences that contain a ‘Wait for reply’ step already handle replies on their own and ignore this — so their Replied branch keeps working."
        checked={seq.stopOnReply}
        onChange={(v) => setSeq({ ...seq, stopOnReply: v })}
      />

      <Toggle
        label="Stop a sequence when the deal closes"
        hint="When a client's deal is marked closed, remove them from active sequences — no more chasing someone who's already across the line."
        checked={seq.stopOnClosed}
        onChange={(v) => setSeq({ ...seq, stopOnClosed: v })}
      />

      <div className="settings-actions">
        <button className="settings-btn settings-btn--primary" onClick={saveSeq} disabled={seqSaving}>
          {seqSaving ? "Saving…" : "Save automation settings"}
        </button>
        {seqSaved && <span className="settings-saved">Saved ✓</span>}
      </div>
    </div>
  );

  const renderIntegrations = () => (
    <div className="settings-panel">
      <div className="settings-panel__head">
        <h2 className="settings-panel__title">Integrations</h2>
        <p className="settings-panel__sub">
          Connect the channels your sequences send through. Status here is shared with the Inbox.
        </p>
      </div>

      {/* Gmail */}
      <div className="settings-integration">
        <div className="settings-integration__info">
          <span className="settings-integration__name">Gmail</span>
          <p className="settings-field__hint">
            {integrations.gmail.connected
              ? `Connected as ${integrations.gmail.email}. Emails in your sequences send from this account.`
              : "Not connected. Connect to send and receive email through your sequences and Inbox."}
          </p>
        </div>
        {integrations.gmail.connected ? (
          <button className="settings-btn settings-btn--danger" onClick={disconnectGmail} disabled={connectBusy}>
            Disconnect
          </button>
        ) : (
          <button className="settings-btn settings-btn--primary" onClick={connectGmail} disabled={connectBusy}>
            Connect
          </button>
        )}
      </div>

      {/* WhatsApp */}
      <div className="settings-integration">
        <div className="settings-integration__info">
          <span className="settings-integration__name">
            WhatsApp
            {WHATSAPP_COMING_SOON && <span className="settings-badge settings-badge--soon">Coming soon</span>}
          </span>
          <p className="settings-field__hint">
            {WHATSAPP_COMING_SOON
              ? "WhatsApp connection is coming soon. We're completing Meta business verification so you'll be able to connect your number in just a few clicks."
              : integrations.whatsapp.connected
              ? `Connected (${integrations.whatsapp.phone}). WhatsApp send steps will use this number.`
              : "Not connected. Connect a WhatsApp Cloud API number to send WhatsApp messages from sequences."}
          </p>
          {!WHATSAPP_COMING_SOON && showWaForm && !integrations.whatsapp.connected && (
            <div className="settings-wa-form">
              <p className="settings-field__hint settings-wa-form__note">
                💡 Manual setup for now. Once our Meta verification is approved,
                connecting WhatsApp will take just a couple of clicks — no Phone
                Number ID or token needed.
              </p>
              <input
                className="settings-input"
                placeholder="Phone Number ID"
                value={waPhoneId}
                onChange={(e) => setWaPhoneId(e.target.value)}
              />
              <input
                className="settings-input"
                placeholder="Access Token"
                value={waToken}
                onChange={(e) => setWaToken(e.target.value)}
              />
              {waError && <span className="settings-wa-form__error">{waError}</span>}
              <div className="settings-wa-form__actions">
                <button className="settings-btn settings-btn--primary" onClick={connectWhatsApp} disabled={connectBusy}>
                  Save & connect
                </button>
                <button className="settings-btn settings-btn--ghost" onClick={() => setShowWaForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {WHATSAPP_COMING_SOON ? (
          <button className="settings-btn settings-btn--primary" disabled>
            Coming soon
          </button>
        ) : integrations.whatsapp.connected ? (
          <button className="settings-btn settings-btn--danger" onClick={disconnectWhatsApp} disabled={connectBusy}>
            Disconnect
          </button>
        ) : (
          !showWaForm && (
            <button className="settings-btn settings-btn--primary" onClick={() => setShowWaForm(true)}>
              Connect
            </button>
          )
        )}
      </div>
    </div>
  );

  const renderBilling = () => {
    const isPaid = !!billing && billing.plan !== "free";
    const fmtDate = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—";

    return (
      <div className="settings-panel">
        <div className="settings-panel__head">
          <h2 className="settings-panel__title">Billing &amp; Subscription</h2>
          <p className="settings-panel__desc">Manage your plan, payment method, and invoices.</p>
        </div>

        {billingNotice === "success" && (
          <p className="settings-banner settings-banner--success">🎉 You’re subscribed — your plan is now active.</p>
        )}
        {billingNotice === "cancelled" && (
          <p className="settings-banner">Checkout was cancelled. You can pick a plan again anytime.</p>
        )}
        {billingError && <p className="settings-banner settings-banner--error">{billingError}</p>}

        {/* Current plan card */}
        <div className="settings-plan-card">
          <div className="settings-plan-card__top">
            <div>
              <span className="settings-plan-card__label">Current plan</span>
              <div className="settings-plan-card__name">
                {billing?.planLabel || "Free"}
                {isPaid && billing?.status && (
                  <span
                    className={`settings-plan-card__status ${
                      billing.status === "active" || billing.status === "trialing"
                        ? "is-ok"
                        : billing.status === "past_due"
                          ? "is-warn"
                          : ""
                    }`}
                  >
                    {billing.status === "past_due" ? "Payment past due" : billing.status}
                  </span>
                )}
              </div>
            </div>
            <div className="settings-plan-card__price">
              {!isPaid ? (
                <strong>Free</strong>
              ) : (
                <>
                  <strong>
                    ${billing.interval === "year" ? billing.price.year : billing.price.month}
                  </strong>
                  <span>/mo{billing.interval === "year" ? " · billed yearly" : ""}</span>
                </>
              )}
            </div>
          </div>

          {isPaid && (
            <p className="settings-plan-card__renew">
              {billing?.cancelAtPeriodEnd
                ? `Your plan ends on ${fmtDate(billing.renewsAt)} — you’ll move to Free after that.`
                : `Renews on ${fmtDate(billing?.renewsAt ?? null)}.`}
            </p>
          )}

          {billing && !billing.billingConfigured && (
            <p className="settings-field__hint">Billing isn’t configured on this server yet.</p>
          )}

          {isPaid && (
            <button
              className="settings-btn settings-btn--primary"
              onClick={openPortal}
              disabled={billingBusy === "portal" || !billing?.billingConfigured}
            >
              {billingBusy === "portal" ? "Opening…" : "Manage billing"}
            </button>
          )}
          {isPaid && (
            <p className="settings-field__hint">
              Change plan, update your card, download invoices, or cancel — all in the secure Stripe portal.
            </p>
          )}
        </div>

        {/* Upgrade options for free users */}
        {!isPaid && (
          <>
            <div className="settings-bill-toggle">
              <span className={!billingAnnual ? "is-active" : ""}>Monthly</span>
              <button
                type="button"
                className={`settings-toggle ${billingAnnual ? "settings-toggle--on" : ""}`}
                onClick={() => setBillingAnnual((a) => !a)}
                aria-pressed={billingAnnual}
              >
                <span className="settings-toggle__knob" />
              </button>
              <span className={billingAnnual ? "is-active" : ""}>Annual</span>
              <span className="settings-bill-save">Save 16%</span>
            </div>

            <div className="settings-upgrade-grid">
              {UPGRADE_PLANS.map((p) => (
                <div key={p.id} className={`settings-upgrade ${p.popular ? "is-popular" : ""}`}>
                  {p.popular && <span className="settings-upgrade__badge">Most popular</span>}
                  <span className="settings-upgrade__name">{p.name}</span>
                  <div className="settings-upgrade__price">
                    <strong>${billingAnnual ? p.price.year : p.price.month}</strong>
                    <span>/mo</span>
                  </div>
                  <ul className="settings-upgrade__points">
                    {p.points.map((pt) => (
                      <li key={pt}>{pt}</li>
                    ))}
                  </ul>
                  <button
                    className={`settings-btn ${p.popular ? "settings-btn--primary" : ""}`}
                    onClick={() => startCheckout(p.id)}
                    disabled={!!billingBusy || (billing ? !billing.billingConfigured : false)}
                  >
                    {billingBusy === p.id ? "Redirecting…" : `Upgrade to ${p.name}`}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  /* ─── Credits & Usage ─── */
  const prettyTool = (n: string) =>
    (n || "Action").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const relTime = (iso: string) => {
    const t = new Date(iso).getTime();
    if (!t) return "";
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const nextReset = (iso: string | null) => {
    if (!iso) return "monthly";
    const d = new Date(iso);
    d.setMonth(d.getMonth() + 1);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const renderCredits = () => {
    const unlimited = !!credits?.unlimited;
    const alloc = credits?.monthlyAllocation ?? 0;
    const remaining = credits?.credits ?? 0;
    const usedCycle = unlimited ? 0 : Math.max(0, alloc - remaining);
    const pct = unlimited || alloc === 0 ? 100 : Math.max(0, Math.min(100, (remaining / alloc) * 100));
    const low = !unlimited && alloc > 0 && pct <= 20;

    return (
      <div className="settings-panel">
        <div className="settings-panel__head">
          <h2 className="settings-panel__title">Credits &amp; Usage</h2>
          <p className="settings-panel__sub">
            AI Copilot credits are spent when the assistant runs actions for you. They refresh every
            month with your plan.
          </p>
        </div>

        <div className="settings-credits-hero">
          <div className="settings-credits-hero__top">
            <div>
              <span className="settings-credits-hero__label">Credits remaining</span>
              <div className="settings-credits-hero__value">
                {unlimited ? (
                  "Unlimited"
                ) : (
                  <>
                    {remaining}
                    <span className="settings-credits-hero__of"> / {alloc}</span>
                  </>
                )}
              </div>
            </div>
            <span className="settings-credits-hero__tier">{credits?.tierLabel || "Free"} plan</span>
          </div>
          {!unlimited && (
            <>
              <div className="settings-credits-bar">
                <div className={`settings-credits-bar__fill ${low ? "is-low" : ""}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="settings-credits-hero__foot">
                <span>{usedCycle} used this cycle</span>
                <span>Resets {nextReset(credits?.lastRefill ?? null)}</span>
              </div>
            </>
          )}
        </div>

        {low && (
          <div className="settings-credits-warn">
            <span>You’re running low on credits this month.</span>
            <button className="settings-link-btn" onClick={() => openSection("billing")}>
              Upgrade for more →
            </button>
          </div>
        )}

        <div className="settings-stat-row">
          <div className="settings-stat">
            <span className="settings-stat__num">{unlimited ? "∞" : remaining}</span>
            <span className="settings-stat__label">Remaining</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__num">{usedCycle}</span>
            <span className="settings-stat__label">Used this cycle</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__num">{credits?.totalUsed ?? 0}</span>
            <span className="settings-stat__label">Used all-time</span>
          </div>
        </div>

        <div className="settings-usage">
          <h3 className="settings-usage__title">Recent activity</h3>
          {usage.length === 0 ? (
            <div className="settings-usage__empty">
              No copilot activity yet. Once you start using the AI Copilot, your credit spend shows up here.
            </div>
          ) : (
            <ul className="settings-usage__list">
              {usage.map((u, i) => (
                <li key={i} className="settings-usage__item">
                  <span className="settings-usage__dot" aria-hidden />
                  <span className="settings-usage__tool">{prettyTool(u.toolName)}</span>
                  <span className="settings-usage__time">{relTime(u.timestamp)}</span>
                  <span className="settings-usage__cost">−{u.cost}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  /* ─── About & Support ─── */
  const renderAbout = () => (
    <div className="settings-panel">
      <div className="settings-panel__head">
        <h2 className="settings-panel__title">About &amp; Support</h2>
        <p className="settings-panel__sub">Get help, find resources, and see what plan you’re on.</p>
      </div>

      <div className="settings-about-grid">
        <div className="settings-about-card">
          <span className="settings-about-card__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </span>
          <h3 className="settings-about-card__title">Contact support</h3>
          <p className="settings-about-card__text">
            Questions, bugs, or feedback? We usually reply within a business day.
          </p>
          <div className="settings-about-email">
            <code className="settings-about-email__addr">{SUPPORT_EMAIL}</code>
            <button className="settings-about-email__copy" onClick={copySupportEmail} title="Copy email">
              {emailCopied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p className="settings-about-card__text settings-about-card__text--reddit">
            Or request a bug fix or a new feature through our subreddit.
          </p>
          <a
            className="settings-btn settings-btn--reddit"
            href="https://www.reddit.com/r/EscrowsAI/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
            </svg>
            Visit r/EscrowsAI
          </a>
        </div>

        <div className="settings-about-card">
          <span className="settings-about-card__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h11a3 3 0 013 3v13M4 4v13a3 3 0 003 3h11M4 4a2 2 0 012-2h9a2 2 0 012 2" />
            </svg>
          </span>
          <h3 className="settings-about-card__title">Resources</h3>
          <ul className="settings-about-links">
            <li><a href="/pricing" target="_blank" rel="noreferrer">Plans &amp; pricing ↗</a></li>
            <li><a href="/about" target="_blank" rel="noreferrer">About Escrows AI ↗</a></li>
            <li><a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy policy ↗</a></li>
            <li><a href="/terms-of-service" target="_blank" rel="noreferrer">Terms of service ↗</a></li>
          </ul>
        </div>
      </div>

      <div className="settings-about-meta">
        <div className="settings-about-meta__item">
          <span>Signed in as</span>
          <strong>{profile.email || user?.email || "—"}</strong>
        </div>
        <div className="settings-about-meta__item">
          <span>Current plan</span>
          <strong>{billing?.planLabel || credits?.tierLabel || "Free"}</strong>
        </div>
        <div className="settings-about-meta__item">
          <span>Application</span>
          <strong>Escrows AI · v1.0</strong>
        </div>
      </div>
    </div>
  );

  const renderStub = (label: string) => (
    <div className="settings-panel">
      <div className="settings-panel__head">
        <h2 className="settings-panel__title">{label}</h2>
      </div>
      <div className="settings-stub">
        <div className="settings-stub__badge">Coming soon</div>
        <p className="settings-stub__text">
          {label} isn’t available yet. It’s on the roadmap — you’ll find it here once it ships.
        </p>
      </div>
    </div>
  );

  const renderActive = () => {
    switch (active) {
      case "profile":
        return renderProfile();
      case "sequences":
        return renderSequences();
      case "integrations":
        return renderIntegrations();
      case "billing":
        return renderBilling();
      case "credits":
        return renderCredits();
      case "about":
        return renderAbout();
      default:
        return renderStub(SECTIONS.find((s) => s.id === active)?.label || "Settings");
    }
  };

  const NavItem: React.FC<{ s: (typeof SECTIONS)[number] }> = ({ s }) => (
    <button
      className={`settings__nav-item ${active === s.id ? "settings__nav-item--active" : ""}`}
      onClick={() => openSection(s.id)}
    >
      <span className="settings__nav-icon" aria-hidden>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {SECTION_ICONS[s.id]}
        </svg>
      </span>
      <span className="settings__nav-label">{s.label}</span>
      {!s.live && <span className="settings__nav-soon">soon</span>}
      {/* Drill-down affordance — shown only in the mobile list view. */}
      <span className="settings__nav-chevron" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  );

  const liveSections = SECTIONS.filter((s) => s.live);
  const soonSections = SECTIONS.filter((s) => !s.live);

  return (
    <div className={`settings ${mobileDetail ? "settings--detail" : ""}`}>
      <div className="settings__header">
        <h1 className="settings__title">Settings</h1>
        <p className="settings__subtitle">Manage your account, automation defaults, and connections.</p>
      </div>

      <div className="settings__body">
        <nav className="settings__nav">
          {liveSections.map((s) => (
            <NavItem key={s.id} s={s} />
          ))}
          {soonSections.length > 0 && (
            <>
              <div className="settings__nav-divider">Coming soon</div>
              {soonSections.map((s) => (
                <NavItem key={s.id} s={s} />
              ))}
            </>
          )}
        </nav>

        <div className="settings__content">
          {/* Mobile drill-down back header — hidden on desktop. */}
          <button className="settings__back" onClick={() => setMobileDetail(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Settings
          </button>
          <div key={active} className="settings__panel-anim">
            {renderActive()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
