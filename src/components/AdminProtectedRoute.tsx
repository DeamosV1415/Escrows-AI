import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export default function AdminProtectedRoute({
  children,
}: AdminProtectedRouteProps) {
  const { user, token, loading: authLoading } = useAuth();
  const [adminStatus, setAdminStatus] = useState<
    "loading" | "authorized" | "denied"
  >("loading");

  useEffect(() => {
    if (authLoading || !token) return;

    const verifyAdmin = async () => {
      try {
        const res = await fetch("/api/admin/verify", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setAdminStatus("authorized");
        } else {
          setAdminStatus("denied");
        }
      } catch {
        setAdminStatus("denied");
      }
    };

    verifyAdmin();
  }, [token, authLoading]);

  // Still checking auth
  if (authLoading) {
    return (
      <div style={loadingStyle}>
        <div style={spinnerStyle} />
        <span>Loading…</span>
      </div>
    );
  }

  // Not logged in — redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Verifying admin status
  if (adminStatus === "loading") {
    return (
      <div style={loadingStyle}>
        <div style={spinnerStyle} />
        <span>Verifying admin access…</span>
      </div>
    );
  }

  // Access denied
  if (adminStatus === "denied") {
    return (
      <div style={deniedStyle}>
        <svg
          width="56"
          height="56"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.5, marginBottom: 16 }}
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <h1 style={deniedTitleStyle}>Access Denied</h1>
        <p style={deniedDescStyle}>
          You don't have admin privileges.
          <br />
          Contact your administrator if you believe this is an error.
        </p>
        <a href="/dashboard" style={backLinkStyle}>
          ← Back to Dashboard
        </a>
      </div>
    );
  }

  return <>{children}</>;
}

/* ─── Inline styles (standalone page, no dashboard layout) ─── */

const loadingStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "#faf9f6",
  color: "#7a7a7a",
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: "0.9rem",
  gap: 16,
};

const spinnerStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "3px solid rgba(0,0,0,0.06)",
  borderTopColor: "#6b8035",
  borderRadius: "50%",
  animation: "admin-spin 0.8s linear infinite",
};

const deniedStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "#faf9f6",
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: "#7a7a7a",
  textAlign: "center",
  padding: 24,
};

const deniedTitleStyle: React.CSSProperties = {
  fontFamily: '"Cormorant Garamond", Georgia, serif',
  fontSize: "2rem",
  fontWeight: 500,
  color: "#1a1a1a",
  margin: "0 0 8px",
};

const deniedDescStyle: React.CSSProperties = {
  fontSize: "0.92rem",
  lineHeight: 1.6,
  margin: "0 0 24px",
  maxWidth: 400,
};

const backLinkStyle: React.CSSProperties = {
  fontSize: "0.88rem",
  fontWeight: 500,
  color: "#4a5d23",
  textDecoration: "none",
  padding: "10px 24px",
  borderRadius: 8,
  border: "1px solid #a8b87e",
  transition: "all 0.2s ease",
};
