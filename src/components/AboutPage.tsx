import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import "./AboutPage.css";

/* ─── Team Data ─── */
interface TeamMember {
  name: string;
  role: string;
  initials: string;
  linkedIn?: string;
  twitter?: string;
}

const team: TeamMember[] = [
  {
    name: "Chinmay Bhadoria",
    role: "Chief Executive Officer",
    initials: "CB",
    linkedIn:
      "https://www.linkedin.com/in/chinmay-pratap-singh-bhadoria-6a8756221/",
    twitter: "https://x.com/deamosV",
  },
  {
    name: "Aarv Singh Chauhan",
    role: "Chief Technology Officer",
    initials: "AC",
    linkedIn: "www.linkedin.com/in/aarv-singh-chauhan-4a7987291",
    twitter: "https://x.com/Aarv_Chauhan_",
  },
  {
    name: "Ayush Bhatt",
    role: "Chief Operating Officer",
    initials: "AB",
    linkedIn: "https://www.linkedin.com/in/ayush-bhatt-60310422a/",
    twitter: "https://x.com/Ayush_R1CSE",
  },
];

/* ─── Component ─── */
const AboutPage: React.FC = () => {
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

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

    const elements = document.querySelectorAll(
      ".about-fade-in, .about-slide-left, .about-slide-right, .about-scale-in",
    );
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  const setRef = (index: number) => (el: HTMLElement | null) => {
    sectionRefs.current[index] = el;
  };

  return (
    <main className="about-page">
      {/* ══════════ 1 · Hero Banner ══════════ */}
      <section className="about-hero">
        <div className="about-hero__overlay" />
        <div className="about-hero__content">
          <h1 className="about-hero__title">About Us</h1>
        </div>
        <div className="about-hero__breadcrumb">
          <Link to="/">Home</Link>
          <span className="about-hero__breadcrumb-sep">/</span>
          <span>About</span>
        </div>
        <span className="about-hero__vertical-text">About</span>
      </section>

      {/* ══════════ 2 · Origin Story ══════════ */}
      <section className="about-story section" ref={setRef(0)}>
        <div className="container about-story__grid">
          <div className="about-story__text about-slide-left">
            <span className="about-story__label">/ our story /</span>
            <h2 className="about-story__heading">
              Born from a simple observation. Built for a real problem.
            </h2>
            <p className="about-story__paragraph">
              Real estate deals move fast — but the tools agents rely on often
              don’t. Across brokerages, important tasks still happen in
              spreadsheets, scattered messages, and manual follow-ups. Deals get
              delayed, opportunities slip through, and teams spend more time
              managing processes than closing transactions.
            </p>
            <p className="about-story__paragraph">
              Escrows AI was created to change that.
            </p>
            <p className="about-story__paragraph">
              Instead of another traditional CRM, we’re building an intelligent
              operating system for brokerages — an intelligent partner that
              thinks ahead, automates the tedious, and lets agents focus on what
              they do best: building relationships and closing deals.
            </p>
          </div>

          <div className="about-story__quote-card about-slide-right">
            <div className="about-story__quote-icon">"</div>
            <blockquote className="about-story__blockquote">
              We didn't want to build software that people have to learn. We
              wanted to build software that learns people.
            </blockquote>
            <cite className="about-story__cite">— Chinmay Bhadoria, CEO</cite>
          </div>
        </div>
      </section>

      {/* ══════════ 3 · Mission · Vision · Values ══════════ */}
      <section className="about-mvv section" ref={setRef(1)}>
        <div className="container">
          <h2 className="section-title about-fade-in">What Drives Us</h2>
          <p className="section-subtitle about-fade-in">
            Three pillars that guide everything we build and every decision we
            make.
          </p>

          <div className="about-mvv__cards">
            {/* Mission */}
            <div className="about-mvv__card about-scale-in">
              <div className="about-mvv__icon">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <h3 className="about-mvv__title">Our Mission</h3>
              <p className="about-mvv__desc">
                Empower real estate professionals with AI-driven automation so
                they never miss a follow-up, lose a lead, or waste an hour on
                busywork again.
              </p>
            </div>

            {/* Vision */}
            <div className="about-mvv__card about-scale-in">
              <div className="about-mvv__icon">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <h3 className="about-mvv__title">Our Vision</h3>
              <p className="about-mvv__desc">
                A world where every agent has the intelligence of a whole team
                behind them — where AI handles the 80&thinsp;% so humans can
                focus on the 20&thinsp;% that truly matters.
              </p>
            </div>

            {/* Values */}
            <div className="about-mvv__card about-scale-in">
              <div className="about-mvv__icon">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                </svg>
              </div>
              <h3 className="about-mvv__title">Our Values</h3>
              <p className="about-mvv__desc">
                Relentless empathy for agents. Transparency in every algorithm.
                Speed without shortcuts. And the belief that technology should
                feel invisible.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ 4 · Team Section ══════════ */}
      <section className="about-team section" ref={setRef(2)}>
        <div className="container">
          <h2 className="section-title about-fade-in">Meet the Team</h2>
          <p className="section-subtitle about-fade-in">
            A small, focused team that moves fast and cares deeply about the
            people we serve.
          </p>

          <div className="about-team__cards">
            {team.map((member, i) => (
              <div
                key={member.name}
                className="about-team__card about-scale-in"
                style={{ transitionDelay: `${i * 0.12}s` }}
              >
                <div className="about-team__avatar">
                  <span className="about-team__initials">
                    {member.initials}
                  </span>
                </div>
                <h3 className="about-team__name">{member.name}</h3>
                <span className="about-team__role">{member.role}</span>
                <div className="about-team__socials">
                  {member.linkedIn && (
                    <a
                      href={member.linkedIn}
                      aria-label={`${member.name} LinkedIn`}
                      className="about-team__social-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                    </a>
                  )}
                  {member.twitter && (
                    <a
                      href={member.twitter}
                      aria-label={`${member.name} Twitter`}
                      className="about-team__social-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ 5 · Stats Bar ══════════ */}
      <section className="about-stats section" ref={setRef(3)}>
        <div className="container about-stats__grid about-fade-in">
          <div className="about-stats__item">
            <span className="about-stats__number">3</span>
            <span className="about-stats__label">Founders</span>
          </div>
          <div className="about-stats__divider" />
          <div className="about-stats__item">
            <span className="about-stats__number">1</span>
            <span className="about-stats__label">Mission</span>
          </div>
          <div className="about-stats__divider" />
          <div className="about-stats__item">
            <span className="about-stats__number">∞</span>
            <span className="about-stats__label">Potential</span>
          </div>
        </div>
      </section>

      {/* ══════════ 6 · CTA ══════════ */}
      <section className="about-cta section" ref={setRef(4)}>
        <div className="container about-cta__inner about-fade-in">
          <h2 className="about-cta__heading">
            Ready to transform your workflow?
          </h2>
          <p className="about-cta__desc">
            Join the growing number of agents who are closing more deals with
            less effort.
          </p>
          <Link
            to="/contact"
            className="btn btn-primary btn-large about-cta__btn"
          >
            Get in Touch
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
        </div>
      </section>
    </main>
  );
};

export default AboutPage;
