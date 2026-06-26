import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import "./PricingPage.css";

/* ΓöÇΓöÇΓöÇ Plan Data ΓöÇΓöÇΓöÇ */

const plans = [
  {
    id: "free",
    name: "Free",
    price: 0,
    annualPrice: 0,
    tagline: "Get started — no credit card required",
    popular: false,
    ctaLabel: "Start Free",
    ctaStyle: "outline" as const,
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    features: [
      "CRM & pipeline tracking",
      "Inventory management",
      "100 MB storage",
      "5 AI call summaries/mo",
      "2 active sequences",
      "40 AI copilot credits/mo",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 35,
    annualPrice: 30,
    tagline: "For agents ready to scale faster",
    popular: true,
    ctaLabel: "Get Growth",
    ctaStyle: "primary" as const,
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    features: [
      "Everything in Free",
      "2 GB storage",
      "150 AI call summaries/mo",
      "8 active sequences",
      "250 AI copilot credits/mo",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 70,
    annualPrice: 60,
    tagline: "For teams that close at scale",
    popular: false,
    ctaLabel: "Get Pro",
    ctaStyle: "gold" as const,
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    features: [
      "Everything in Growth",
      "10 GB storage",
      "500 AI call summaries",
      "15 active sequences",
      "700 AI copilot credits/mo",
      "Advanced deal signals",
    ],
  },
];

const faqs = [
  {
    q: "Can I switch plans later?",
    a: "Absolutely. You can upgrade or downgrade your plan at any time from your dashboard settings. Changes take effect immediately.",
  },
  {
    q: "What happens when I hit my AI credits limit?",
    a: "You'll receive a notification when you're running low. On the Free plan, you can upgrade anytime to keep going. Your CRM data and pipeline are always accessible regardless of credits.",
  },
  {
    q: "Is there a contract or commitment?",
    a: "No contracts. All plans are month-to-month (or annual if you choose the discounted rate). Cancel anytime with no penalties.",
  },
  {
    q: "Do I need a credit card for the Free plan?",
    a: "No. The Free plan is completely free — no credit card required. Just sign up and start managing your clients.",
  },
  {
    q: 'What does "team access" mean on the Pro plan?',
    a: "Pro lets you invite 3–5 team members (agents, assistants, or partners) to share the same CRM workspace, clients, and pipeline with role-based permissions.",
  },
];

/* ΓöÇΓöÇΓöÇ Check Icon ΓöÇΓöÇΓöÇ */
const CheckIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ΓöÇΓöÇΓöÇ Arrow Icon ΓöÇΓöÇΓöÇ */
const ArrowIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

/* ΓöÇΓöÇΓöÇ Chevron Icon ΓöÇΓöÇΓöÇ */
const ChevronIcon = () => (
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
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/* ΓöÇΓöÇΓöÇ Component ΓöÇΓöÇΓöÇ */

const PricingPage: React.FC = () => {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const location = useLocation();

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Intersection observer for animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );

    const elements = document.querySelectorAll(".fade-in-up, .scale-in");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <Helmet>
        <title>Pricing — Escrows AI</title>
        <meta
          name="description"
          content="Simple, transparent pricing for CRE brokers. Start free, scale with Growth or Pro plans. AI-powered CRM, call summaries, sequences, and copilot."
        />
        <link rel="canonical" href="https://escrowsai.com/pricing" />
        <meta property="og:title" content="Pricing — Escrows AI" />
        <meta
          property="og:description"
          content="Simple, transparent pricing for CRE brokers. Start free and scale as you grow."
        />
        <meta property="og:url" content="https://escrowsai.com/pricing" />
      </Helmet>

      <section className="pricing-section section" id="pricing">
        <div className="container">
          {/* ΓöÇΓöÇΓöÇ Header ΓöÇΓöÇΓöÇ */}
          <div className="pricing-header fade-in-up">
            <span className="pricing-badge">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Pricing
            </span>
            <h1 className="pricing-title">
              Plans that <em>grow</em> with you
            </h1>
            <p className="pricing-subtitle">
              Start free and upgrade as your business scales. No hidden fees, no
              surprise charges — just the tools you need.
            </p>

            {/* ΓöÇΓöÇΓöÇ Toggle ΓöÇΓöÇΓöÇ */}
            <div className="pricing-toggle">
              <span
                className={`pricing-toggle__label ${!annual ? "pricing-toggle__label--active" : ""}`}
              >
                Monthly
              </span>
              <button
                className={`pricing-toggle__switch ${annual ? "pricing-toggle__switch--annual" : ""}`}
                onClick={() => setAnnual(!annual)}
                aria-label="Toggle annual billing"
                type="button"
              />
              <span
                className={`pricing-toggle__label ${annual ? "pricing-toggle__label--active" : ""}`}
              >
                Annual
              </span>
              {annual && <span className="pricing-toggle__save">Save 16%</span>}
            </div>
          </div>

          {/* ΓöÇΓöÇΓöÇ Cards ΓöÇΓöÇΓöÇ */}
          <div className="pricing-grid">
            {plans.map((plan) => {
              const displayPrice = annual ? plan.annualPrice : plan.price;

              return (
                <div
                  key={plan.id}
                  className={`pricing-card fade-in-up ${plan.popular ? "pricing-card--popular" : ""}`}
                >
                  {plan.popular && (
                    <span className="pricing-popular-badge">Most Popular</span>
                  )}

                  {/* Icon */}
                  <div
                    className={`pricing-card__icon pricing-card__icon--${plan.id}`}
                  >
                    {plan.icon}
                  </div>

                  {/* Plan name */}
                  <p className="pricing-card__plan">{plan.name}</p>

                  {/* Price */}
                  <div className="pricing-card__price">
                    {displayPrice === 0 ? (
                      <span className="pricing-card__price-amount">Free</span>
                    ) : (
                      <>
                        <span className="pricing-card__price-currency">$</span>
                        <span className="pricing-card__price-amount">
                          {displayPrice}
                        </span>
                        <span className="pricing-card__price-period">/mo</span>
                      </>
                    )}
                  </div>
                  <p className="pricing-card__price-note">
                    {plan.price === 0
                      ? "Free forever"
                      : annual
                        ? `Billed annually ($${displayPrice * 12}/yr)`
                        : "Billed monthly"}
                  </p>

                  {/* Divider */}
                  <div className="pricing-card__divider" />

                  {/* Features */}
                  <ul className="pricing-card__features">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="pricing-card__feature">
                        <span className="pricing-card__feature-icon pricing-card__feature-icon--check">
                          <CheckIcon />
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Link
                    to="/login?mode=signup"
                    className={`pricing-card__cta pricing-card__cta--${plan.ctaStyle}`}
                    id={`pricing-cta-${plan.id}`}
                  >
                    {plan.ctaLabel}
                    <ArrowIcon />
                  </Link>

                  {/* Shine effect */}
                  <div className="pricing-card__shine" />
                </div>
              );
            })}
          </div>

          {/* ΓöÇΓöÇΓöÇ Bottom Note ΓöÇΓöÇΓöÇ */}
          <div className="pricing-bottom fade-in-up">
            <p className="pricing-bottom__text">
              Need a custom plan for your brokerage?{" "}
              <Link to="/contact">Let's talk</Link>
            </p>
          </div>

          {/* ΓöÇΓöÇΓöÇ FAQ ΓöÇΓöÇΓöÇ */}
          <div className="pricing-faq fade-in-up">
            <h2 className="pricing-faq__title">Frequently Asked Questions</h2>
            {faqs.map((faq, index) => (
              <div key={index} className="pricing-faq__item">
                <button
                  className={`pricing-faq__question ${openFaq === index ? "pricing-faq__question--open" : ""}`}
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  type="button"
                  aria-expanded={openFaq === index}
                >
                  {faq.q}
                  <ChevronIcon />
                </button>
                <div
                  className={`pricing-faq__answer ${openFaq === index ? "pricing-faq__answer--open" : ""}`}
                >
                  <p>{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
};

export default PricingPage;
