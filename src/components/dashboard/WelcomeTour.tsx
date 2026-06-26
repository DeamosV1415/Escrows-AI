import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import LogoImg from "../../assets/Logo.png";
import { startProductTour } from "./productTour";
import "./WelcomeTour.css";

/**
 * Post-onboarding welcome experience. A FULL-SCREEN takeover (nothing else visible):
 *   processing → tour-prompt → (reveal dashboard).
 * Triggered once by `?welcome=1` (set when onboarding finishes). If the user chooses
 * "Maybe later", a small collapsible card lives on the dashboard until dismissed for good.
 *
 * Persistence (localStorage, single state machine):
 *   absent  → not yet prompted
 *   minimized → skipped from the prompt; the dashboard card is showing
 *   done    → tour taken (or finished)  ┐ both terminal — nothing ever shows again
 *   dismissed → card dismissed for good  ┘
 */

const KEY = "escrowsai.tour.v1";
type Stored = "minimized" | "done" | "dismissed";
const getStored = () => (localStorage.getItem(KEY) as Stored | null);
const setStored = (v: Stored) => localStorage.setItem(KEY, v);

type Phase = "processing" | "prompt" | "closing" | "minimized" | "hidden";

const PROCESSING_MS = 4500;

// Reassurance lines that cycle while the monogram breathes — they tell a small story
// and build a little anticipation before the reveal.
const PREP_LINES = [
  "Preparing your workspace",
  "Organizing your clients & pipeline",
  "Tuning your follow-up sequences",
  "Waking up your AI copilot",
  "Almost ready…",
];

export default function WelcomeTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>("hidden");
  const [collapsed, setCollapsed] = useState(false);
  const [lineIdx, setLineIdx] = useState(0);

  // Decide the initial phase once, from the URL trigger + stored state.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const triggered = params.get("welcome") === "1";
    const stored = getStored();

    if (triggered) {
      // Consume the trigger so a refresh doesn't replay the takeover.
      params.delete("welcome");
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
      if (stored !== "done" && stored !== "dismissed") {
        setPhase("processing");
        return;
      }
    }
    if (stored === "minimized") setPhase("minimized");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Processing → prompt after a beat.
  useEffect(() => {
    if (phase !== "processing") return;
    const t = setTimeout(() => setPhase("prompt"), PROCESSING_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Advance the reassurance lines while processing (stops on the last one).
  useEffect(() => {
    if (phase !== "processing") return;
    setLineIdx(0);
    const id = setInterval(
      () => setLineIdx((i) => Math.min(i + 1, PREP_LINES.length - 1)),
      PROCESSING_MS / PREP_LINES.length,
    );
    return () => clearInterval(id);
  }, [phase]);

  // Fade the full-screen takeover out, then land on the given resting phase.
  const closeOverlayTo = useCallback((rest: "minimized" | "hidden") => {
    setPhase("closing");
    setTimeout(() => setPhase(rest), 460);
  }, []);

  const runTour = useCallback(() => {
    startProductTour({
      onDone: () => {
        setStored("done");
        setPhase("hidden");
      },
    });
  }, []);

  const takeTour = useCallback(() => {
    // Reveal the dashboard first so the tour can spotlight the real sidebar, then drive.
    setPhase("closing");
    setTimeout(() => {
      setPhase("hidden");
      runTour();
    }, 460);
  }, [runTour]);

  const maybeLater = useCallback(() => {
    setStored("minimized");
    closeOverlayTo("minimized");
  }, [closeOverlayTo]);

  const dismissCard = useCallback(() => {
    setStored("dismissed");
    setPhase("hidden");
  }, []);

  if (phase === "hidden") return null;

  // ── Resting dashboard card (skipped state) ──
  if (phase === "minimized") {
    return (
      <div className={`wtour-card ${collapsed ? "is-collapsed" : ""}`}>
        <button
          className="wtour-card__head"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className="wtour-card__spark" aria-hidden>
            <SparkIcon />
          </span>
          <span className="wtour-card__head-text">
            <strong>Take the guided tour</strong>
            <span>A quick walkthrough of your workspace</span>
          </span>
          <span className={`wtour-card__chevron ${collapsed ? "is-collapsed" : ""}`} aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
        <div className="wtour-card__body">
          <div className="wtour-card__actions">
            <button className="wtour-btn wtour-btn--ghost" onClick={dismissCard}>
              Dismiss
            </button>
            <button className="wtour-btn wtour-btn--primary" onClick={runTour}>
              Start tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Full-screen takeover: processing → prompt ──
  const closing = phase === "closing";
  return (
    <div className={`wtour-screen ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true">
      <div className="wtour-screen__bg" aria-hidden />

      {phase === "processing" && (
        <div className="wtour-stage wtour-stage--processing">
          <div className="wtour-orb">
            <span className="wtour-orb__ring" aria-hidden />
            <span className="wtour-orb__ring wtour-orb__ring--2" aria-hidden />
            <span className="wtour-orb__halo" aria-hidden />
            <span className="wtour-orb__core" aria-hidden>
              <img src={LogoImg} alt="Escrows AI" />
            </span>
            {/* drifting gold dust */}
            <span className="wtour-orb__dust" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => (
                <i key={i} style={{ "--i": i } as CSSProperties} />
              ))}
            </span>
          </div>

          <h2 className="wtour-processing__title">Setting things up for you</h2>

          <p className="wtour-processing__sub" key={lineIdx}>
            {PREP_LINES[lineIdx]}
          </p>

          <div className="wtour-processing__track" aria-hidden>
            <span style={{ animationDuration: `${PROCESSING_MS}ms` }} />
          </div>
        </div>
      )}

      {phase === "prompt" && (
        <div className="wtour-stage wtour-stage--prompt">
          <div className="wtour-prompt">
            <span className="wtour-prompt__spark" aria-hidden>
              <SparkIcon size={24} />
            </span>
            <span className="wtour-prompt__eyebrow">Welcome to Escrows AI</span>
            <h1 className="wtour-prompt__title">You&rsquo;re all set</h1>
            <p className="wtour-prompt__desc">
              Your workspace is ready. Take a short guided tour to see where everything
              lives &mdash; and how <em>Sequences</em> put your follow-ups on autopilot.
            </p>
            <div className="wtour-prompt__actions">
              <button className="wtour-btn wtour-btn--primary wtour-btn--lg" onClick={takeTour}>
                Take the tour
              </button>
              <button className="wtour-btn wtour-btn--ghost wtour-btn--lg" onClick={maybeLater}>
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SparkIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15l.7 1.8L21.5 17.5 19.7 18.2 19 20l-.7-1.8L16.5 17.5l1.8-.7L19 15z" />
  </svg>
);
