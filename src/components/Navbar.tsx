import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import "./Navbar.css";
import LogoImg from "../assets/Logo.png";

const Navbar: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const isHome = location.pathname === "/";

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Hash links: if not on home page, navigate to home first
  const hashLinks = [
    { label: "Features", hash: "#features" },
    { label: "Benefits", hash: "#benefits" },
  ];

  return (
    <header className={`header ${scrolled ? "header--scrolled" : ""}`}>
      {/* Logo — outside navbar */}
      <Link to="/" className="header__logo">
        <div className="header__logo-icon">
          <img
            src={LogoImg}
            alt="Escrows AI Logo"
            className="header__logo-img"
          />
        </div>
        <span className="header__logo-text">Escrows AI</span>
      </Link>

      {/* Glassmorphed Nav — only the 4 links */}
      <nav className="navbar-pill">
        <div
          className={`navbar-pill__links ${mobileOpen ? "navbar-pill__links--open" : ""}`}
        >
          {hashLinks.map((link) =>
            isHome ? (
              <a
                key={link.label}
                href={link.hash}
                className="navbar-pill__link"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                to={`/${link.hash}`}
                className="navbar-pill__link"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ),
          )}
          <Link
            to="/pricing"
            className={`navbar-pill__link ${location.pathname === "/pricing" ? "navbar-pill__link--active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            Pricing
          </Link>
          <Link
            to="/about"
            className={`navbar-pill__link ${location.pathname === "/about" ? "navbar-pill__link--active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            About
          </Link>
          <Link
            to="/contact"
            className={`navbar-pill__link ${location.pathname === "/contact" ? "navbar-pill__link--active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            Contact
          </Link>
        </div>
      </nav>

      {/* CTA — Sign Up / Get Started */}
      <div className="header__cta-group">
        <Link to="/login" className="btn btn-outline header__cta">Sign In</Link>
        <Link to="/login?mode=signup" className="btn btn-primary header__cta">Get Started</Link>
      </div>

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
          {hashLinks.map((link) =>
            isHome ? (
              <a
                key={link.label}
                href={link.hash}
                className="header__mobile-link"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                to={`/${link.hash}`}
                className="header__mobile-link"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ),
          )}
          <Link
            to="/pricing"
            className="header__mobile-link"
            onClick={() => setMobileOpen(false)}
          >
            Pricing
          </Link>
          <Link
            to="/about"
            className="header__mobile-link"
            onClick={() => setMobileOpen(false)}
          >
            About
          </Link>
          <Link
            to="/contact"
            className="header__mobile-link"
            onClick={() => setMobileOpen(false)}
          >
            Contact
          </Link>
          <Link
            to="/login"
            className="btn btn-outline header__mobile-cta"
            onClick={() => setMobileOpen(false)}
          >
            Sign In
          </Link>
          <Link
            to="/login?mode=signup"
            className="btn btn-primary header__mobile-cta"
            onClick={() => setMobileOpen(false)}
          >
            Get Started
          </Link>
        </div>
      )}
    </header>
  );
};

export default Navbar;
