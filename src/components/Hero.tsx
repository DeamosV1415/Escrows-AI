import "./Hero.css";

interface HeroProps {
  onJoinWaitlist: () => void;
}

const Hero: React.FC<HeroProps> = ({ onJoinWaitlist }) => {
  return (
    <section className="hero" id="hero">
      <div className="container hero__container">
        <div className="hero__badge fade-in-up">
          <span className="hero__badge-dot"></span>
          AI-Powered Follow-Up Engine
        </div>

        <h1 className="hero__title fade-in-up">
          Never Miss a<br />
          <span className="hero__title-accent">Follow-Up</span> Again
        </h1>

        <p className="hero__subtitle fade-in-up">
          Transform your client relationships with intelligent automation,
          seamless document management, and AI-powered insights that close deals
          faster.
        </p>

        <div className="hero__actions fade-in-up">
          <button
            className="btn btn-primary btn-large hero__cta"
            onClick={onJoinWaitlist}
          >
            Join the Waitlist
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
          </button>
          <a href="#features" className="btn btn-secondary btn-large">
            Explore Features
          </a>
        </div>

        <div className="hero__stats fade-in-up">
          <div className="hero__stat">
            <span className="hero__stat-value">3.5×</span>
            <span className="hero__stat-label">More Conversions</span>
          </div>
          <div className="hero__stat-divider"></div>
          <div className="hero__stat">
            <span className="hero__stat-value">10h+</span>
            <span className="hero__stat-label">Saved Per Week</span>
          </div>
          <div className="hero__stat-divider"></div>
          <div className="hero__stat">
            <span className="hero__stat-value">95%</span>
            <span className="hero__stat-label">Customer Satisfaction</span>
          </div>
        </div>

        <div className="hero__trust fade-in-up">
          <div className="hero__trust-item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--olive-600)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Setup in 5 minutes
          </div>
          <div className="hero__trust-item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--olive-600)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Bank-grade Security
          </div>
          <div className="hero__trust-item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--olive-600)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            24/7 Support
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
