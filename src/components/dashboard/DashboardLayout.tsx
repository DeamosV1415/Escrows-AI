import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";
import Sidebar from "./Sidebar";
import ClientModal from "./ClientModal";
import GlobalSearch from "./GlobalSearch";
import { CopilotChatProvider } from "./CopilotChatContext";
import ChatDropdown from "./ChatDropdown";
import CopilotBubble from "./CopilotBubble";
import WelcomeTour from "./WelcomeTour";
import "./DashboardLayout.css";

const DashboardLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const location = useLocation();
  const isInboxPage = location.pathname === "/dashboard/inbox";
  const isCopilotPage = location.pathname === "/dashboard/copilot";

  // Tell the backend which timezone this broker is in, so sequence quiet hours (and
  // schedule/wait_until timing) are evaluated in their local time instead of UTC. Runs once
  // per browser session, and only re-syncs if the detected zone changed.
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      if (sessionStorage.getItem("seqTzSynced") === tz) return;
      authFetch("/api/sequences/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultTimezone: tz }),
      })
        .then((r) => { if (r.ok) sessionStorage.setItem("seqTzSynced", tz); })
        .catch(() => {});
    } catch {
      /* timezone detection is best-effort */
    }
  }, []);

  // Let the global search "＋ New Lead" quick action open the same modal as the header button.
  useEffect(() => {
    const onOpenNewLead = () => setNewLeadOpen(true);
    window.addEventListener("open-new-lead", onOpenNewLead);
    return () => window.removeEventListener("open-new-lead", onOpenNewLead);
  }, []);

  const handleNewLead = async (data: Record<string, unknown>) => {
    const res = await authFetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to create client");
    setNewLeadOpen(false);
    // Dispatch a custom event so ClientsPage can refresh if it's mounted
    window.dispatchEvent(new Event("client-updated"));
  };

  const content = (
    <div
      className={`dashboard-layout ${sidebarCollapsed ? "dashboard-layout--collapsed" : ""} ${isCopilotPage ? "dashboard-layout--copilot" : ""}`}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="dashboard-layout__main">
        {/* Top Header Bar */}
        <header className="dashboard-header">
          {/* Mobile sidebar toggle */}
          <button
            className="dashboard-header__mobile-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label="Toggle sidebar"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Search bar OR Copilot title slot (filled by AgentChat via portal) */}
          {isCopilotPage ? (
            <div
              id="copilot-title-slot"
              className="dashboard-header__copilot-title"
            />
          ) : (
            <GlobalSearch />
          )}

          {/* Right side */}
          <div className="dashboard-header__actions">
            {/* Quick add / Inbox actions */}
            {isInboxPage ? (
              <>
                <button
                  className="dashboard-header__add-btn"
                  style={{
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-medium)",
                    boxShadow: "none",
                  }}
                  onClick={() =>
                    window.dispatchEvent(new Event("inbox-contacts"))
                  }
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87" />
                    <path d="M16 3.13a4 4 0 010 7.75" />
                  </svg>
                  <span>Contacts</span>
                </button>
                <button
                  className="dashboard-header__add-btn"
                  onClick={() =>
                    window.dispatchEvent(new Event("inbox-connect"))
                  }
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Connect Apps</span>
                </button>
              </>
            ) : isCopilotPage ? (
              <>
                <ChatDropdown />
                <div
                  id="copilot-actions-slot"
                  className="dashboard-header__copilot-actions"
                />
              </>
            ) : (
              <button
                className="dashboard-header__add-btn"
                onClick={() => setNewLeadOpen(true)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>New Lead</span>
              </button>
            )}
          </div>
        </header>

        {/* Main scrollable content */}
        <div className="dashboard-layout__content">
          <Outlet />
        </div>
      </div>

      {/* New Lead Modal (from header) */}
      {newLeadOpen && (
        <ClientModal
          onClose={() => setNewLeadOpen(false)}
          onSubmit={handleNewLead}
        />
      )}

      {/* Floating copilot, remotely accessible on every page except the full Copilot page. */}
      {!isCopilotPage && <CopilotBubble />}

      {/* Post-onboarding welcome takeover + guided tour (self-hides unless triggered). */}
      <WelcomeTour />
    </div>
  );

  // The CopilotChatProvider now wraps the WHOLE dashboard (not just the copilot page) so the
  // floating bubble and the full Copilot page share one conversation + composer state.
  return <CopilotChatProvider>{content}</CopilotChatProvider>;
};

export default DashboardLayout;
