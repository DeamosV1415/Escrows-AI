import { useState, useEffect, useCallback } from "react";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import IntroVideo from "./components/IntroVideo";
import Features from "./components/Features";
import Benefits from "./components/Benefits";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import WaitlistModal from "./components/WaitlistModal";
import ThreeBackground from "./components/ThreeBackground";

function App() {
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

export default App;
