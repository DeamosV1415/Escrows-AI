import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthContext";
import { authFetch } from "../utils/authFetch";
import "./OnboardingPage.css";

const STEPS = ["Welcome", "Plan", "Your business", "Connect"];

/* Compact plan catalog for the picker — mirrors the pricing page / server PLANS. */
const PLAN_OPTIONS = [
  {
    id: "free",
    name: "Free",
    price: { month: 0, year: 0 },
    blurb: "Get going — no card required.",
    points: ["2 active sequences", "40 AI credits/mo", "100 MB storage"],
    popular: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: { month: 35, year: 30 },
    blurb: "For agents ready to scale.",
    points: ["8 active sequences", "250 AI credits/mo", "2 GB storage"],
    popular: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: { month: 70, year: 60 },
    blurb: "For teams that close at scale.",
    points: ["15 active sequences", "700 AI credits/mo", "10 GB storage", "Advanced deal signals"],
    popular: false,
  },
] as const;

export default function OnboardingPage() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  // Resume at the step encoded in the URL — Stripe Checkout returns to ?step=2.
  const params = new URLSearchParams(window.location.search);
  const initialStep = (() => {
    const s = parseInt(params.get("step") || "", 10);
    return Number.isInteger(s) && s >= 0 && s < STEPS.length ? s : 0;
  })();
  const [step, setStep] = useState(initialStep);
  const [checkoutResult] = useState(params.get("checkout")); // "success" | "cancelled" | null

  // Plan step
  const [annual, setAnnual] = useState(false);
  const [planLoading, setPlanLoading] = useState(""); // plan id currently redirecting to Checkout

  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [yearsInBusiness, setYearsInBusiness] = useState("");
  const [location, setLocation] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Connect step
  const [gmailConnected, setGmailConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // If the user already finished onboarding before (profile complete on arrival), bounce
  // them out. Guarded to step 0 so that saving the profile mid-wizard — which flips
  // profileComplete true — doesn't yank them past the Connect step.
  useEffect(() => {
    if (user?.profileComplete && step === 0) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate, step]);

  const firstName = (user?.name || "").trim().split(" ")[0];

  /* Persist the profile (called when leaving the profile step). Marks profileComplete. */
  const saveProfile = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          company,
          jobTitle,
          licenseNumber,
          yearsInBusiness: yearsInBusiness ? parseInt(yearsInBusiness) : null,
          location,
          specialization,
          teamSize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      updateUser({ ...(user as NonNullable<typeof user>), ...data.user });
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleProfileContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveProfile();
    if (ok) setStep(3);
  };

  // Hand off to the dashboard's one-time welcome takeover (processing → guided-tour prompt).
  const finish = () => navigate("/dashboard?welcome=1", { replace: true });

  /* Plan step: Free continues in-app; a paid plan redirects to Stripe Checkout.
     On return, Stripe sends the browser back to ?step=2 (the business step). */
  const choosePlan = async (planId: string) => {
    if (planId === "free") {
      setStep(2);
      return;
    }
    setPlanLoading(planId);
    setError("");
    try {
      const res = await authFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, interval: annual ? "year" : "month", context: "onboarding" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn’t start checkout");
      window.location.href = data.url; // hand off to Stripe-hosted Checkout
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn’t start checkout");
      setPlanLoading("");
    }
  };

  /* Skip the whole flow — still marks complete so they aren't re-gated; the dashboard
     "Get started" checklist keeps guiding them. */
  const handleSkip = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, company, jobTitle, licenseNumber, location, specialization, teamSize }),
      });
      const data = await res.json();
      if (res.ok) updateUser({ ...(user as NonNullable<typeof user>), ...data.user });
    } catch {
      /* navigate anyway */
    } finally {
      finish();
    }
  };

  /* Gmail OAuth popup (mirrors the Inbox/Settings flow). */
  const connectGmail = async () => {
    setConnecting(true);
    try {
      const res = await authFetch("/api/integrations/gmail/auth-url");
      const data = await res.json();
      if (data.url) {
        const popup = window.open(data.url, "Gmail Authorization", "width=600,height=700,left=200,top=100");
        const timer = setInterval(async () => {
          if (popup?.closed) {
            clearInterval(timer);
            try {
              const s = await authFetch("/api/integrations/status");
              const status = await s.json();
              setGmailConnected(!!status?.gmail?.connected);
            } catch {
              /* ignore */
            }
            setConnecting(false);
          }
        }, 1000);
      } else {
        setConnecting(false);
      }
    } catch {
      setConnecting(false);
    }
  };

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {/* Progress */}
        <div className="onboarding-progress">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`onboarding-progress__step ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}
            >
              <span className="onboarding-progress__dot">{i < step ? "✓" : i + 1}</span>
              <span className="onboarding-progress__label">{label}</span>
            </div>
          ))}
        </div>

        {/* ─── Step 0: Welcome ─── */}
        {step === 0 && (
          <>
            <div className="onboarding-header">
              <span className="onboarding-step">Welcome</span>
              <h1 className="onboarding-title">
                Welcome to Escrows AI{firstName ? `, ${firstName}` : ""}
              </h1>
              <p className="onboarding-subtitle">
                Let’s get you set up in under a minute. Here’s what you’ll be able to do.
              </p>
            </div>

            <ul className="onboarding-features">
              <li className="onboarding-feature">
                <span className="onboarding-feature__icon">✉️</span>
                <div>
                  <strong>Follow up on autopilot</strong>
                  <p>Email &amp; WhatsApp sequences that nurture every lead for you.</p>
                </div>
              </li>
              <li className="onboarding-feature">
                <span className="onboarding-feature__icon">📊</span>
                <div>
                  <strong>Keep every deal on track</strong>
                  <p>Clients, pipeline, and next actions — all in one place.</p>
                </div>
              </li>
              <li className="onboarding-feature">
                <span className="onboarding-feature__icon">✨</span>
                <div>
                  <strong>An AI copilot at your side</strong>
                  <p>Drafts messages, updates records, and answers — inside your dashboard.</p>
                </div>
              </li>
            </ul>

            <button className="onboarding-submit" onClick={() => setStep(1)}>
              Let’s get set up →
            </button>
            <div className="onboarding-skip">
              <button onClick={handleSkip} disabled={loading}>
                Skip setup
              </button>
            </div>
          </>
        )}

        {/* ─── Step 1: Choose plan ─── */}
        {step === 1 && (
          <>
            <div className="onboarding-header">
              <span className="onboarding-step">Step 1 of 4</span>
              <h1 className="onboarding-title">Pick a plan</h1>
              <p className="onboarding-subtitle">
                Start free, or unlock more sequences and AI credits. You can change or cancel
                anytime from Settings.
              </p>
            </div>

            {checkoutResult === "cancelled" && (
              <p className="onboarding-error">Checkout was cancelled — you can pick a plan again or continue on Free.</p>
            )}

            <div className="onboarding-plan-toggle">
              <span className={!annual ? "is-active" : ""}>Monthly</span>
              <button
                type="button"
                className={`onboarding-plan-switch ${annual ? "is-annual" : ""}`}
                onClick={() => setAnnual((a) => !a)}
                aria-label="Toggle annual billing"
              />
              <span className={annual ? "is-active" : ""}>Annual</span>
              <span className="onboarding-plan-save">Save 16%</span>
            </div>

            <div className="onboarding-plans">
              {PLAN_OPTIONS.map((p) => {
                const price = annual ? p.price.year : p.price.month;
                return (
                  <div key={p.id} className={`onboarding-plan ${p.popular ? "is-popular" : ""}`}>
                    {p.popular && <span className="onboarding-plan__badge">Most popular</span>}
                    <span className="onboarding-plan__name">{p.name}</span>
                    <div className="onboarding-plan__price">
                      {price === 0 ? (
                        <strong>Free</strong>
                      ) : (
                        <>
                          <span className="onboarding-plan__cur">$</span>
                          <strong>{price}</strong>
                          <span className="onboarding-plan__per">/mo</span>
                        </>
                      )}
                    </div>
                    <p className="onboarding-plan__blurb">{p.blurb}</p>
                    <ul className="onboarding-plan__points">
                      {p.points.map((pt) => (
                        <li key={pt}>{pt}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className={`onboarding-plan__cta ${p.popular ? "is-primary" : ""}`}
                      onClick={() => choosePlan(p.id)}
                      disabled={!!planLoading}
                    >
                      {planLoading === p.id
                        ? "Redirecting…"
                        : p.id === "free"
                          ? "Continue free"
                          : `Choose ${p.name}`}
                    </button>
                  </div>
                );
              })}
            </div>

            {error && <p className="onboarding-error">{error}</p>}

            <div className="onboarding-actions">
              <button type="button" className="onboarding-back" onClick={() => setStep(0)}>
                ← Back
              </button>
            </div>
          </>
        )}

        {/* ─── Step 2: Profile ─── */}
        {step === 2 && (
          <>
            <div className="onboarding-header">
              <span className="onboarding-step">Step 3 of 4</span>
              <h1 className="onboarding-title">Tell us about your business</h1>
              <p className="onboarding-subtitle">
                This personalizes your messages and templates. Everything’s optional — you can
                change it anytime in Settings.
              </p>
            </div>

            {checkoutResult === "success" && (
              <p className="onboarding-success">🎉 You’re subscribed — welcome aboard! Your plan is now active.</p>
            )}

            <form className="onboarding-form" onSubmit={handleProfileContinue}>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label>Name</label>
                  <input type="text" value={user?.name || ""} disabled />
                </div>
                <div className="onboarding-field">
                  <label>Email</label>
                  <input type="email" value={user?.email || ""} disabled />
                </div>
              </div>

              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label>Company</label>
                  <input
                    type="text"
                    placeholder="Your brokerage or firm"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>
                <div className="onboarding-field">
                  <label>Phone</label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label>Job Title</label>
                  <input
                    type="text"
                    placeholder="e.g. Real Estate Agent"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                </div>
                <div className="onboarding-field">
                  <label>License Number</label>
                  <input
                    type="text"
                    placeholder="e.g. DRE-01234567"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                  />
                </div>
              </div>

              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label>Location</label>
                  <input
                    type="text"
                    placeholder="City, State"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
                <div className="onboarding-field">
                  <label>Years in Business</label>
                  <input
                    type="number"
                    placeholder="e.g. 5"
                    min="0"
                    max="99"
                    value={yearsInBusiness}
                    onChange={(e) => setYearsInBusiness(e.target.value)}
                  />
                </div>
              </div>

              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label>Specialization</label>
                  <select value={specialization} onChange={(e) => setSpecialization(e.target.value)}>
                    <option value="">Select...</option>
                    <option value="Residential">Residential</option>
                    <option value="Commercial">Commercial</option>
                    <option value="Land & Development">Land &amp; Development</option>
                    <option value="Property Management">Property Management</option>
                    <option value="Mortgage & Lending">Mortgage &amp; Lending</option>
                    <option value="Title & Escrow">Title &amp; Escrow</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="onboarding-field">
                  <label>Team Size</label>
                  <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
                    <option value="">Select...</option>
                    <option value="Solo">Solo</option>
                    <option value="2-5">2–5 people</option>
                    <option value="6-20">6–20 people</option>
                    <option value="20+">20+ people</option>
                  </select>
                </div>
              </div>

              {error && <p className="onboarding-error">{error}</p>}

              <div className="onboarding-actions">
                <button type="button" className="onboarding-back" onClick={() => setStep(1)}>
                  ← Back
                </button>
                <button type="submit" className="onboarding-submit onboarding-submit--inline" disabled={loading}>
                  {loading ? "Saving..." : "Continue →"}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ─── Step 3: Connect ─── */}
        {step === 3 && (
          <>
            <div className="onboarding-header">
              <span className="onboarding-step">Last step</span>
              <h1 className="onboarding-title">Connect your inbox</h1>
              <p className="onboarding-subtitle">
                Sequences send through your own Gmail, so replies land in your inbox. Connect now to
                start sending — or do it later from Settings.
              </p>
            </div>

            <div className="onboarding-connect">
              <button
                className={`onboarding-connect__btn ${gmailConnected ? "is-connected" : ""}`}
                onClick={connectGmail}
                disabled={connecting || gmailConnected}
              >
                <span className="onboarding-connect__icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" width="26" height="26">
                    <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z" />
                    <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z" />
                    <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
                    <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z" />
                    <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0C43.076,8,45,9.924,45,12.298z" />
                  </svg>
                </span>
                <span className="onboarding-connect__text">
                  <strong>{gmailConnected ? "Gmail connected" : "Connect Gmail"}</strong>
                  <span>{connecting ? "Waiting for authorization…" : gmailConnected ? "You’re ready to send." : "Sign in with Google"}</span>
                </span>
                <span className="onboarding-connect__check">{gmailConnected ? "✓" : "→"}</span>
              </button>

              <p className="onboarding-connect__note">
                WhatsApp is coming soon &mdash; we&rsquo;ll let you connect it from <strong>Settings → Integrations</strong> once it&rsquo;s ready.
              </p>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="onboarding-back" onClick={() => setStep(2)}>
                ← Back
              </button>
              <button className="onboarding-submit onboarding-submit--inline" onClick={finish}>
                {gmailConnected ? "Go to dashboard →" : "Finish setup →"}
              </button>
            </div>
            {!gmailConnected && (
              <div className="onboarding-skip">
                <button onClick={finish}>I’ll connect later</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
