import { Link } from "react-router-dom";
import "./Footer.css";

const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__inner">
          <div className="footer__brand">
            <a href="#" className="footer__logo">
              <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
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
              <span>Escrows AI</span>
            </a>
            <p className="footer__desc">
              Transform your client relationships with intelligent automation,
              seamless document management, and AI-powered insights.
            </p>
          </div>

          <div className="footer__links-group">
            <h4 className="footer__links-title">Navigation</h4>
            <div className="footer__links">
              <a href="#features">Features</a>
              <a href="#benefits">Benefits</a>
              <Link to="/about">About Us</Link>
              <Link to="/contact">Contact</Link>
            </div>
          </div>

          <div className="footer__links-group">
            <h4 className="footer__links-title">Legal</h4>
            <div className="footer__links">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
              <a href="#">Cookie Policy</a>
            </div>
          </div>
        </div>

        <div className="footer__bottom">
          <p>© {new Date().getFullYear()} Escrows AI. All rights reserved.</p>
          <div className="footer__social">
            <a
              href="#"
              aria-label="Twitter"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://www.linkedin.com/company/escrows-ai/"
              aria-label="LinkedIn"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
