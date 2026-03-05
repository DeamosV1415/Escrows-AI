import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import ClientModal from "./ClientModal";
import "./DashboardLayout.css";

const DashboardLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const location = useLocation();
  const isInboxPage = location.pathname === "/dashboard/inbox";

  const handleNewLead = async (data: Record<string, unknown>) => {
    const res = await fetch("/api/clients", {
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
            {/* Notifications */}
            <button
              className="dashboard-header__icon-btn"
              aria-label="Notifications"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              <span className="dashboard-header__notification-dot"></span>
            </button>

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
                    window.dispatchEvent(new Event("inbox-import"))
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
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Import Contacts</span>
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

            {/* Help */}
            <button
              className="dashboard-header__icon-btn"
              aria-label="Help & Support"
              title="Help & Support"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
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
