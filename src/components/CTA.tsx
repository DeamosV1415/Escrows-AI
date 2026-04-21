import { Link } from "react-router-dom";
import "./CTA.css";

const CTA: React.FC = () => {
  return (
    <section className="cta section" id="cta">
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
            Start managing your clients smarter — with AI-powered follow-ups,
            seamless document management, and insights that close deals faster.
          </p>

          <div className="cta__features">
            <div className="cta__feature">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>Free to get started</span>
            </div>
            <div className="cta__feature">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>Setup in under 5 minutes</span>
            </div>
            <div className="cta__feature">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>No credit card required</span>
            </div>
          </div>

          <div className="cta__actions">
            <Link to="/login?mode=signup" className="btn btn-light btn-large cta__primary-btn">
              Get Started Free
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link to="/contact" className="cta__secondary-link">
              Have questions? Contact us →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTA;
