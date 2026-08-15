import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import "./LegalPage.css";

const CookiePolicyPage: React.FC = () => {
  return (
    <main className="legal-page">
      <Helmet>
        <title>Cookie Policy — Tachikiba</title>
        <meta
          name="description"
          content="Find out how Tachikiba uses cookies and similar technologies on its platform. Learn what cookies we use and how to manage your preferences."
        />
        <link rel="canonical" href="https://escrowsai.com/cookie-policy" />
        <meta property="og:title" content="Cookie Policy — Tachikiba" />
        <meta property="og:url" content="https://escrowsai.com/cookie-policy" />
      </Helmet>

      {/* ─── Hero Banner ─── */}
      <section className="legal-hero">
        <div className="legal-hero__overlay" />
        <div className="legal-hero__content">
          <span className="legal-hero__eyebrow">Legal</span>
          <h1 className="legal-hero__title">Cookie Policy</h1>
        </div>
        <div className="legal-hero__breadcrumb">
          <Link to="/">Home</Link>
          <span className="legal-hero__breadcrumb-sep">/</span>
          <span>Cookie Policy</span>
        </div>
        <span className="legal-hero__vertical-text">Cookies</span>
      </section>

      {/* ─── Body ─── */}
      <section className="legal-body section">
        <div className="container legal-body__inner">

          {/* Meta */}
          <div className="legal-meta">
            <div className="legal-meta__item">
              <span className="legal-meta__label">Effective Date</span>
              <span className="legal-meta__value">March 16, 2026</span>
            </div>
            <div className="legal-meta__divider" />
            <div className="legal-meta__item">
              <span className="legal-meta__label">Last Updated</span>
              <span className="legal-meta__value">March 16, 2026</span>
            </div>
          </div>

          {/* Intro */}
          <p className="legal-intro">
            This Cookie Policy explains how Tachikiba uses cookies and similar technologies when you visit our website or use our platform.
          </p>

          {/* Section 1 */}
          <div className="legal-section">
            <p className="legal-section__number">01</p>
            <h2 className="legal-section__heading">What Are Cookies?</h2>
            <p>Cookies are small text files stored on your device when you visit a website. They help websites remember user preferences and improve functionality.</p>
          </div>

          {/* Section 2 */}
          <div className="legal-section">
            <p className="legal-section__number">02</p>
            <h2 className="legal-section__heading">How We Use Cookies</h2>
            <p>We use cookies to:</p>
            <ul className="legal-list">
              <li>Ensure website functionality</li>
              <li>Understand website usage</li>
              <li>Improve performance</li>
              <li>Maintain user sessions</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div className="legal-section">
            <p className="legal-section__number">03</p>
            <h2 className="legal-section__heading">Types of Cookies We Use</h2>
            <p><strong>Essential Cookies</strong></p>
            <p>Required for the website to function properly.</p>
            <p style={{ marginTop: "16px" }}><strong>Analytics Cookies</strong></p>
            <p>Help us understand how users interact with our website.</p>
            <p style={{ marginTop: "16px" }}><strong>Functional Cookies</strong></p>
            <p>Remember user preferences.</p>
          </div>

          {/* Section 4 */}
          <div className="legal-section">
            <p className="legal-section__number">04</p>
            <h2 className="legal-section__heading">Managing Cookies</h2>
            <p>Most browsers allow you to:</p>
            <ul className="legal-list">
              <li>Delete cookies</li>
              <li>Block cookies</li>
              <li>Control cookie settings</li>
            </ul>
            <p>Disabling cookies may affect website functionality.</p>
          </div>

          {/* Section 5 */}
          <div className="legal-section">
            <p className="legal-section__number">05</p>
            <h2 className="legal-section__heading">Changes to This Policy</h2>
            <p>We may update this Cookie Policy occasionally. Updates will be posted on this page with a revised effective date.</p>
          </div>

          {/* Contact block */}
          <div className="legal-contact">
            <h3 className="legal-contact__heading">Questions about cookies?</h3>
            <p>
              If you have any questions about our use of cookies or this Cookie Policy, feel free to reach out to us.
            </p>
            <a href="mailto:contact@escrowsai.com" className="legal-contact__link">
              contact@escrowsai.com →
            </a>
          </div>
        </div>
      </section>
    </main>
  );
};

export default CookiePolicyPage;
