import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../components/AuthContext";
import { authFetch } from "../utils/authFetch";
import "./AdminPage.css";

/* ─── Types ─── */

interface AdminUser {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
  profileComplete: boolean;
  phone?: string;
  company?: string;
  jobTitle?: string;
  licenseNumber?: string;
  location?: string;
  specialization?: string;
  teamSize?: string;
  createdAt: string;
  updatedAt: string;
  tier: "free" | "growth" | "pro" | "enterprise";
  credits: number;
  monthlyAllocation: number;
  unlimited: boolean;
  totalUsed: number;
  lastRefill?: string;
  hasCreditAccount: boolean;
}

interface AdminStats {
  totalUsers: number;
  tiers: { free: number; growth: number; pro: number; enterprise: number };
  totalCreditsUsed: number;
  totalCreditsRemaining: number;
  totalMonthlyAllocation: number;
}

interface EditForm {
  tier: string;
  credits: string;
  monthlyAllocation: string;
  unlimited: boolean;
}

interface ChangeItem {
  field: string;
  oldValue: string;
  newValue: string;
}

interface AuditEntry {
  _id: string;
  adminEmail: string;
  action: string;
  method: string;
  path: string;
  targetEmail: string;
  changes: string[];
  ip: string;
  at: string;
}

/* ─── Tier Credit Caps ─── */

const TIER_CAPS: Record<string, number> = {
  free: 40,
  growth: 200,
  pro: 500,
  enterprise: 2000,
};

/* ─── Page ─── */

const AdminPage: React.FC = () => {
  const { user } = useAuth();

  // Data
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Active view: user management vs. audit trail
  const [view, setView] = useState<"users" | "audit">("users");

  // Audit log
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(false);

  // Search & filter
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");

  // Edit modal
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    tier: "free",
    credits: "0",
    monthlyAllocation: "0",
    unlimited: false,
  });

  // Confirmation
  const [confirmChanges, setConfirmChanges] = useState<ChangeItem[] | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState("");

  /* ─── Fetch data ─── */

  const fetchData = useCallback(async () => {
    try {
      setError("");
      const [usersRes, statsRes] = await Promise.all([
        authFetch("/api/admin/users"),
        authFetch("/api/admin/stats"),
      ]);

      if (!usersRes.ok || !statsRes.ok) {
        throw new Error("Failed to fetch admin data");
      }

      const usersData = await usersRes.json();
      const statsData = await statsRes.json();

      setUsers(usersData.users);
      setStats(statsData);
    } catch (err) {
      setError("Failed to load admin data. Please refresh.");
      console.error("Admin fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ─── Fetch audit log (read-only) ─── */

  const fetchAudit = useCallback(async (before?: string) => {
    try {
      setAuditLoading(true);
      const qs = new URLSearchParams({ limit: "50" });
      if (before) qs.set("before", before);
      const res = await authFetch(`/api/admin/audit?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch audit log");
      const data = await res.json();
      setAudit((prev) =>
        before ? [...prev, ...data.entries] : data.entries
      );
      setAuditHasMore(data.hasMore);
      setAuditLoaded(true);
    } catch (err) {
      setError("Failed to load audit log. Please refresh.");
      console.error("Audit fetch error:", err);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  // Lazy-load the audit trail the first time the tab is opened.
  useEffect(() => {
    if (view === "audit" && !auditLoaded) {
      fetchAudit();
    }
  }, [view, auditLoaded, fetchAudit]);

  /* ─── Filtered users ─── */

  const filteredUsers = useMemo(() => {
    let result = users;

    if (tierFilter !== "all") {
      result = result.filter((u) => u.tier === tierFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.company && u.company.toLowerCase().includes(q))
      );
    }

    return result;
  }, [users, tierFilter, search]);

  /* ─── Helpers ─── */

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const creditPercent = (credits: number, allocation: number) => {
    if (allocation === 0) return 0;
    return Math.min(Math.round((credits / allocation) * 100), 100);
  };

  const creditBarClass = (pct: number) => {
    if (pct > 50) return "admin__credits-bar-fill--high";
    if (pct > 20) return "admin__credits-bar-fill--mid";
    return "admin__credits-bar-fill--low";
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  /* ─── Edit Modal ─── */

  const openEdit = (u: AdminUser) => {
    setEditUser(u);
    setEditForm({
      tier: u.tier,
      credits: String(u.credits),
      monthlyAllocation: String(u.monthlyAllocation),
      unlimited: u.unlimited,
    });
  };

  const closeEdit = () => {
    setEditUser(null);
    setConfirmChanges(null);
  };

  const handleFieldChange = (field: keyof EditForm, value: string | boolean) => {
    setEditForm((prev) => {
      const next = { ...prev, [field]: value };

      // When tier changes, auto-update allocation and credits to new tier defaults
      if (field === "tier" && typeof value === "string") {
        const cap = TIER_CAPS[value] ?? 40;
        next.monthlyAllocation = String(cap);
        next.credits = String(cap);
      }

      return next;
    });
  };

  const currentCap = TIER_CAPS[editForm.tier] ?? 40;

  /* ─── Build changes diff and show confirmation ─── */

  const handleSaveClick = () => {
    if (!editUser) return;

    const changes: ChangeItem[] = [];

    if (editForm.tier !== editUser.tier) {
      changes.push({
        field: "Tier",
        oldValue: editUser.tier,
        newValue: editForm.tier,
      });
    }

    if (Number(editForm.credits) !== editUser.credits) {
      changes.push({
        field: "Credits",
        oldValue: String(editUser.credits),
        newValue: editForm.credits,
      });
    }

    if (Number(editForm.monthlyAllocation) !== editUser.monthlyAllocation) {
      changes.push({
        field: "Allocation",
        oldValue: String(editUser.monthlyAllocation),
        newValue: editForm.monthlyAllocation,
      });
    }

    if (editForm.unlimited !== editUser.unlimited) {
      changes.push({
        field: "Unlimited",
        oldValue: editUser.unlimited ? "Yes" : "No",
        newValue: editForm.unlimited ? "Yes" : "No",
      });
    }

    if (changes.length === 0) {
      closeEdit();
      return;
    }

    setConfirmChanges(changes);
  };

  /* ─── Confirm and submit ─── */

  const handleConfirmSubmit = async () => {
    if (!editUser) return;

    setSaving(true);
    try {
      const body: Record<string, unknown> = {};

      if (editForm.tier !== editUser.tier) body.tier = editForm.tier;
      if (Number(editForm.credits) !== editUser.credits)
        body.credits = Number(editForm.credits);
      if (Number(editForm.monthlyAllocation) !== editUser.monthlyAllocation)
        body.monthlyAllocation = Number(editForm.monthlyAllocation);
      if (editForm.unlimited !== editUser.unlimited)
        body.unlimited = editForm.unlimited;

      const res = await authFetch(`/api/admin/users/${editUser._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }

      showToast(`✅ ${editUser.name}'s account updated successfully`);
      closeEdit();
      await fetchData(); // Refresh data
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Update failed";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  /* ─── Render ─── */

  return (
    <div className="admin">
      {/* Top Bar */}
      <header className="admin__topbar">
        <div className="admin__topbar-left">
          <a href="/dashboard" className="admin__back-link">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Dashboard
          </a>
          <h1 className="admin__topbar-title">Admin Panel</h1>
          <span className="admin__topbar-badge">Admin</span>
          <div className="admin__tabs">
            <button
              className={`admin__tab ${view === "users" ? "admin__tab--active" : ""}`}
              onClick={() => setView("users")}
            >
              Users
            </button>
            <button
              className={`admin__tab ${view === "audit" ? "admin__tab--active" : ""}`}
              onClick={() => setView("audit")}
            >
              Audit Log
            </button>
          </div>
        </div>
        <div className="admin__topbar-right">
          <span>Signed in as</span>
          <span className="admin__topbar-email">{user?.email}</span>
        </div>
      </header>

      <div className="admin__body">
        {/* Error */}
        {error && (
          <div className="admin__error">
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
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        {loading ? (
          <div className="admin__loading">
            <div className="admin__spinner" />
            <span>Loading admin data…</span>
          </div>
        ) : view === "users" ? (
          <>
            {/* Stats Overview */}
            {stats && (
              <div className="admin__stats">
                <div className="admin__stat-card admin__stat-card--total">
                  <div className="admin__stat-label">Total Users</div>
                  <div className="admin__stat-value">{stats.totalUsers}</div>
                </div>
                <div className="admin__stat-card admin__stat-card--free">
                  <div className="admin__stat-label">Free</div>
                  <div className="admin__stat-value">{stats.tiers.free}</div>
                </div>
                <div className="admin__stat-card admin__stat-card--growth">
                  <div className="admin__stat-label">Growth</div>
                  <div className="admin__stat-value">{stats.tiers.growth}</div>
                </div>
                <div className="admin__stat-card admin__stat-card--pro">
                  <div className="admin__stat-label">Pro</div>
                  <div className="admin__stat-value">{stats.tiers.pro}</div>
                </div>
                <div className="admin__stat-card admin__stat-card--enterprise">
                  <div className="admin__stat-label">Enterprise</div>
                  <div className="admin__stat-value">
                    {stats.tiers.enterprise}
                  </div>
                </div>
              </div>
            )}

            {/* Toolbar */}
            <div className="admin__toolbar">
              <div className="admin__search">
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
                  className="admin__search-input"
                  placeholder="Search by name, email, or company…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="admin__filter-group">
                {["all", "free", "growth", "pro", "enterprise"].map((tier) => (
                  <button
                    key={tier}
                    className={`admin__filter-btn ${tierFilter === tier ? "admin__filter-btn--active" : ""}`}
                    onClick={() => setTierFilter(tier)}
                  >
                    {tier === "all" ? "All" : tier}
                  </button>
                ))}
              </div>

              <span className="admin__user-count">
                {filteredUsers.length} user
                {filteredUsers.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* User Table */}
            <div className="admin__table-wrap">
              {filteredUsers.length === 0 ? (
                <div className="admin__empty">
                  <div className="admin__empty-icon">
                    <svg
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 00-3-3.87" />
                      <path d="M16 3.13a4 4 0 010 7.75" />
                    </svg>
                  </div>
                  <div className="admin__empty-title">No users found</div>
                  <div className="admin__empty-desc">
                    Try adjusting your search or filter criteria.
                  </div>
                </div>
              ) : (
                <table className="admin__table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Plan</th>
                      <th>Credits</th>
                      <th>Used</th>
                      <th>Company</th>
                      <th>Joined</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => {
                      const pct = creditPercent(u.credits, u.monthlyAllocation);
                      return (
                        <tr key={u._id} onClick={() => openEdit(u)}>
                          <td>
                            <div className="admin__user-cell">
                              {u.avatar ? (
                                <img
                                  src={u.avatar}
                                  alt={u.name}
                                  className="admin__user-avatar admin__user-avatar--img"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="admin__user-avatar">
                                  {getInitials(u.name)}
                                </div>
                              )}
                              <div>
                                <span className="admin__user-name">
                                  {u.name}
                                </span>
                                <span className="admin__user-email">
                                  {u.email}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`admin__tier admin__tier--${u.tier}`}>
                              {u.tier}
                            </span>
                          </td>
                          <td>
                            <div className="admin__credits-cell">
                              {u.unlimited ? (
                                <span className="admin__unlimited-badge">
                                  Unlimited
                                </span>
                              ) : (
                                <>
                                  <span className="admin__credits-main">
                                    {u.credits}
                                  </span>
                                  <span className="admin__credits-sub">
                                    / {u.monthlyAllocation}
                                  </span>
                                  <div className="admin__credits-bar">
                                    <div
                                      className={`admin__credits-bar-fill ${creditBarClass(pct)}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="admin__credits-main">
                              {u.totalUsed}
                            </span>
                          </td>
                          <td>
                            <span className="admin__date-cell">
                              {u.company || "—"}
                            </span>
                          </td>
                          <td>
                            <span className="admin__date-cell">
                              {formatDate(u.createdAt)}
                            </span>
                          </td>
                          <td>
                            <button
                              className="admin__edit-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(u);
                              }}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          /* ─── Audit Log View (read-only) ─── */
          <div className="admin__audit">
            <div className="admin__audit-head">
              <div>
                <h2 className="admin__audit-title">Admin Audit Trail</h2>
                <p className="admin__audit-sub">
                  Read-only record of every admin action. Newest first.
                </p>
              </div>
              <button
                className="admin__filter-btn"
                onClick={() => fetchAudit()}
                disabled={auditLoading}
              >
                {auditLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {!auditLoaded && auditLoading ? (
              <div className="admin__loading">
                <div className="admin__spinner" />
                <span>Loading audit log…</span>
              </div>
            ) : audit.length === 0 ? (
              <div className="admin__empty">
                <div className="admin__empty-title">No audit entries yet</div>
                <div className="admin__empty-desc">
                  Admin actions will appear here once they happen.
                </div>
              </div>
            ) : (
              <>
                <div className="admin__table-wrap">
                  <table className="admin__table admin__audit-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Admin</th>
                        <th>Action</th>
                        <th>Target</th>
                        <th>Changes</th>
                        <th>IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((e) => (
                        <tr key={e._id}>
                          <td>
                            <span className="admin__date-cell">
                              {formatDateTime(e.at)}
                            </span>
                          </td>
                          <td>
                            <span className="admin__user-email">
                              {e.adminEmail || "—"}
                            </span>
                          </td>
                          <td>
                            <span className="admin__audit-action">
                              {e.action}
                            </span>
                          </td>
                          <td>
                            <span className="admin__user-email">
                              {e.targetEmail || "—"}
                            </span>
                          </td>
                          <td>
                            {e.changes.length > 0 ? (
                              <div className="admin__audit-changes">
                                {e.changes.map((c, i) => (
                                  <span key={i} className="admin__audit-chip">
                                    {c}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <span className="admin__date-cell">
                              {e.ip || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {auditHasMore && (
                  <div className="admin__audit-more">
                    <button
                      className="admin__filter-btn"
                      onClick={() => fetchAudit(audit[audit.length - 1]?.at)}
                      disabled={auditLoading}
                    >
                      {auditLoading ? "Loading…" : "Load more"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Edit Modal ─── */}
      {editUser && !confirmChanges && (
        <div className="admin__modal-overlay" onClick={closeEdit}>
          <div
            className="admin__modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="admin__modal-header">
              <div className="admin__modal-header-left">
                {editUser.avatar ? (
                  <img
                    src={editUser.avatar}
                    alt={editUser.name}
                    className="admin__modal-avatar admin__modal-avatar--img"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="admin__modal-avatar">
                    {getInitials(editUser.name)}
                  </div>
                )}
                <div>
                  <div className="admin__modal-user-name">{editUser.name}</div>
                  <div className="admin__modal-user-email">
                    {editUser.email}
                  </div>
                </div>
              </div>
              <button className="admin__modal-close" onClick={closeEdit}>
                ✕
              </button>
            </div>

            <div className="admin__modal-body">
              {/* Read-only details */}
              <div className="admin__modal-details">
                <div className="admin__detail-item">
                  <span className="admin__detail-label">Joined</span>
                  <span className="admin__detail-value">
                    {formatDate(editUser.createdAt)}
                  </span>
                </div>
                <div className="admin__detail-item">
                  <span className="admin__detail-label">Profile</span>
                  <span className="admin__detail-value">
                    {editUser.profileComplete ? "Complete" : "Incomplete"}
                  </span>
                </div>
                {editUser.company && (
                  <div className="admin__detail-item">
                    <span className="admin__detail-label">Company</span>
                    <span className="admin__detail-value">
                      {editUser.company}
                    </span>
                  </div>
                )}
                {editUser.jobTitle && (
                  <div className="admin__detail-item">
                    <span className="admin__detail-label">Title</span>
                    <span className="admin__detail-value">
                      {editUser.jobTitle}
                    </span>
                  </div>
                )}
                {editUser.location && (
                  <div className="admin__detail-item">
                    <span className="admin__detail-label">Location</span>
                    <span className="admin__detail-value">
                      {editUser.location}
                    </span>
                  </div>
                )}
                {editUser.specialization && (
                  <div className="admin__detail-item">
                    <span className="admin__detail-label">Specialization</span>
                    <span className="admin__detail-value">
                      {editUser.specialization}
                    </span>
                  </div>
                )}
                <div className="admin__detail-item">
                  <span className="admin__detail-label">Total Used</span>
                  <span className="admin__detail-value">
                    {editUser.totalUsed} credits
                  </span>
                </div>
                {editUser.lastRefill && (
                  <div className="admin__detail-item">
                    <span className="admin__detail-label">Last Refill</span>
                    <span className="admin__detail-value">
                      {formatDate(editUser.lastRefill)}
                    </span>
                  </div>
                )}
              </div>

              {/* Editable fields */}
              <div className="admin__modal-section-title">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Account Settings
              </div>

              <div className="admin__modal-fields">
                <div className="admin__field">
                  <label>Plan Tier</label>
                  <select
                    value={editForm.tier}
                    onChange={(e) => handleFieldChange("tier", e.target.value)}
                  >
                    <option value="free">Free</option>
                    <option value="growth">Growth</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                <div className="admin__field">
                  <label>Credits (max {currentCap})</label>
                  <input
                    type="number"
                    min="0"
                    max={currentCap}
                    value={editForm.credits}
                    onChange={(e) =>
                      handleFieldChange("credits", e.target.value)
                    }
                  />
                  <span className="admin__field-hint">
                    Capped at {currentCap} for {editForm.tier} tier
                  </span>
                </div>

                <div className="admin__field">
                  <label>Monthly Allocation</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.monthlyAllocation}
                    onChange={(e) =>
                      handleFieldChange("monthlyAllocation", e.target.value)
                    }
                  />
                </div>
              </div>

              {/* Unlimited toggle */}
              <div className="admin__toggle-row">
                <div>
                  <div className="admin__toggle-label">Unlimited Credits</div>
                  <div className="admin__toggle-desc">
                    Bypass credit limits entirely
                  </div>
                </div>
                <label className="admin__toggle">
                  <input
                    type="checkbox"
                    checked={editForm.unlimited}
                    onChange={(e) =>
                      handleFieldChange("unlimited", e.target.checked)
                    }
                  />
                  <span className="admin__toggle-track" />
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="admin__modal-footer">
              <button className="admin__modal-cancel" onClick={closeEdit}>
                Cancel
              </button>
              <button className="admin__modal-save" onClick={handleSaveClick}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Confirmation Dialog ─── */}
      {confirmChanges && editUser && (
        <div
          className="admin__confirm-overlay"
          onClick={() => setConfirmChanges(null)}
        >
          <div
            className="admin__confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin__confirm-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="admin__confirm-title">Confirm Changes</div>
            <div className="admin__confirm-desc">
              You are about to update <strong>{editUser.name}</strong>'s
              account:
            </div>

            <div className="admin__confirm-changes">
              {confirmChanges.map((c) => (
                <div key={c.field} className="admin__confirm-change-item">
                  <span>{c.field}</span>
                  <span className="admin__confirm-old">{c.oldValue}</span>
                  <span className="admin__confirm-arrow">→</span>
                  <span className="admin__confirm-new">{c.newValue}</span>
                </div>
              ))}
            </div>

            <div className="admin__confirm-actions">
              <button
                className="admin__confirm-cancel"
                onClick={() => setConfirmChanges(null)}
                disabled={saving}
              >
                Go Back
              </button>
              <button
                className="admin__confirm-submit"
                onClick={handleConfirmSubmit}
                disabled={saving}
              >
                {saving ? "Saving…" : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast ─── */}
      {toast && (
        <div className="admin__toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
};

export default AdminPage;
