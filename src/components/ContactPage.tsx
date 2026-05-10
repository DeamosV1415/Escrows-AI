import { useState, useRef, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import emailjs from "@emailjs/browser";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import "./ContactPage.css";

const ContactPage: React.FC = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formRef.current) return;

    setSending(true);
    setError("");

    if (!captchaToken) {
      setError("Please complete the CAPTCHA verification.");
      setSending(false);
      return;
    }

    try {
      await emailjs.sendForm(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        formRef.current,
        import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
      );
      setSent(true);
      formRef.current.reset();
    } catch {
      setError("Something went wrong. Please try again later.");
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="contact-page">
      <Helmet>
        <title>Contact Us — Escrows AI</title>
        <meta
          name="description"
          content="Get in touch with the Escrows AI team. We're here to help you streamline your real estate workflow with AI-powered automation."
        />
        <link rel="canonical" href="https://escrowsai.com/contact" />
        <meta property="og:title" content="Contact Us — Escrows AI" />
        <meta property="og:description" content="Reach out to Escrows AI. Let us show you how intelligent automation can transform your brokerage." />
        <meta property="og:url" content="https://escrowsai.com/contact" />
        <meta name="twitter:title" content="Contact Us — Escrows AI" />
        <meta name="twitter:description" content="Reach out to Escrows AI and discover how AI can transform your brokerage workflow." />
      </Helmet>

      {/* ─── Hero Banner ─── */}
      <section className="contact-hero">
        <div className="contact-hero__overlay" />
        <div className="contact-hero__content">
          <h1 className="contact-hero__title">Contacts</h1>
        </div>
        <div className="contact-hero__breadcrumb">
          <Link to="/">Home</Link>
          <span className="contact-hero__breadcrumb-sep">/</span>
          <span>Contacts</span>
        </div>
        <span className="contact-hero__vertical-text">Contacts</span>
      </section>

      {/* ─── Contact Body ─── */}
      <section className="contact-body section">
        <div className="container contact-body__grid">
          {/* Left column — info */}
          <div className="contact-info">
            <span className="contact-info__label">/ get in touch /</span>
            <h2 className="contact-info__heading">
              We are always ready to help you and answer your questions
            </h2>
            <p className="contact-info__desc">
              Escrows AI provides intelligent automation for real estate
              professionals. Reach out and let us show you how we can streamline
              your workflow.
            </p>

            <div className="contact-info__grid">
              <div className="contact-info__block">
                <h4 className="contact-info__block-title">Call Center</h4>
                <p>+91 9109120671</p>
              </div>
              {/* <div className="contact-info__block">
                <h4 className="contact-info__block-title">Our Location</h4>
                <p>USA, San Francisco</p>
                <p>123 Market Street</p>
              </div> */}
              <div className="contact-info__block">
                <h4 className="contact-info__block-title">Email</h4>
                <p>contact@escrowsai.com</p>
              </div>
              <div className="contact-info__block">
                <h4 className="contact-info__block-title">Social Network</h4>
                <div className="contact-info__socials">
                  <a
                    href="https://x.com/escrowsai"
                    aria-label="Twitter"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </a>
                  <a
                    href="https://www.linkedin.com/company/escrows-ai/"
                    aria-label="LinkedIn"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Right column — form */}
          <div className="contact-form-card">
            <h3 className="contact-form-card__title">Get in Touch</h3>
            <p className="contact-form-card__desc">
              Define your goals and identify areas where AI can add value to
              your business.
            </p>

            <form
              ref={formRef}
              onSubmit={handleSubmit}
              className="contact-form"
            >
              <input
                type="text"
                name="from_name"
                placeholder="Full name"
                required
                className="contact-form__input"
              />
              <input
                type="email"
                name="from_email"
                placeholder="Email"
                required
                className="contact-form__input"
              />
              <input
                type="text"
                name="subject"
                placeholder="Subject"
                required
                className="contact-form__input"
              />
              <textarea
                name="message"
                placeholder="Message"
                rows={5}
                required
                className="contact-form__input contact-form__textarea"
              />

              {error && <p className="contact-form__error">{error}</p>}
              {sent && (
                <p className="contact-form__success">
                  Your message has been sent successfully!
                </p>
              )}

              {/* hCaptcha */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                <HCaptcha
                  ref={captchaRef}
                  sitekey={import.meta.env.VITE_HCAPTCHA_SITE_KEY || "10000000-ffff-ffff-ffff-000000000001"}
                  onVerify={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken(null)}
                  onError={() => setCaptchaToken(null)}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary contact-form__submit"
                disabled={sending}
              >
                <span className="contact-form__submit-arrow">›</span>
                {sending ? "Sending…" : "Send a message"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
};

export default ContactPage;
