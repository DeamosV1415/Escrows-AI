import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../components/AuthContext";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import "./LoginPage.css";

/* ─── Google Identity Services types ─── */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            config: {
              theme?: string;
              size?: string;
              width?: string | number;
              text?: string;
              shape?: string;
            },
          ) => void;
        };
      };
    };
  }
}

const API_BASE = "/api/auth";

export default function LoginPage() {
  const location = useLocation();
  const [isSignUp, setIsSignUp] = useState(
    new URLSearchParams(location.search).get("mode") === "signup"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);

  const { login, user } = useAuth();
  const navigate = useNavigate();

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  // Handle Google Sign-In callback
  const handleGoogleCallback = useCallback(
    async (response: { credential: string }) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: response.credential }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Google sign-in failed");
        login(data.token, data.user);
        navigate("/dashboard", { replace: true });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Google sign-in failed");
      } finally {
        setLoading(false);
      }
    },
    [login, navigate],
  );

  // Initialize Google Identity Services
  useEffect(() => {
    // Load the GIS script
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
          callback: handleGoogleCallback,
        });
        const btnContainer = document.getElementById("google-signin-btn");
        if (btnContainer) {
          window.google.accounts.id.renderButton(btnContainer, {
            theme: "outline",
            size: "large",
            width: "360",
            text: "continue_with",
            shape: "rectangular",
          });
        }
      }
    };
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [handleGoogleCallback]);

  // Form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const endpoint = isSignUp ? `${API_BASE}/signup` : `${API_BASE}/login`;
    const body = isSignUp
      ? { name: name.trim(), email, password, captcha_token: captchaToken }
      : { email, password, captcha_token: captchaToken };

    if (!captchaToken) {
      setError("Please complete the CAPTCHA verification.");
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      login(data.token, data.user);
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed. Please try again.",
      );
      // Reset captcha on error
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <img src="/Logo.png" alt="Escrows AI" />
          <span>Escrows AI</span>
        </div>

        {/* Header */}
        <div className="login-header">
          <h1 className="login-title">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="login-subtitle">
            {isSignUp
              ? "Start managing clients with intelligent automation"
              : "Sign in to your Escrows AI dashboard"}
          </p>
        </div>

        {/* Google Sign-In */}
        <div
          id="google-signin-btn"
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        />

        {/* Divider */}
        <div className="login-divider">
          <span>or continue with email</span>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {isSignUp && (
            <div className="login-field">
              <label htmlFor="auth-name">Full Name</label>
              <input
                id="auth-name"
                type="text"
                placeholder="John Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}

          <div className="login-field">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              placeholder="john@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder={isSignUp ? "Min. 6 characters" : "Enter your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
            {isSignUp && (
              <p className="login-password-hint" style={{ fontSize: '12px', color: '#888', margin: '4px 0 0' }}>
                Min. 8 chars: 1 uppercase, 1 lowercase, 1 number, 1 special character
              </p>
            )}
          </div>

          {/* hCaptcha */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 16px' }}>
            <HCaptcha
              ref={captchaRef}
              sitekey={import.meta.env.VITE_HCAPTCHA_SITE_KEY || "10000000-ffff-ffff-ffff-000000000001"}
              onVerify={(token) => setCaptchaToken(token)}
              onExpire={() => setCaptchaToken(null)}
              onError={() => setCaptchaToken(null)}
              theme="dark"
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading
              ? "Please wait…"
              : isSignUp
                ? "Create Account"
                : "Sign In"}
          </button>
        </form>

        {/* Toggle */}
        <p className="login-toggle">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError("");
              captchaRef.current?.resetCaptcha();
              setCaptchaToken(null);
            }}
          >
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </p>

        {/* Back to landing */}
        <Link to="/" className="login-back">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
