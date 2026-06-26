import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";
import "./GetStartedChecklist.css";

interface Props {
  /* Live counts from the dashboard stats the parent already fetched. */
  clientsCount: number;
  sequencesRunning: number;
}

interface ChecklistItem {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  cta: string;
  to: string;
}

/**
 * Activation checklist shown on the dashboard until every step is done (or dismissed).
 * Each item's "done" state is derived from REAL data — connect an inbox, add clients,
 * launch a sequence — so it self-checks as the broker actually uses the product. This is
 * the resumable nudge that replaces a one-shot onboarding form.
 */
const GetStartedChecklist: React.FC<Props> = ({ clientsCount, sequencesRunning }) => {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("getstarted_collapsed") === "1");
  const [profileDone, setProfileDone] = useState(false);
  const [channelDone, setChannelDone] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("getstarted_collapsed", next ? "1" : "0");
      return next;
    });
  };

  const load = useCallback(async () => {
    try {
      const [meRes, intRes] = await Promise.all([
        authFetch("/api/auth/me"),
        authFetch("/api/integrations/status"),
      ]);
      if (meRes.ok) {
        const { user } = await meRes.json();
        if (user?.getStartedDismissed) setHidden(true);
        // Profile counts as "done" once they've added a company (the key personalization field).
        setProfileDone(!!(user?.company && String(user.company).trim()));
      }
      if (intRes.ok) {
        const s = await intRes.json();
        setChannelDone(!!(s?.gmail?.connected || s?.whatsapp?.connected));
      }
    } catch {
      /* leave defaults */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dismiss = useCallback(async () => {
    setHidden(true);
    try {
      await authFetch("/api/auth/onboarding/dismiss", { method: "POST" });
    } catch {
      /* best-effort */
    }
  }, []);

  const items: ChecklistItem[] = [
    {
      id: "profile",
      title: "Complete your profile",
      desc: "Add your company so your messages and templates are personalized.",
      done: profileDone,
      cta: "Edit profile",
      to: "/dashboard/settings#profile",
    },
    {
      id: "channel",
      title: "Connect your inbox",
      desc: "Link Gmail or WhatsApp so your sequences can actually send.",
      done: channelDone,
      cta: "Connect",
      to: "/dashboard/settings#integrations",
    },
    {
      id: "clients",
      title: "Add your clients",
      desc: "Import or add a few clients to start tracking deals and reaching out.",
      done: clientsCount > 0,
      cta: "Add clients",
      to: "/dashboard/clients",
    },
    {
      id: "sequence",
      title: "Launch your first sequence",
      desc: "Pick a template and activate it to start following up automatically.",
      done: sequencesRunning > 0,
      cta: "Browse sequences",
      to: "/dashboard/sequences",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;

  // Onboarding completion is a ONE-TIME milestone, not a live status. The moment all steps
  // are done, latch it (persist the dismissal) so the checklist never resurrects when live
  // state later dips — e.g. pausing the only active sequence or disconnecting a channel.
  useEffect(() => {
    if (loaded && !hidden && doneCount === total) dismiss();
  }, [loaded, hidden, doneCount, total, dismiss]);

  // Hide while loading, once dismissed, or when fully activated.
  if (!loaded || hidden || doneCount === total) return null;

  return (
    <div className={`getstarted ${collapsed ? "is-collapsed" : ""}`}>
      <div className="getstarted__head">
        <button
          className="getstarted__toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <span className={`getstarted__chevron ${collapsed ? "is-collapsed" : ""}`} aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
          <span className="getstarted__head-text">
            <span className="getstarted__title">Get started</span>
            <span className="getstarted__sub">
              {doneCount} of {total} done{collapsed ? "" : " — a few quick steps to get the most out of Escrows AI."}
            </span>
          </span>
        </button>
        <button className="getstarted__dismiss" onClick={dismiss} title="Dismiss">
          Dismiss
        </button>
      </div>

      <div className="getstarted__body">
        <div className="getstarted__body-inner">
          <div className="getstarted__bar">
            <div className="getstarted__bar-fill" style={{ width: `${(doneCount / total) * 100}%` }} />
          </div>

          <ul className="getstarted__list">
        {items.map((item) => (
          <li key={item.id} className={`getstarted__item ${item.done ? "is-done" : ""}`}>
            <span className="getstarted__check">{item.done ? "✓" : ""}</span>
            <div className="getstarted__item-text">
              <strong>{item.title}</strong>
              <p>{item.desc}</p>
            </div>
            {!item.done && (
              <button className="getstarted__cta" onClick={() => navigate(item.to)}>
                {item.cta} →
              </button>
            )}
          </li>
          ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default GetStartedChecklist;
