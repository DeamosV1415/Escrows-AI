import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthContext";
import { authFetch } from "../utils/authFetch";
import "./OnboardingPage.css";

export default function OnboardingPage() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

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

  // If profile already complete, go to dashboard
  useEffect(() => {
    if (user?.profileComplete) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      updateUser(data.user);
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      updateUser(data.user);
      navigate("/dashboard", { replace: true });
    } catch {
      navigate("/dashboard", { replace: true });
    }
  };

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {/* Header */}
        <div className="onboarding-header">
          <span className="onboarding-step">Final Step</span>
          <h1 className="onboarding-title">Complete Your Profile</h1>
          <p className="onboarding-subtitle">
            Help us tailor Escrows AI to your workflow
          </p>
        </div>

        <form className="onboarding-form" onSubmit={handleSubmit}>
          {/* Pre-filled, read-only fields */}
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

          {/* Editable fields */}
          <div className="onboarding-row">
            <div className="onboarding-field">
              <label>
                Phone <span className="required">*</span>
              </label>
              <input
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="onboarding-field">
              <label>Company</label>
              <input
                type="text"
                placeholder="Your brokerage or firm"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
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
              <select
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
              >
                <option value="">Select...</option>
                <option value="Residential">Residential</option>
                <option value="Commercial">Commercial</option>
                <option value="Land & Development">Land & Development</option>
                <option value="Property Management">Property Management</option>
                <option value="Mortgage & Lending">Mortgage & Lending</option>
                <option value="Title & Escrow">Title & Escrow</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="onboarding-field">
              <label>Team Size</label>
              <select
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
              >
                <option value="">Select...</option>
                <option value="Solo">Solo</option>
                <option value="2-5">2–5 people</option>
                <option value="6-20">6–20 people</option>
                <option value="20+">20+ people</option>
              </select>
            </div>
          </div>

          {error && <p className="onboarding-error">{error}</p>}

          <button type="submit" className="onboarding-submit" disabled={loading}>
            {loading ? "Saving..." : "Continue to Dashboard →"}
          </button>
        </form>

        <div className="onboarding-skip">
          <button onClick={handleSkip} disabled={loading}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
