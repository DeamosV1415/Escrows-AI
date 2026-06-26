import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCopilotChat } from "./CopilotChatContext";
import AgentChat from "./AgentChat";
import ChatDropdown from "./ChatDropdown";
import "./CopilotBubble.css";

/* The same olive sprig used in the chat, for the launcher + header. */
const Sprig = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21V8" />
    <path d="M12 14c0-3 2-5.5 5-6 0 3-2 5.5-5 6z" />
    <path d="M12 10c0-2.5-1.7-4.6-4.2-5 0 2.5 1.7 4.6 4.2 5z" />
    <path d="M12 17c0-1.8 1.2-3.3 3-3.7 0 1.8-1.2 3.3-3 3.7z" />
  </svg>
);

/**
 * The floating Copilot — remotely accessible on every dashboard page (the layout hides it on
 * the full Copilot page). It hosts the SAME `AgentChat`, sharing one conversation + composer
 * state via CopilotChatContext, so "go to Copilot" continues the thread seamlessly. The chat is
 * mounted lazily on first open and kept mounted afterwards so minimizing never loses context.
 */
export default function CopilotBubble() {
  const navigate = useNavigate();
  const { bubbleOpen, setBubbleOpen, mode } = useCopilotChat();
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => { if (bubbleOpen) setEverOpened(true); }, [bubbleOpen]);

  const goToFull = () => {
    setBubbleOpen(false);
    navigate("/dashboard/copilot");
  };

  return (
    <>
      {/* Launcher */}
      <button
        className={`cbubble__fab${bubbleOpen ? " cbubble__fab--hidden" : ""}`}
        onClick={() => setBubbleOpen(true)}
        aria-label="Open AI Copilot"
        title="AI Copilot"
        data-tour="copilot-bubble"
      >
        <Sprig size={22} />
      </button>

      {/* Hovering chat window */}
      <div
        className={`cbubble__panel${bubbleOpen ? " cbubble__panel--open" : ""}`}
        role="dialog"
        aria-label="AI Copilot"
        aria-hidden={!bubbleOpen}
      >
        <div className="cbubble__header">
          <span className="cbubble__title-icon"><Sprig size={16} /></span>
          {/* Chat switcher / history — reuses the same dropdown as the full Copilot header. */}
          <ChatDropdown />
          {mode === "sequences" && <span className="cbubble__mode">Seq</span>}
          <div className="cbubble__header-actions">
            <button className="cbubble__hbtn" onClick={goToFull} title="Open full Copilot" aria-label="Open full Copilot">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
              </svg>
            </button>
            <button className="cbubble__hbtn" onClick={() => setBubbleOpen(false)} title="Minimize" aria-label="Minimize">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="cbubble__body">
          {everOpened && <AgentChat variant="bubble" />}
        </div>
      </div>
    </>
  );
}
