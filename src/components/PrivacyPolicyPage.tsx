import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import "./LegalPage.css";

const PrivacyPolicyPage: React.FC = () => {
  return (
    <main className="legal-page">
      <Helmet>
        <title>Privacy Policy — Escrows AI</title>
        <meta
          name="description"
          content="Learn how Escrows AI collects, uses, and protects your personal data. Our Privacy Policy outlines your rights and how we keep your information secure."
        />
        <link rel="canonical" href="https://escrowsai.com/privacy-policy" />
        <meta property="og:title" content="Privacy Policy — Escrows AI" />
        <meta property="og:url" content="https://escrowsai.com/privacy-policy" />
      </Helmet>

      {/* ─── Hero Banner ─── */}
      <section className="legal-hero">
        <div className="legal-hero__overlay" />
        <div className="legal-hero__content">
          <span className="legal-hero__eyebrow">Legal</span>
          <h1 className="legal-hero__title">Privacy Policy</h1>
        </div>
        <div className="legal-hero__breadcrumb">
          <Link to="/">Home</Link>
          <span className="legal-hero__breadcrumb-sep">/</span>
          <span>Privacy Policy</span>
        </div>
        <span className="legal-hero__vertical-text">Privacy</span>
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
            Escrows AI ("we", "our", or "us") operates the Escrows AI platform and website. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our services.
          </p>

          {/* Section 1 */}
          <div className="legal-section">
            <p className="legal-section__number">01</p>
            <h2 className="legal-section__heading">Information We Collect</h2>
            <p>We may collect the following types of information:</p>
            <p><strong>Personal Information</strong></p>
            <ul className="legal-list">
              <li>Name</li>
              <li>Email address</li>
              <li>Phone number</li>
              <li>Company or brokerage name</li>
              <li>Billing information</li>
            </ul>
            <p style={{ marginTop: "20px" }}><strong>Usage Data</strong></p>
            <p>We automatically collect certain information including:</p>
            <ul className="legal-list">
              <li>IP address</li>
              <li>Browser type</li>
              <li>Device type</li>
              <li>Pages visited</li>
              <li>Time spent on pages</li>
              <li>Referring URLs</li>
            </ul>
            <p style={{ marginTop: "20px" }}><strong>Customer Data</strong></p>
            <p>If you use the Escrows AI platform, you may upload or store information related to your clients, leads, or transactions. This data remains your property.</p>
          </div>

          {/* Section 2 */}
          <div className="legal-section">
            <p className="legal-section__number">02</p>
            <h2 className="legal-section__heading">How We Use Information</h2>
            <p>We use the collected data to:</p>
            <ul className="legal-list">
              <li>Provide and operate the Escrows AI platform</li>
              <li>Improve our services</li>
              <li>Communicate with users</li>
              <li>Provide customer support</li>
              <li>Process payments</li>
              <li>Monitor usage and prevent abuse</li>
              <li>Comply with legal obligations</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div className="legal-section">
            <p className="legal-section__number">03</p>
            <h2 className="legal-section__heading">Data Sharing</h2>
            <p>We do <strong>not sell personal data</strong>.</p>
            <p>We may share information with:</p>
            <ul className="legal-list">
              <li>Cloud infrastructure providers</li>
              <li>Payment processors</li>
              <li>Analytics providers</li>
              <li>Legal authorities when required by law</li>
            </ul>
            <p>All partners are required to protect your data.</p>
          </div>

          {/* Section 4 */}
          <div className="legal-section">
            <p className="legal-section__number">04</p>
            <h2 className="legal-section__heading">Data Security</h2>
            <p>We implement industry-standard security measures including:</p>
            <ul className="legal-list">
              <li>Encryption</li>
              <li>Secure cloud infrastructure</li>
              <li>Access controls</li>
            </ul>
            <p>However, no method of transmission over the internet is completely secure.</p>
          </div>

          {/* Section 5 */}
          <div className="legal-section">
            <p className="legal-section__number">05</p>
            <h2 className="legal-section__heading">Data Retention</h2>
            <p>We retain personal data only as long as necessary to:</p>
            <ul className="legal-list">
              <li>Provide services</li>
              <li>Comply with legal obligations</li>
              <li>Resolve disputes</li>
            </ul>
            <p>Users may request deletion of their data.</p>
          </div>

          {/* Section 6 */}
          <div className="legal-section">
            <p className="legal-section__number">06</p>
            <h2 className="legal-section__heading">Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="legal-list">
              <li>Access your data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion</li>
              <li>Withdraw consent</li>
            </ul>
            <p>Requests can be made by contacting us.</p>
          </div>

          {/* Section 7 */}
          <div className="legal-section">
            <p className="legal-section__number">07</p>
            <h2 className="legal-section__heading">Third-Party Services</h2>
            <p>Escrows AI may use third-party tools including:</p>
            <ul className="legal-list">
              <li>Analytics providers</li>
              <li>Payment gateways</li>
              <li>Cloud hosting providers</li>
            </ul>
            <p>These services have their own privacy policies.</p>
          </div>

          {/* Section 8 */}
          <div className="legal-section">
            <p className="legal-section__number">08</p>
            <h2 className="legal-section__heading">Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. Updates will be posted on this page.</p>
          </div>

          {/* Contact block */}
          <div className="legal-contact">
            <h3 className="legal-contact__heading">Questions about your privacy?</h3>
            <p>
              If you have any questions or concerns about this Privacy Policy or how we handle your data, please reach out to us.
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

export default PrivacyPolicyPage;
