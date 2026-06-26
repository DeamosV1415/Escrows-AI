import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./DashboardPage.css";
import { authFetch } from "../utils/authFetch";
import GetStartedChecklist from "../components/dashboard/GetStartedChecklist";

/* ─── Types ─── */
interface DashboardData {
  stats: {
    activeLeads: number;
    hotLeads: number;
    trackedContacts: number;
    sequencesRunning: number;
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

type ActivityKind = "client" | "inventory" | "inbox" | "sequence";

interface ActivityChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  changes?: ActivityChange[];
  ai?: boolean;
  at: string;
}

interface WeeklyDay {
  label: string;
  date: string;
  client: number;
  inventory: number;
  inbox: number;
  sequence: number;
  total: number;
}

interface WeeklyData {
  days: WeeklyDay[];
  max: number;
}

/* Category order, labels and colours for the Weekly Activity stacked bars. */
const WEEKLY_CATEGORIES: { key: ActivityKind; label: string; color: string }[] = [
  { key: "client", label: "Clients", color: "var(--olive-500, #6b8035)" },
  { key: "inbox", label: "Inbox", color: "#2f6fd0" },
  { key: "sequence", label: "Sequences", color: "#6b5ea0" },
  { key: "inventory", label: "Inventory", color: "#b8860b" },
];

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

/* ─── Page ─── */

/* Line-art icon per activity kind. */
const ActivityIcon = ({ kind }: { kind: ActivityKind }) => {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "client":
      return (
        <svg {...common}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...common}>
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
      );
    case "sequence":
      // Connected-node flow graph — represents a sequence's block graph.
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.4" />
          <circle cx="18" cy="6" r="2.4" />
          <circle cx="12" cy="18" r="2.4" />
          <path d="M8 7.4l3 8.4M16 7.4l-3 8.4M8.4 6h7.2" />
        </svg>
      );
  }
};

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearActivity = async () => {
    setClearing(true);
    try {
      const res = await authFetch("/api/dashboard/activity/clear", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to clear activity");
      setActivity([]);
      setShowClearConfirm(false);
    } catch (err) {
      console.error("Clear activity error:", err);
    } finally {
      setClearing(false);
    }
  };

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

    const fetchActivity = async () => {
      try {
        const res = await authFetch("/api/dashboard/activity");
        if (!res.ok) throw new Error("Failed to fetch activity");
        const json = await res.json();
        setActivity(json.items || []);
      } catch (err) {
        console.error("Activity fetch error:", err);
        setActivity([]);
      }
    };

    const fetchWeekly = async () => {
      try {
        const res = await authFetch("/api/dashboard/weekly");
        if (!res.ok) throw new Error("Failed to fetch weekly activity");
        const json = await res.json();
        setWeekly(json);
      } catch (err) {
        console.error("Weekly activity fetch error:", err);
        setWeekly({ days: [], max: 1 });
      }
    };

    fetchDashboard();
    fetchActivity();
    fetchWeekly();
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
          value: String(data.stats.sequencesRunning),
          sublabel: "active sequences",
          color: "teal",
          trend: "up" as const,
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
          <button
            className="dash__export-btn"
            onClick={() => navigate("/dashboard/report")}
          >
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

      {/* Onboarding activation checklist — hides itself when complete or dismissed */}
      <GetStartedChecklist
        clientsCount={data.stats.activeLeads}
        sequencesRunning={data.stats.sequencesRunning}
      />

      {/* Stats Cards */}
      <div className="dash__stats">
        {statsCards.map((card) => (
          <div
            key={card.label}
            className={`dash__stat-card dash__stat-card--${card.color}`}
          >
            <div className="dash__stat-header">
              <span className="dash__stat-label">{card.label}</span>
              <TrendArrow direction={card.trend} />
            </div>
            <div className="dash__stat-value">{card.value}</div>
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
                <p>Mark a client's intent as "Hot" to see them here.</p>
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
                        <span>{lead.nextAction || "No action set"}</span>
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
                <p>Add a "Next Action" to a client to track follow-ups here.</p>
              </div>
            ) : (
              data.nextActionsList.map((action) => (
                <div key={action._id} className="dash__action">
                  <div className={`dash__action-icon dash__action-icon--task`}>
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

        {/* Weekly Activity Chart */}
        <div className="dash__panel dash__chart">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Weekly Activity</h2>
              <p className="dash__panel-desc">
                Clients, inbox, sequences & inventory
              </p>
            </div>
          </div>

          {weekly === null ? (
            <div className="dash__chart-loading">
              <div className="loading-wave">
                <div className="loading-bar" />
                <div className="loading-bar" />
                <div className="loading-bar" />
                <div className="loading-bar" />
              </div>
            </div>
          ) : weekly.days.every((d) => d.total === 0) ? (
            <div className="dash__empty-state">
              <span>No activity this week</span>
              <p>Your activity across the last 7 days will chart here.</p>
            </div>
          ) : (
            <>
              <div className="dash__chart-bars">
                {weekly.days.map((day) => (
                  <div key={day.date} className="dash__chart-col">
                    <div className="dash__chart-plot">
                      <div
                        className="dash__chart-stack"
                        style={{
                          height: `${(day.total / weekly.max) * 100}%`,
                        }}
                      >
                        {day.total > 0 && (
                          <span className="dash__chart-count">{day.total}</span>
                        )}
                        {WEEKLY_CATEGORIES.map((cat) =>
                          day[cat.key] > 0 ? (
                            <div
                              key={cat.key}
                              className="dash__chart-seg"
                              style={{
                                height: `${(day[cat.key] / day.total) * 100}%`,
                                background: cat.color,
                              }}
                              title={`${cat.label}: ${day[cat.key]}`}
                            />
                          ) : null,
                        )}
                      </div>
                    </div>
                    <span className="dash__chart-label">{day.label}</span>
                  </div>
                ))}
              </div>
              <div className="dash__chart-legend">
                {WEEKLY_CATEGORIES.map((cat) => (
                  <div key={cat.key} className="dash__chart-legend-item">
                    <span
                      className="dash__chart-legend-dot"
                      style={{ background: cat.color }}
                    />
                    {cat.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="dash__panel dash__activity">
        <div className="dash__panel-header">
          <div>
            <h2 className="dash__panel-title">Recent Activity</h2>
            <p className="dash__panel-desc">
              Latest updates across your pipeline
            </p>
          </div>
          {activity && activity.length > 0 && (
            <button
              className="dash__clear-btn"
              onClick={() => setShowClearConfirm(true)}
            >
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
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Clear
            </button>
          )}
        </div>
        <div className="dash__activity-list">
          {activity === null ? (
            <div className="dash__activity-loading">
              <div className="dash__spinner" />
            </div>
          ) : activity.length === 0 ? (
            <div className="dash__empty-state">
              <span>No activity yet</span>
              <p>
                Actions across clients, inbox, sequences and inventory show up
                here.
              </p>
            </div>
          ) : (
            activity.map((item) => (
              <div key={item.id} className="dash__activity-item">
                <span
                  className={`dash__activity-icon dash__activity-icon--${item.kind}`}
                >
                  <ActivityIcon kind={item.kind} />
                </span>
                <div className="dash__activity-content">
                  <span className="dash__activity-text">
                    {item.title}
                    {item.ai && (
                      <span className="dash__activity-ai" title="Performed by AI Copilot">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5 10.1 10.9 5.5 9l4.6-1.4L12 3z" />
                        </svg>
                        AI
                      </span>
                    )}
                  </span>
                  {item.changes && item.changes.length > 0 && (
                    <div className="dash__activity-changes">
                      {item.changes.map((c, i) => (
                        <span key={i} className="dash__change-chip">
                          <span className="dash__change-field">{c.label}</span>
                          {c.from !== null && c.to !== null ? (
                            <span className="dash__change-delta">
                              {c.from}
                              <span className="dash__change-arrow">→</span>
                              {c.to}
                            </span>
                          ) : (
                            <span className="dash__change-delta">updated</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="dash__activity-time">{timeAgo(item.at)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Clear Activity confirmation dialog */}
      {showClearConfirm && (
        <div
          className="dash__modal-overlay"
          onClick={() => !clearing && setShowClearConfirm(false)}
        >
          <div className="dash__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="dash__modal-title">Clear recent activity?</h3>
            <p className="dash__modal-text">
              This hides all current entries from your activity feed. Your
              messages and sequence history are <b>not deleted</b>, and new
              activity will still appear here.
            </p>
            <div className="dash__modal-actions">
              <button
                className="dash__modal-btn dash__modal-btn--ghost"
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                Cancel
              </button>
              <button
                className="dash__modal-btn dash__modal-btn--danger"
                onClick={handleClearActivity}
                disabled={clearing}
              >
                {clearing ? "Clearing..." : "Clear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
