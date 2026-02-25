import { useState } from "react";
import "./WaitlistModal.css";

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WaitlistModal: React.FC<WaitlistModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to submit. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Reset after transition
    setTimeout(() => {
      setSubmitted(false);
      setLoading(false);
      setError("");
      setName("");
      setEmail("");
      setCompany("");
    }, 300);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="modal__close"
          onClick={handleClose}
          aria-label="Close"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {!submitted ? (
          <>
            <div className="modal__header">
              <div className="modal__icon">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--olive-700)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h3 className="modal__title">Join the Waitlist</h3>
              <p className="modal__subtitle">
                Get early access to Escrows AI and exclusive perks reserved for
                founding members.
              </p>
            </div>

            <form className="modal__form" onSubmit={handleSubmit}>
              <div className="modal__field">
                <label htmlFor="waitlist-name">Full Name</label>
                <input
                  id="waitlist-name"
                  type="text"
                  placeholder="John Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="modal__field">
                <label htmlFor="waitlist-email">Email Address</label>
                <input
                  id="waitlist-email"
                  type="email"
                  placeholder="john@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="modal__field">
                <label htmlFor="waitlist-company">
                  Company <span className="modal__optional">(optional)</span>
                </label>
                <input
                  id="waitlist-company"
                  type="text"
                  placeholder="Acme Corp"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>

              {error && <p className="modal__error">{error}</p>}

              <button
                type="submit"
                className="btn btn-primary btn-large modal__submit"
                disabled={loading}
              >
                {loading ? "Submitting..." : "Secure My Spot"}
              </button>

              <p className="modal__privacy">
                We respect your privacy. Unsubscribe at any time.
              </p>
            </form>
          </>
        ) : (
          <div className="modal__success">
            <div className="modal__success-icon">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--olive-600)"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="9 12 12 15 16 9" />
              </svg>
            </div>
            <h3 className="modal__title">Thank you, {name}!</h3>
            <p className="modal__subtitle">
              You're on the waitlist! We've sent a confirmation to{" "}
              <strong>{email}</strong>. We'll reach out with early access
              details soon.
            </p>
            <button className="btn btn-secondary" onClick={handleClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default WaitlistModal;
