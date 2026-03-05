import React from "react";
import "./DashboardPage.css";

/* ─── Mock Data ─── */

const statsCards = [
  {
    label: "Active Leads",
    value: "47",
    change: "+12%",
    trend: "up" as const,
    sublabel: "vs last month",
    color: "olive",
  },
  {
    label: "Hot Leads",
    value: "8",
    change: "+3",
    trend: "up" as const,
    sublabel: "this week",
    color: "gold",
  },
  {
    label: "Sequences Running",
    value: "23",
    change: "5 new",
    trend: "up" as const,
    sublabel: "active campaigns",
    color: "teal",
  },
  {
    label: "This Week's Touches",
    value: "156",
    change: "+28%",
    trend: "up" as const,
    sublabel: "emails & calls",
    color: "purple",
  },
];

const hotLeads = [
  {
    name: "Sarah Johnson",
    company: "Johnson Enterprises",
    score: 94,
    nextAction: "Follow up on property tour",
    daysSince: 2,
    dealValue: "$2.5M",
    avatar: "SJ",
    bgColor: "#e8edda",
  },
  {
    name: "Mike Chen",
    company: "Chen Investments",
    score: 88,
    nextAction: "Send proposal for downtown lot",
    daysSince: 1,
    dealValue: "$1.8M",
    avatar: "MC",
    bgColor: "#dbe4cf",
  },
  {
    name: "Emily Rodriguez",
    company: "Rodriguez Capital",
    score: 85,
    nextAction: "Schedule virtual walkthrough",
    daysSince: 3,
    dealValue: "$3.2M",
    avatar: "ER",
    bgColor: "#d4c4a8",
  },
  {
    name: "David Kim",
    company: "Pacific Holdings",
    score: 82,
    nextAction: "Review counter-offer terms",
    daysSince: 0,
    dealValue: "$4.1M",
    avatar: "DK",
    bgColor: "#c8d4a7",
  },
];

const nextActions = [
  {
    contact: "Tom Wilson",
    action: "Send follow-up email",
    time: "Today",
    priority: "high" as const,
    type: "email",
  },
  {
    contact: "Lisa Anderson",
    action: "Call to discuss lease terms",
    time: "Today",
    priority: "high" as const,
    type: "call",
  },
  {
    contact: "James Park",
    action: "Prepare property comparison sheet",
    time: "Tomorrow",
    priority: "medium" as const,
    type: "task",
  },
  {
    contact: "Rachel Green",
    action: "Send contract for e-signature",
    time: "Tomorrow",
    priority: "medium" as const,
    type: "document",
  },
  {
    contact: "Alex Turner",
    action: "Schedule site inspection",
    time: "Wed",
    priority: "low" as const,
    type: "meeting",
  },
];

const pipelineData = [
  { stage: "Prospecting", count: 18, color: "var(--olive-300)" },
  { stage: "Qualified", count: 12, color: "var(--olive-400)" },
  { stage: "Proposal", count: 8, color: "var(--olive-500)" },
  { stage: "Negotiation", count: 5, color: "var(--olive-600)" },
  { stage: "Closed Won", count: 4, color: "var(--olive-700)" },
];

const recentActivity = [
  {
    icon: "📧",
    text: "Email opened by Sarah Johnson",
    detail: "Re: Property Portfolio Presentation",
    time: "5 min ago",
  },
  {
    icon: "📞",
    text: "Call completed with Mike Chen",
    detail: "Duration: 12 minutes",
    time: "32 min ago",
  },
  {
    icon: "✅",
    text: "Deal moved to Negotiation",
    detail: "Pacific Holdings — $4.1M",
    time: "1 hour ago",
  },
  {
    icon: "📝",
    text: "Note added to Emily Rodriguez",
    detail: "Interested in 2BR units, budget flexible",
    time: "2 hours ago",
  },
  {
    icon: "🎯",
    text: "New lead captured",
    detail: "Via website form — Commercial inquiry",
    time: "3 hours ago",
  },
];

const weeklyActivity = [
  { day: "Mon", emails: 24, calls: 8, meetings: 3 },
  { day: "Tue", emails: 31, calls: 12, meetings: 5 },
  { day: "Wed", emails: 18, calls: 6, meetings: 2 },
  { day: "Thu", emails: 35, calls: 14, meetings: 6 },
  { day: "Fri", emails: 28, calls: 10, meetings: 4 },
  { day: "Sat", emails: 8, calls: 2, meetings: 0 },
  { day: "Sun", emails: 12, calls: 4, meetings: 1 },
];

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
    document: (
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
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
    meeting: (
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
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  };
  return icons[type] || null;
};

/* ─── Page ─── */

const DashboardPage: React.FC = () => {
  const maxEmails = Math.max(...weeklyActivity.map((d) => d.emails));

  return (
    <div className="dash">
      {/* Welcome */}
      <div className="dash__welcome">
        <div>
          <h1 className="dash__title">Welcome back, Chinmay</h1>
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
            className={`dash__stat-card dash__stat-card--${card.color}`}
          >
            <div className="dash__stat-header">
              <span className="dash__stat-label">{card.label}</span>
              <TrendArrow direction={card.trend} />
            </div>
            <div className="dash__stat-value">{card.value}</div>
            <div className="dash__stat-footer">
              <span
                className={`dash__stat-change dash__stat-change--${card.trend}`}
              >
                {card.change}
              </span>
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
              <p className="dash__panel-desc">Highest engagement scores</p>
            </div>
            <button className="dash__panel-action">View All</button>
          </div>
          <div className="dash__leads-list">
            {hotLeads.map((lead) => (
              <div key={lead.name} className="dash__lead">
                <div
                  className="dash__lead-avatar"
                  style={{ background: lead.bgColor }}
                >
                  {lead.avatar}
                </div>
                <div className="dash__lead-info">
                  <div className="dash__lead-row">
                    <span className="dash__lead-name">{lead.name}</span>
                    <span className="dash__lead-value">{lead.dealValue}</span>
                  </div>
                  <span className="dash__lead-company">{lead.company}</span>
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
                    <span>{lead.nextAction}</span>
                    <span className="dash__lead-days">
                      {lead.daysSince === 0
                        ? "Today"
                        : `${lead.daysSince}d ago`}
                    </span>
                  </div>
                </div>
                <div className="dash__lead-score">
                  <svg viewBox="0 0 36 36" className="dash__score-ring">
                    <circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="rgba(0,0,0,0.06)"
                      strokeWidth="3"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke={
                        lead.score >= 90
                          ? "var(--olive-600)"
                          : "var(--olive-400)"
                      }
                      strokeWidth="3"
                      strokeDasharray={`${(lead.score / 100) * 100.5} 100.5`}
                      strokeDashoffset="0"
                      strokeLinecap="round"
                      transform="rotate(-90 18 18)"
                    />
                  </svg>
                  <span className="dash__score-value">{lead.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Next Actions */}
        <div className="dash__panel">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Next Actions</h2>
              <p className="dash__panel-desc">Upcoming follow-ups</p>
            </div>
            <button className="dash__panel-action">View All</button>
          </div>
          <div className="dash__actions-list">
            {nextActions.map((action, i) => (
              <div key={i} className="dash__action">
                <div
                  className={`dash__action-icon dash__action-icon--${action.type}`}
                >
                  <ActionIcon type={action.type} />
                </div>
                <div className="dash__action-info">
                  <div className="dash__action-row">
                    <span className="dash__action-contact">
                      {action.contact}
                    </span>
                    <span
                      className={`dash__priority dash__priority--${action.priority}`}
                    >
                      {action.priority}
                    </span>
                  </div>
                  <span className="dash__action-text">{action.action}</span>
                  <span className="dash__action-time">{action.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row: Pipeline + Activity Chart + Recent Activity */}
      <div className="dash__bottom">
        {/* Pipeline Overview */}
        <div className="dash__panel dash__pipeline">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Pipeline Overview</h2>
              <p className="dash__panel-desc">Deal stages breakdown</p>
            </div>
          </div>
          <div className="dash__pipeline-bars">
            {pipelineData.map((stage) => (
              <div key={stage.stage} className="dash__pipeline-row">
                <span className="dash__pipeline-label">{stage.stage}</span>
                <div className="dash__pipeline-bar-track">
                  <div
                    className="dash__pipeline-bar-fill"
                    style={{
                      width: `${(stage.count / 20) * 100}%`,
                      background: stage.color,
                    }}
                  />
                </div>
                <span className="dash__pipeline-count">{stage.count}</span>
              </div>
            ))}
          </div>
          <div className="dash__pipeline-total">
            <span>Total in pipeline</span>
            <strong>
              {pipelineData.reduce((s, p) => s + p.count, 0)} deals
            </strong>
          </div>
        </div>

        {/* Weekly Activity Chart */}
        <div className="dash__panel dash__chart">
          <div className="dash__panel-header">
            <div>
              <h2 className="dash__panel-title">Weekly Activity</h2>
              <p className="dash__panel-desc">Emails, calls & meetings</p>
            </div>
            <div className="dash__chart-legend">
              <span className="dash__legend-item">
                <span className="dash__legend-dot dash__legend-dot--emails"></span>
                Emails
              </span>
              <span className="dash__legend-item">
                <span className="dash__legend-dot dash__legend-dot--calls"></span>
                Calls
              </span>
              <span className="dash__legend-item">
                <span className="dash__legend-dot dash__legend-dot--meetings"></span>
                Meetings
              </span>
            </div>
          </div>
          <div className="dash__chart-bars">
            {weeklyActivity.map((day) => (
              <div key={day.day} className="dash__chart-col">
                <div className="dash__chart-stack">
                  <div
                    className="dash__chart-bar dash__chart-bar--meetings"
                    style={{ height: `${(day.meetings / maxEmails) * 100}%` }}
                    title={`${day.meetings} meetings`}
                  />
                  <div
                    className="dash__chart-bar dash__chart-bar--calls"
                    style={{ height: `${(day.calls / maxEmails) * 100}%` }}
                    title={`${day.calls} calls`}
                  />
                  <div
                    className="dash__chart-bar dash__chart-bar--emails"
                    style={{ height: `${(day.emails / maxEmails) * 100}%` }}
                    title={`${day.emails} emails`}
                  />
                </div>
                <span className="dash__chart-label">{day.day}</span>
              </div>
            ))}
          </div>
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
          <button className="dash__panel-action">View All</button>
        </div>
        <div className="dash__activity-feed">
          {recentActivity.map((item, i) => (
            <div key={i} className="dash__activity-item">
              <div className="dash__activity-icon">{item.icon}</div>
              <div className="dash__activity-content">
                <span className="dash__activity-text">{item.text}</span>
                <span className="dash__activity-detail">{item.detail}</span>
              </div>
              <span className="dash__activity-time">{item.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
