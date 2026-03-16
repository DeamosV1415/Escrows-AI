import { Link } from "react-router-dom";
import "./LegalPage.css";

const TermsOfServicePage: React.FC = () => {
  return (
    <main className="legal-page">
      {/* ─── Hero Banner ─── */}
      <section className="legal-hero">
        <div className="legal-hero__overlay" />
        <div className="legal-hero__content">
          <span className="legal-hero__eyebrow">Legal</span>
          <h1 className="legal-hero__title">Terms of Service</h1>
        </div>
        <div className="legal-hero__breadcrumb">
          <Link to="/">Home</Link>
          <span className="legal-hero__breadcrumb-sep">/</span>
          <span>Terms of Service</span>
        </div>
        <span className="legal-hero__vertical-text">Terms</span>
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
            These Terms govern your access to and use of the Escrows AI platform. By using our services, you agree to these Terms.
          </p>

          {/* Section 1 */}
          <div className="legal-section">
            <p className="legal-section__number">01</p>
            <h2 className="legal-section__heading">Use of Service</h2>
            <p>Escrows AI provides software tools to assist brokerages with managing client relationships, deal workflows, and operational tasks.</p>
            <p>You agree to use the service only for lawful purposes.</p>
          </div>

          {/* Section 2 */}
          <div className="legal-section">
            <p className="legal-section__number">02</p>
            <h2 className="legal-section__heading">User Accounts</h2>
            <p>To use certain features, you must create an account. You agree to:</p>
            <ul className="legal-list">
              <li>Provide accurate information</li>
              <li>Maintain account security</li>
              <li>Be responsible for activity under your account</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div className="legal-section">
            <p className="legal-section__number">03</p>
            <h2 className="legal-section__heading">Customer Data</h2>
            <p>Users may upload or manage data related to their business. You retain ownership of your data.</p>
            <p>By using the service, you grant Escrows AI permission to process this data to operate the platform.</p>
          </div>

          {/* Section 4 */}
          <div className="legal-section">
            <p className="legal-section__number">04</p>
            <h2 className="legal-section__heading">Acceptable Use</h2>
            <p>You agree <strong>not to</strong>:</p>
            <ul className="legal-list">
              <li>Use the service for illegal activities</li>
              <li>Attempt to access unauthorized systems</li>
              <li>Reverse engineer the platform</li>
              <li>Distribute harmful software</li>
            </ul>
          </div>

          {/* Section 5 */}
          <div className="legal-section">
            <p className="legal-section__number">05</p>
            <h2 className="legal-section__heading">Payments and Subscriptions</h2>
            <p>If you subscribe to paid plans:</p>
            <ul className="legal-list">
              <li>Fees will be billed according to your chosen plan</li>
              <li>Payments are non-refundable unless required by law</li>
            </ul>
          </div>

          {/* Section 6 */}
          <div className="legal-section">
            <p className="legal-section__number">06</p>
            <h2 className="legal-section__heading">Service Availability</h2>
            <p>We aim to provide reliable services but do not guarantee uninterrupted availability.</p>
            <p>We may modify or discontinue features at any time.</p>
          </div>

          {/* Section 7 */}
          <div className="legal-section">
            <p className="legal-section__number">07</p>
            <h2 className="legal-section__heading">Limitation of Liability</h2>
            <p>Escrows AI is provided <strong>"as is."</strong></p>
            <p>To the maximum extent permitted by law, Escrows AI shall not be liable for:</p>
            <ul className="legal-list">
              <li>Loss of profits</li>
              <li>Data loss</li>
              <li>Business interruption</li>
            </ul>
          </div>

          {/* Section 8 */}
          <div className="legal-section">
            <p className="legal-section__number">08</p>
            <h2 className="legal-section__heading">Termination</h2>
            <p>We may suspend or terminate accounts that violate these Terms.</p>
            <p>Users may stop using the service at any time.</p>
          </div>

          {/* Section 9 */}
          <div className="legal-section">
            <p className="legal-section__number">09</p>
            <h2 className="legal-section__heading">Governing Law</h2>
            <p>These Terms shall be governed by the laws of <strong>India</strong>.</p>
          </div>

          {/* Contact block */}
          <div className="legal-contact">
            <h3 className="legal-contact__heading">Have questions about our Terms?</h3>
            <p>
              If you have any questions about these Terms of Service, please don't hesitate to contact us.
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

export default TermsOfServicePage;
