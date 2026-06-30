import { useState, useRef, useEffect, useCallback } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import "./Sidebar.css";
import LogoImg from "../../assets/Logo.png";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /* Mobile drawer state (decoupled from the desktop collapse rail). */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const ICON_DASHBOARD = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const ICON_CLIENTS = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
);

const ICON_INVENTORY = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

const ICON_SEQUENCES = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const ICON_COPILOT = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
  </svg>
);

const ICON_INBOX = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

interface NavChild {
  label: string;
  path: string;
  end?: boolean;
}
interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  end?: boolean;
  children?: NavChild[];
}
interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", path: "/dashboard", icon: ICON_DASHBOARD, end: true },
      { label: "Clients", path: "/dashboard/clients", icon: ICON_CLIENTS },
      { label: "Inventory", path: "/dashboard/inventory", icon: ICON_INVENTORY },
    ],
  },
  {
    label: "Engage",
    items: [
      {
        label: "Sequences",
        path: "/dashboard/sequences",
        icon: ICON_SEQUENCES,
        children: [
          { label: "Sequences", path: "/dashboard/sequences", end: true },
          { label: "Analytics", path: "/dashboard/sequences/analytics" },
        ],
      },
      { label: "Inbox", path: "/dashboard/inbox", icon: ICON_INBOX },
      { label: "AI Copilot", path: "/dashboard/copilot", icon: ICON_COPILOT },
    ],
  },
];

const bottomItems = [
  {
    label: "Settings",
    path: "/dashboard/settings",
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

/* ─── Profile Popup ─── */
const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle, mobileOpen, onCloseMobile }) => {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [seqOpen, setSeqOpen] = useState<boolean>(() => {
    const stored = localStorage.getItem("sidebarSeqOpen");
    return stored === null ? true : stored === "true";
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupOpen(false);
      }
    };
    if (popupOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popupOpen]);

  // Fetch unread count from messages API
  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/messages/unread-count", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // silently fail
    }
  }, [token]);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  const handleLogout = () => {
    logout();
    setPopupOpen(false);
    navigate("/login", { replace: true });
  };

  // Get user initials and display name
  const userName = user?.name || "User";
  const initials = userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const shortName =
    userName.split(" ").length > 1
      ? `${userName.split(" ")[0]} ${userName.split(" ")[1]?.[0]}.`
      : userName;

  const toggleSeq = () => {
    setSeqOpen((prev) => {
      const next = !prev;
      localStorage.setItem("sidebarSeqOpen", String(next));
      return next;
    });
  };

  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""} ${mobileOpen ? "sidebar--mobile-open" : ""}`}>
      {/* Logo area */}
      <div className="sidebar__header">
        <div
          className="sidebar__logo"
          onClick={collapsed ? onToggle : undefined}
          style={collapsed ? { cursor: "pointer" } : undefined}
          title={collapsed ? "Expand sidebar" : undefined}
        >
          <img src={LogoImg} alt="EscrowsAI" className="sidebar__logo-img" />
          {!collapsed && <span className="sidebar__logo-text">EscrowsAI</span>}
        </div>
        {/* Mobile: close the drawer. Desktop-only collapse chevron is hidden on phones. */}
        <button
          className="sidebar__close-mobile"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {!collapsed && (
          <button
            className="sidebar__toggle"
            onClick={onToggle}
            aria-label="Collapse sidebar"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
      </div>

      {/* Main navigation */}
      <nav className="sidebar__nav">
        {navSections.map((section) => (
          <div key={section.label} className="sidebar__nav-section">
            <span className="sidebar__nav-label">{section.label}</span>
            {section.items.map((item) => {
              // Grouped item (Sequences → Sequences + Analytics)
              if (item.children) {
                const groupActive = location.pathname.startsWith(item.path);

                // Collapsed: icon link with a hover flyout listing children
                if (collapsed) {
                  return (
                    <div key={item.path} className="sidebar__group sidebar__group--collapsed">
                      <NavLink
                        to={item.path}
                        className={`sidebar__link ${groupActive ? "sidebar__link--active" : ""}`}
                        title={item.label}
                      >
                        <span className="sidebar__link-icon">{item.icon}</span>
                      </NavLink>
                      <div className="sidebar__flyout">
                        <span className="sidebar__flyout-title">{item.label}</span>
                        {item.children.map((c) => (
                          <NavLink
                            key={c.path}
                            to={c.path}
                            end={c.end}
                            className={({ isActive }) =>
                              `sidebar__flyout-link ${isActive ? "sidebar__flyout-link--active" : ""}`
                            }
                          >
                            {c.label}
                          </NavLink>
                        ))}
                      </div>
                    </div>
                  );
                }

                // Expanded: collapsible disclosure
                return (
                  <div key={item.path} className="sidebar__group">
                    <button
                      type="button"
                      className={`sidebar__group-header ${groupActive ? "sidebar__group-header--active" : ""}`}
                      onClick={toggleSeq}
                      aria-expanded={seqOpen}
                      data-tour="nav-sequences"
                    >
                      <span className="sidebar__link-icon">{item.icon}</span>
                      <span className="sidebar__link-label">{item.label}</span>
                      <svg
                        className="sidebar__group-chevron"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <div className="sidebar__group-body" data-open={seqOpen}>
                      <div className="sidebar__group-body-inner">
                        {item.children.map((c) => (
                          <NavLink
                            key={c.path}
                            to={c.path}
                            end={c.end}
                            className={({ isActive }) =>
                              `sidebar__sublink ${isActive ? "sidebar__sublink--active" : ""}`
                            }
                          >
                            {c.label}
                          </NavLink>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              const showBadge = item.label === "Inbox" && unreadCount > 0;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  data-tour={`nav-${item.path.split("/").pop() || "dashboard"}`}
                  className={({ isActive }) =>
                    `sidebar__link ${isActive ? "sidebar__link--active" : ""}`
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <span className="sidebar__link-icon">{item.icon}</span>
                  {!collapsed && (
                    <span className="sidebar__link-label">{item.label}</span>
                  )}
                  {!collapsed && showBadge && (
                    <span className="sidebar__badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  )}
                  {collapsed && showBadge && (
                    <span className="sidebar__badge-dot" aria-hidden="true" />
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="sidebar__footer">
        {bottomItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar__link ${isActive ? "sidebar__link--active" : ""}`
            }
            title={collapsed ? item.label : undefined}
          >
            <span className="sidebar__link-icon">{item.icon}</span>
            {!collapsed && (
              <span className="sidebar__link-label">{item.label}</span>
            )}
          </NavLink>
        ))}

        {/* User profile — clickable */}
        <div className="sidebar__profile-wrapper" ref={popupRef}>
          <div
            className="sidebar__user"
            onClick={() => setPopupOpen(!popupOpen)}
            title={collapsed ? userName : undefined}
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={userName}
                className="sidebar__user-avatar sidebar__user-avatar--img"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="sidebar__user-avatar">{initials}</div>
            )}
            {!collapsed && (
              <div className="sidebar__user-info">
                <span className="sidebar__user-name">{shortName}</span>
                <span className="sidebar__user-role">{user?.email || "Member"}</span>
              </div>
            )}
          </div>

          {/* Context Menu (beside sidebar) */}
          {popupOpen && (
            <div className="profile-menu">
              <div className="profile-menu__header">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={userName}
                    className="profile-menu__avatar profile-menu__avatar--img"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="profile-menu__avatar">{initials}</div>
                )}
                <div>
                  <div className="profile-menu__name">{userName}</div>
                  <div className="profile-menu__email">{user?.email}</div>
                </div>
              </div>

              <div className="profile-menu__divider" />

              <button
                className="profile-menu__btn profile-menu__btn--logout"
                onClick={handleLogout}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
