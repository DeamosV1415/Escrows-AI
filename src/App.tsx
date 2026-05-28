import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { AuthProvider } from "./components/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import IntroVideo from "./components/IntroVideo";
import Features from "./components/Features";
import Benefits from "./components/Benefits";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import ThreeBackground from "./components/ThreeBackground";
import DashboardLayout from "./components/dashboard/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ClientsPage from "./pages/ClientsPage";
import InventoryPage from "./pages/InventoryPage";
import SequencesPage from "./pages/SequencesPage";
import CopilotPage from "./pages/CopilotPage";
import InboxPage from "./pages/InboxPage";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "./pages/LoginPage";
import OnboardingPage from "./pages/OnboardingPage";
import ContactPage from "./components/ContactPage";
import AboutPage from "./components/AboutPage";
import PrivacyPolicyPage from "./components/PrivacyPolicyPage";
import TermsOfServicePage from "./components/TermsOfServicePage";
import CookiePolicyPage from "./components/CookiePolicyPage";
import AdminProtectedRoute from "./components/AdminProtectedRoute";
import AdminPage from "./pages/AdminPage";

/* ─── Landing Page (public-facing site with shared layout) ─── */
function LandingPage() {
  const location = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
  }, [location.pathname]);

  return (
    <>
      <Helmet>
        <title>Escrows AI — Never Miss a Follow-Up Again</title>
        <meta
          name="description"
          content="AI-powered CRM and follow-up engine for CRE brokers. Manage deals, automate outreach, and close faster with Escrows AI."
        />
        <link rel="canonical" href="https://escrowsai.com/" />
        <meta property="og:title" content="Escrows AI — Never Miss a Follow-Up Again" />
        <meta property="og:description" content="AI-powered CRM and follow-up engine for CRE brokers. Close more deals with intelligent automation." />
        <meta property="og:url" content="https://escrowsai.com/" />
        <meta name="twitter:title" content="Escrows AI — Never Miss a Follow-Up Again" />
        <meta name="twitter:description" content="AI-powered CRM and follow-up engine for CRE brokers. Close more deals with intelligent automation." />
      </Helmet>
      <ThreeBackground />
      <Navbar />
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <Hero />
              <IntroVideo />
              <Features />
              <Benefits />
              <CTA />
            </main>
          }
        />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/terms-of-service" element={<TermsOfServicePage />} />
        <Route path="/cookie-policy" element={<CookiePolicyPage />} />
      </Routes>
      <Footer />
    </>
  );
}

/* ─── App ─── */
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Login / Signup */}
          <Route path="/login" element={<LoginPage />} />

          {/* Onboarding profile form */}
          <Route path="/onboarding" element={<OnboardingPage />} />

          {/* Admin Panel (standalone, email-gated) */}
          <Route
            path="/admin"
            element={
              <AdminProtectedRoute>
                <AdminPage />
              </AdminProtectedRoute>
            }
          />

          {/* Dashboard (protected) */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="sequences" element={<SequencesPage />} />
            <Route path="copilot" element={<CopilotPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* Landing / public pages (catch-all) */}
          <Route path="/*" element={<LandingPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
