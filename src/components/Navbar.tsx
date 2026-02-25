import { useState, useEffect } from "react";
import "./Navbar.css";

interface NavbarProps {
  onJoinWaitlist: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ onJoinWaitlist }) => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "Features", href: "#features" },
    { label: "Benefits", href: "#benefits" },
    { label: "About", href: "#about" },
    { label: "Contact", href: "#contact" },
  ];

  return (
    <header className={`header ${scrolled ? "header--scrolled" : ""}`}>
      {/* Logo — outside navbar */}
      <a href="#" className="header__logo">
        <div className="header__logo-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect
              x="2"
              y="2"
              width="24"
              height="24"
              rx="6"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M8 10h12M8 14h8M8 18h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <span className="header__logo-text">Escrows AI</span>
      </a>

      {/* Glassmorphed Nav — only the 4 links */}
      <nav className="navbar-pill">
        <div
          className={`navbar-pill__links ${mobileOpen ? "navbar-pill__links--open" : ""}`}
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="navbar-pill__link"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </div>
      </nav>

      {/* CTA — outside navbar */}
      <button className="btn btn-primary header__cta" onClick={onJoinWaitlist}>
        Join Waitlist
      </button>

      {/* Mobile hamburger */}
      <button
        className={`header__hamburger ${mobileOpen ? "header__hamburger--open" : ""}`}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="header__mobile-drawer">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="header__mobile-link"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <button
            className="btn btn-primary header__mobile-cta"
            onClick={() => {
              onJoinWaitlist();
              setMobileOpen(false);
            }}
          >
            Join Waitlist
          </button>
        </div>
      )}
    </header>
  );
};

export default Navbar;
