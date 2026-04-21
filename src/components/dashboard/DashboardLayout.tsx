import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";
import Sidebar from "./Sidebar";
import ClientModal from "./ClientModal";
import "./DashboardLayout.css";

const DashboardLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const location = useLocation();
  const isInboxPage = location.pathname === "/dashboard/inbox";

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

  return (
    <div
      className={`dashboard-layout ${sidebarCollapsed ? "dashboard-layout--collapsed" : ""}`}
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

          {/* Search bar */}
          <div className="dashboard-header__search">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search leads, contacts, deals..."
              className="dashboard-header__search-input"
            />
            <kbd className="dashboard-header__search-kbd">⌘K</kbd>
          </div>

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
    </div>
  );
};

export default DashboardLayout;
