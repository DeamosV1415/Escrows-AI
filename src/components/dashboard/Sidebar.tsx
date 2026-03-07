import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { authFetch } from "../../utils/authFetch";
import "./Sidebar.css";
import LogoImg from "../../assets/Logo.png";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  {
    label: "Dashboard",
    path: "/dashboard",
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
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    label: "Clients",
    path: "/dashboard/clients",
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
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    label: "Inventory",
    path: "/dashboard/inventory",
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
        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    label: "Sequences",
    path: "/dashboard/sequences",
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
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    label: "Inbox",
    path: "/dashboard/inbox",
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
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
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
interface ProfileData {
  phone: string;
  company: string;
  jobTitle: string;
  licenseNumber: string;
  yearsInBusiness: string;
  location: string;
  specialization: string;
  teamSize: string;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const [popupOpen, setPopupOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileData, setProfileData] = useState<ProfileData>({
    phone: "",
    company: "",
    jobTitle: "",
    licenseNumber: "",
    yearsInBusiness: "",
    location: "",
    specialization: "",
    teamSize: "",
  });
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupOpen(false);
        setEditMode(false);
      }
    };
    if (popupOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popupOpen]);

  // Load profile data when opening edit mode
  const openEditMode = async () => {
    setEditMode(true);
    try {
      const res = await authFetch("/api/auth/me");
      const data = await res.json();
      if (res.ok && data.user) {
        setProfileData({
          phone: data.user.phone || "",
          company: data.user.company || "",
          jobTitle: data.user.jobTitle || "",
          licenseNumber: data.user.licenseNumber || "",
          yearsInBusiness: data.user.yearsInBusiness?.toString() || "",
          location: data.user.location || "",
          specialization: data.user.specialization || "",
          teamSize: data.user.teamSize || "",
        });
      }
    } catch {
      // silently fail, form will be empty
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profileData,
          yearsInBusiness: profileData.yearsInBusiness
            ? parseInt(profileData.yearsInBusiness)
            : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        updateUser(data.user);
        setEditMode(false);
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

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

  const handleFieldChange = (field: keyof ProfileData, value: string) => {
    setProfileData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
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
        <div className="sidebar__nav-section">
          <span className="sidebar__nav-label">{!collapsed && "MENU"}</span>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/dashboard"}
              className={({ isActive }) =>
                `sidebar__link ${isActive ? "sidebar__link--active" : ""}`
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar__link-icon">{item.icon}</span>
              {!collapsed && (
                <span className="sidebar__link-label">{item.label}</span>
              )}
              {!collapsed && item.label === "Inbox" && (
                <span className="sidebar__badge">3</span>
              )}
            </NavLink>
          ))}
        </div>
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
                <span className="sidebar__user-role">{profileData.jobTitle || user?.email || "Member"}</span>
              </div>
            )}
          </div>

          {/* Context Menu (beside sidebar) */}
          {popupOpen && !editMode && (
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
                className="profile-menu__btn"
                onClick={openEditMode}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit Profile
              </button>

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

          {/* Edit Profile Modal (centered full-screen) */}
          {editMode && (
            <div className="profile-modal-overlay">
              <div className="profile-modal">
                <div className="profile-modal__header">
                  <div className="profile-modal__header-user">
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={userName}
                        className="profile-modal__avatar"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="profile-modal__avatar-initials">{initials}</div>
                    )}
                    <span className="profile-modal__title">Edit Profile</span>
                  </div>
                  <button
                    className="profile-modal__close"
                    onClick={() => {
                      setEditMode(false);
                      setPopupOpen(false);
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div className="profile-modal__content">
                  <div className="profile-modal__grid">
                    <div className="profile-field">
                      <label>Phone</label>
                      <input
                        type="tel"
                        value={profileData.phone}
                        onChange={(e) => handleFieldChange("phone", e.target.value)}
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                    <div className="profile-field">
                      <label>Company</label>
                      <input
                        type="text"
                        value={profileData.company}
                        onChange={(e) => handleFieldChange("company", e.target.value)}
                        placeholder="Your brokerage or firm"
                      />
                    </div>
                    <div className="profile-field">
                      <label>Job Title</label>
                      <input
                        type="text"
                        value={profileData.jobTitle}
                        onChange={(e) => handleFieldChange("jobTitle", e.target.value)}
                        placeholder="e.g. Real Estate Agent"
                      />
                    </div>
                    <div className="profile-field">
                      <label>License Number</label>
                      <input
                        type="text"
                        value={profileData.licenseNumber}
                        onChange={(e) => handleFieldChange("licenseNumber", e.target.value)}
                        placeholder="e.g. DRE-01234567"
                      />
                    </div>
                    <div className="profile-field">
                      <label>Location</label>
                      <input
                        type="text"
                        value={profileData.location}
                        onChange={(e) => handleFieldChange("location", e.target.value)}
                        placeholder="City, State"
                      />
                    </div>
                    <div className="profile-field">
                      <label>Years in Business</label>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        value={profileData.yearsInBusiness}
                        onChange={(e) => handleFieldChange("yearsInBusiness", e.target.value)}
                        placeholder="e.g. 5"
                      />
                    </div>
                    <div className="profile-field">
                      <label>Specialization</label>
                      <select
                        value={profileData.specialization}
                        onChange={(e) => handleFieldChange("specialization", e.target.value)}
                      >
                        <option value="">Select...</option>
                        <option value="Residential">Residential</option>
                        <option value="Commercial">Commercial</option>
                        <option value="Land & Development">Land & Development</option>
                        <option value="Property Management">Property Management</option>
                        <option value="Mortgage & Lending">Mortgage & Lending</option>
                        <option value="Title & Escrow">Title & Escrow</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="profile-field">
                      <label>Team Size</label>
                      <select
                        value={profileData.teamSize}
                        onChange={(e) => handleFieldChange("teamSize", e.target.value)}
                      >
                        <option value="">Select...</option>
                        <option value="Solo">Solo</option>
                        <option value="2-5">2–5 people</option>
                        <option value="6-20">6–20 people</option>
                        <option value="20+">20+ people</option>
                      </select>
                    </div>
                  </div>

                  <button
                    className="profile-modal__save"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
