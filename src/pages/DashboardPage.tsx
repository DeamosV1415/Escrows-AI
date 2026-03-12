import React, { useState, useEffect } from "react";
import "./DashboardPage.css";
import { authFetch } from "../utils/authFetch";

/* ─── Types ─── */
interface DashboardData {
  stats: {
    activeLeads: number;
    hotLeads: number;
    trackedContacts: number;
  };
  hotLeadsList: {
    _id: string;
    name: string;
    company: string;
    budget: number;
    nextAction: string;
    updatedAt: string;
  }[];
  nextActionsList: {
    _id: string;
    name: string;
    nextAction: string;
    nextActionPriority: "high" | "medium" | "low";
    updatedAt: string;
  }[];
  pipeline: { stage: string; count: number }[];
  userName: string;
}

const STAGE_COLORS: Record<string, string> = {
  Lead: "var(--olive-400, #8a9a4a)",
  Engaged: "var(--olive-500, #6b8035)",
  "Under Contract": "var(--olive-600, #4d6620)",
  Closed: "var(--olive-700, #3d5218)",
};

/* ─── Helper Components ─── */

const TrendArrow = ({ direction }: { direction: "up" | "down" }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`trend-arrow trend-arrow--${direction}`}
  >
    {direction === "up" ? (
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    ) : (
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    )}
  </svg>
);

const ActionIcon = ({ type }: { type: string }) => {
  const icons: Record<string, React.ReactElement> = {
    email: (
      <svg
        width="14"
        height="14"
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
    call: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
      </svg>
    ),
    task: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  };
  return icons[type] || icons.task;
};

const ComingSoonPlaceholder = ({
  icon,
  title,
}: {
  icon: string;
  title: string;
}) => (
  <div className="dash__coming-soon">
    <span className="dash__coming-soon-icon">{icon}</span>
    <span className="dash__coming-soon-title">{title}</span>
    <span className="dash__coming-soon-label">Coming Soon</span>
  </div>
);

/* ─── Page ─── */

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await authFetch("/api/dashboard");
        if (!res.ok) throw new Error("Failed to fetch dashboard");
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  /* ─── Time helper ─── */
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  };

  const formatBudget = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return val > 0 ? `$${val}` : "—";
  };

  const daysSinceUpdate = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / 86400000);
  };

  /* ─── Stats cards config ─── */
  const statsCards = data
    ? [
        {
          label: "Active Leads",
          value: String(data.stats.activeLeads),
          sublabel: "not closed",
          color: "olive",
          trend: "up" as const,
        },
        {
          label: "Hot Leads",
          value: String(data.stats.hotLeads),
          sublabel: "high intent",
          color: "gold",
          trend: "up" as const,
        },
        {
          label: "Sequences Running",
          value: "—",
          sublabel: "coming soon",
          color: "teal",
          trend: "up" as const,
          comingSoon: true,
        },
        {
          label: "Tracked Contacts",
          value: String(data.stats.trackedContacts),
          sublabel: "across channels",
          color: "purple",
          trend: "up" as const,
        },
      ]
    : [];

  /* ─── Pipeline max for bar widths ─── */
  const maxPipeline = data
    ? Math.max(...data.pipeline.map((p) => p.count), 1)
    : 1;
  const totalPipeline = data
    ? data.pipeline.reduce((s, p) => s + p.count, 0)
    : 0;

  if (loading) {
    return (
      <div className="dash">
        <div className="dash__loading">
          <div className="dash__spinner" />
          <span>Loading dashboard...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dash">
        <div className="dash__loading">
          <span>Failed to load dashboard data.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dash">
      {/* Welcome */}
      <div className="dash__welcome">
        <div>
          <h1 className="dash__title">Welcome back, {data.userName}</h1>
          <p className="dash__subtitle">
            Here's what needs your attention today.
            <span className="dash__date">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </span>
          </p>
        </div>
        <div className="dash__welcome-actions">
          <button className="dash__export-btn">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Report
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="dash__stats">
        {statsCards.map((card) => (
          <div
            key={card.label}
            className={`dash__stat-card dash__stat-card--${card.color} ${card.comingSoon ? "dash__stat-card--muted" : ""}`}
          >
            <div className="dash__stat-header">
              <span className="dash__stat-label">{card.label}</span>
              {!card.comingSoon && <TrendArrow direction={card.trend} />}
            </div>
            <div className="dash__stat-value">
              {card.comingSoon ? "—" : card.value}
            </div>
            <div className="dash__stat-footer">
              <span className="dash__stat-sublabel">{card.sublabel}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Two columns: Hot Leads + Next Actions */}
      <div className="dash__panels">
        {/* Hot Leads */}
        <div className="dash__panel">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Hot Leads</h2>
              <p className="dash__panel-desc">
                Clients with high buying intent
              </p>
            </div>
          </div>
          <div className="dash__leads-list">
            {data.hotLeadsList.length === 0 ? (
              <div className="dash__empty-state">
                <span>No hot leads yet</span>
                <p>
                  Mark a client's intent as "Hot" to see them here.
                </p>
              </div>
            ) : (
              data.hotLeadsList.map((lead) => {
                const initials = lead.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                const days = daysSinceUpdate(lead.updatedAt);
                return (
                  <div key={lead._id} className="dash__lead">
                    <div className="dash__lead-avatar">{initials}</div>
                    <div className="dash__lead-info">
                      <div className="dash__lead-row">
                        <span className="dash__lead-name">{lead.name}</span>
                        <span className="dash__lead-value">
                          {formatBudget(lead.budget)}
                        </span>
                      </div>
                      {lead.company && (
                        <span className="dash__lead-company">
                          {lead.company}
                        </span>
                      )}
                      <div className="dash__lead-meta">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>
                          {lead.nextAction || "No action set"}
                        </span>
                        <span className="dash__lead-days">
                          {days === 0 ? "Today" : `${days}d ago`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Next Actions */}
        <div className="dash__panel">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Next Actions</h2>
              <p className="dash__panel-desc">Upcoming follow-ups</p>
            </div>
          </div>
          <div className="dash__actions-list">
            {data.nextActionsList.length === 0 ? (
              <div className="dash__empty-state">
                <span>No actions pending</span>
                <p>
                  Add a "Next Action" to a client to track follow-ups here.
                </p>
              </div>
            ) : (
              data.nextActionsList.map((action) => (
                <div key={action._id} className="dash__action">
                  <div
                    className={`dash__action-icon dash__action-icon--task`}
                  >
                    <ActionIcon type="task" />
                  </div>
                  <div className="dash__action-info">
                    <div className="dash__action-row">
                      <span className="dash__action-contact">
                        {action.name}
                      </span>
                      <span
                        className={`dash__priority dash__priority--${action.nextActionPriority || "medium"}`}
                      >
                        {action.nextActionPriority || "medium"}
                      </span>
                    </div>
                    <span className="dash__action-text">
                      {action.nextAction}
                    </span>
                    <span className="dash__action-time">
                      {timeAgo(action.updatedAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: Pipeline + Weekly Activity */}
      <div className="dash__bottom">
        {/* Pipeline Overview */}
        <div className="dash__panel dash__pipeline">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Pipeline Overview</h2>
              <p className="dash__panel-desc">Client stages breakdown</p>
            </div>
          </div>
          <div className="dash__pipeline-bars">
            {data.pipeline.map((stage) => (
              <div key={stage.stage} className="dash__pipeline-row">
                <span className="dash__pipeline-label">{stage.stage}</span>
                <div className="dash__pipeline-bar-track">
                  <div
                    className="dash__pipeline-bar-fill"
                    style={{
                      width: `${(stage.count / maxPipeline) * 100}%`,
                      background:
                        STAGE_COLORS[stage.stage] || "var(--olive-400)",
                    }}
                  />
                </div>
                <span className="dash__pipeline-count">{stage.count}</span>
              </div>
            ))}
          </div>
          <div className="dash__pipeline-total">
            <span>Total in pipeline</span>
            <strong>{totalPipeline} clients</strong>
          </div>
        </div>

        {/* Weekly Activity Chart — Coming Soon */}
        <div className="dash__panel dash__chart">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Weekly Activity</h2>
              <p className="dash__panel-desc">Emails, calls & meetings</p>
            </div>
          </div>
          <ComingSoonPlaceholder icon="📊" title="Activity tracking" />
        </div>
      </div>

      {/* Recent Activity Feed — Coming Soon */}
      <div className="dash__panel dash__activity">
        <div className="dash__panel-header">
          <div>
            <h2 className="dash__panel-title">Recent Activity</h2>
            <p className="dash__panel-desc">
              Latest updates across your pipeline
            </p>
          </div>
        </div>
        <ComingSoonPlaceholder icon="⚡" title="Activity feed" />
      </div>
    </div>
  );
};

export default DashboardPage;
