import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
