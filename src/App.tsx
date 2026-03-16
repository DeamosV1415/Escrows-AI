import { useState, useEffect, useCallback } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import IntroVideo from "./components/IntroVideo";
import Features from "./components/Features";
import Benefits from "./components/Benefits";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import WaitlistModal from "./components/WaitlistModal";
import ThreeBackground from "./components/ThreeBackground";
import ContactPage from "./components/ContactPage";
import AboutPage from "./components/AboutPage";
import PrivacyPolicyPage from "./components/PrivacyPolicyPage";
import TermsOfServicePage from "./components/TermsOfServicePage";
import CookiePolicyPage from "./components/CookiePolicyPage";

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const location = useLocation();

  const openWaitlist = useCallback(() => setIsModalOpen(true), []);
  const closeWaitlist = useCallback(() => setIsModalOpen(false), []);

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
      <ThreeBackground />
      <Navbar onJoinWaitlist={openWaitlist} />
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <Hero onJoinWaitlist={openWaitlist} />
              <IntroVideo />
              <Features />
              <Benefits />
              <CTA onJoinWaitlist={openWaitlist} />
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
      <WaitlistModal isOpen={isModalOpen} onClose={closeWaitlist} />
    </>
  );
}

export default App;
