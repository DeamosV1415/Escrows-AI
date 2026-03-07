import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./components/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import IntroVideo from "./components/IntroVideo";
import Features from "./components/Features";
import Benefits from "./components/Benefits";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import WaitlistModal from "./components/WaitlistModal";
import ThreeBackground from "./components/ThreeBackground";
import DashboardLayout from "./components/dashboard/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ClientsPage from "./pages/ClientsPage";
import InventoryPage from "./pages/InventoryPage";
import SequencesPage from "./pages/SequencesPage";
import InboxPage from "./pages/InboxPage";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "./pages/LoginPage";
import OnboardingPage from "./pages/OnboardingPage";

/* ─── Landing Page ─── */
function LandingPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openWaitlist = useCallback(() => setIsModalOpen(true), []);
  const closeWaitlist = useCallback(() => setIsModalOpen(false), []);

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
      <ThreeBackground />
      <Navbar onJoinWaitlist={openWaitlist} />
      <main>
        <Hero onJoinWaitlist={openWaitlist} />
        <IntroVideo />
        <Features />
        <Benefits />
        <CTA onJoinWaitlist={openWaitlist} />
      </main>
      <Footer />
      <WaitlistModal isOpen={isModalOpen} onClose={closeWaitlist} />
    </>
  );
}

/* ─── App ─── */
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Landing page */}
          <Route path="/" element={<LandingPage />} />

          {/* Login / Signup */}
          <Route path="/login" element={<LoginPage />} />

          {/* Onboarding profile form */}
          <Route path="/onboarding" element={<OnboardingPage />} />

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
            <Route path="inbox" element={<InboxPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
