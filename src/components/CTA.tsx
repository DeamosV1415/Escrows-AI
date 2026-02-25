import { useState } from "react";
import "./CTA.css";

interface CTAProps {
  onJoinWaitlist: () => void;
}

const CTA: React.FC<CTAProps> = ({ onJoinWaitlist }) => {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Waitlist User", email, company: "" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");

      setSubmitted(true);
      setEmail("");
      setTimeout(() => setSubmitted(false), 4000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit.";
      setError(message);
      setTimeout(() => setError(""), 4000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="cta section" id="contact">
      <div className="container">
        <div className="cta__card fade-in-up">
          <div className="cta__decoration cta__decoration--1"></div>
          <div className="cta__decoration cta__decoration--2"></div>

          <h2 className="cta__title">
            Ready to Transform
            <br />
            Your Business?
          </h2>
          <p className="cta__subtitle">
            Join the waitlist and be among the first to experience the future of
            intelligent client management.
          </p>

          <form className="cta__form" onSubmit={handleSubmit}>
            <div className="cta__input-wrapper">
              <input
                type="email"
                className="cta__input"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
              <button
                type="submit"
                className="btn btn-primary cta__submit"
                disabled={loading}
              >
                {submitted ? "✓ Added!" : loading ? "..." : "Join Waitlist"}
              </button>
            </div>
            {error && <p className="cta__error">{error}</p>}
          </form>

          <p className="cta__note">
            No spam. Early access + exclusive perks for waitlist members.
          </p>

          <button className="cta__alt-btn" onClick={onJoinWaitlist}>
            Or fill out the full form →
          </button>
        </div>
      </div>
    </section>
  );
};

export default CTA;
