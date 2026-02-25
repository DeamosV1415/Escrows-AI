import "./Benefits.css";

const benefits = [
  {
    number: "01",
    title: "Automate Your Outreach",
    description:
      "Let AI handle repetitive follow-ups while you focus on closing. Our intelligent engine knows exactly when and how to reach out.",
    highlight: "Save 10+ hours weekly",
  },
  {
    number: "02",
    title: "Prioritize Smart",
    description:
      "AI-driven lead scoring surfaces your hottest opportunities first. Stop guessing and start closing the deals that matter most.",
    highlight: "3.5× more conversions",
  },
  {
    number: "03",
    title: "Scale With Confidence",
    description:
      "Bank-grade security keeps your data safe while seamless integrations let your team grow without friction or complexity.",
    highlight: "Enterprise-ready from day one",
  },
];

const Benefits: React.FC = () => {
  return (
    <section className="benefits section" id="benefits">
      <div className="container">
        <h2 className="section-title fade-in-up">
          Close More Deals,{" "}
          <span style={{ color: "var(--olive-600)", fontStyle: "italic" }}>
            Faster
          </span>
        </h2>
        <p className="section-subtitle fade-in-up">
          Built for closers who refuse to leave money on the table.
        </p>

        <div className="benefits__list">
          {benefits.map((benefit, index) => (
            <div
              key={index}
              className="benefits__item fade-in-up"
              style={{ transitionDelay: `${index * 0.15}s` }}
            >
              <div className="benefits__number">{benefit.number}</div>
              <div className="benefits__content">
                <h3 className="benefits__title">{benefit.title}</h3>
                <p className="benefits__desc">{benefit.description}</p>
                <span className="benefits__highlight">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {benefit.highlight}
                </span>
              </div>
              <div className="benefits__line"></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Benefits;
