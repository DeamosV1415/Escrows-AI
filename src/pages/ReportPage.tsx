import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./ReportPage.css";
import { authFetch } from "../utils/authFetch";
import { useAuth } from "../components/AuthContext";

/* ─── Types ─── */
interface DashboardResponse {
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

interface WeeklyDay {
  label: string;
  date: string;
  client: number;
  inventory: number;
  inbox: number;
  sequence: number;
  total: number;
}
interface WeeklyResponse {
  days: WeeklyDay[];
  max: number;
}

const STAGE_COLORS: Record<string, string> = {
  Lead: "#9aa758",
  Engaged: "#6b8035",
  "Under Contract": "#4d6620",
  Closed: "#34481a",
};

const WEEKLY_CATEGORIES: { key: keyof WeeklyDay; label: string; color: string }[] = [
  { key: "client", label: "Clients", color: "#6b8035" },
  { key: "inbox", label: "Inbox", color: "#2f6fd0" },
  { key: "sequence", label: "Sequences", color: "#6b5ea0" },
  { key: "inventory", label: "Inventory", color: "#b8860b" },
];

const ReportPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [weekly, setWeekly] = useState<WeeklyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [dRes, wRes] = await Promise.all([
          authFetch("/api/dashboard"),
          authFetch("/api/dashboard/weekly"),
        ]);
        if (!dRes.ok) throw new Error("dashboard");
        setData(await dRes.json());
        if (wRes.ok) setWeekly(await wRes.json());
      } catch (err) {
        console.error("Report fetch error:", err);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const now = new Date();
  const generatedOn = now.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const reportId = `EA-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  const formatBudget = (val: number) => {
    if (!val || val <= 0) return "—";
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val}`;
  };

  if (loading) {
    return (
      <div className="report__state">
        <div className="report__spinner" />
        <span>Preparing your report…</span>
      </div>
    );
  }

  if (failed || !data) {
    return (
      <div className="report__state">
        <span>Could not load report data.</span>
        <button className="report__btn" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const maxPipeline = Math.max(...data.pipeline.map((p) => p.count), 1);
  const totalPipeline = data.pipeline.reduce((s, p) => s + p.count, 0);
  const agentName = user?.name || data.userName || "Agent";
  const initials = agentName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const kpis = [
    { label: "Active Leads", value: data.stats.activeLeads, sub: "not closed" },
    { label: "Hot Leads", value: data.stats.hotLeads, sub: "high intent" },
    { label: "Sequences Running", value: data.stats.sequencesRunning, sub: "active" },
    { label: "Tracked Contacts", value: data.stats.trackedContacts, sub: "all channels" },
  ];

  const weeklyHasData = weekly && weekly.days.some((d) => d.total > 0);

  return (
    <div className="report">
      {/* Screen-only toolbar (hidden in print) */}
      <div className="report__toolbar">
        <button
          className="report__btn report__btn--ghost"
          onClick={() => navigate("/dashboard")}
        >
          ← Back
        </button>
        <button className="report__btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="report__page">
        {/* ─── Cover header band ─── */}
        <header className="report__header">
          <div className="report__header-left">
            <div className="report__logo">EA</div>
            <div>
              <div className="report__brand-name brand-name">Tachikiba</div>
              <div className="report__brand-sub">Pipeline Performance Report</div>
            </div>
          </div>
          <div className="report__header-right">
            <div className="report__agent">
              <div className="report__agent-avatar">{initials}</div>
              <div>
                <div className="report__agent-name">{agentName}</div>
                {user?.email && (
                  <div className="report__agent-email">{user.email}</div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="report__subbar">
          <span>Report {reportId}</span>
          <span>Generated {generatedOn}</span>
        </div>

        {/* ─── KPI summary ─── */}
        <section className="report__section">
          <div className="report__section-head">
            <span className="report__eyebrow">01</span>
            <h2 className="report__section-title">Executive Summary</h2>
          </div>
          <div className="report__kpis">
            {kpis.map((k) => (
              <div key={k.label} className="report__kpi">
                <div className="report__kpi-value">{k.value}</div>
                <div className="report__kpi-label">{k.label}</div>
                <div className="report__kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Pipeline ─── */}
        <section className="report__section">
          <div className="report__section-head">
            <span className="report__eyebrow">02</span>
            <h2 className="report__section-title">Pipeline Overview</h2>
            <span className="report__section-aside">
              {totalPipeline} clients across {data.pipeline.length} stages
            </span>
          </div>

          {/* Proportion bar */}
          <div className="report__propbar">
            {data.pipeline.map((s) =>
              s.count > 0 ? (
                <div
                  key={s.stage}
                  className="report__propbar-seg"
                  style={{
                    width: `${(s.count / totalPipeline) * 100}%`,
                    background: STAGE_COLORS[s.stage] || "#9aa758",
                  }}
                  title={`${s.stage}: ${s.count}`}
                />
              ) : null,
            )}
          </div>

          <div className="report__pipeline">
            {data.pipeline.map((stage) => {
              const pct = totalPipeline
                ? Math.round((stage.count / totalPipeline) * 100)
                : 0;
              return (
                <div key={stage.stage} className="report__pl-row">
                  <span
                    className="report__pl-dot"
                    style={{ background: STAGE_COLORS[stage.stage] || "#9aa758" }}
                  />
                  <span className="report__pl-label">{stage.stage}</span>
                  <div className="report__pl-track">
                    <div
                      className="report__pl-fill"
                      style={{
                        width: `${(stage.count / maxPipeline) * 100}%`,
                        background: STAGE_COLORS[stage.stage] || "#9aa758",
                      }}
                    />
                  </div>
                  <span className="report__pl-count">{stage.count}</span>
                  <span className="report__pl-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ─── Weekly Activity ─── */}
        <section className="report__section">
          <div className="report__section-head">
            <span className="report__eyebrow">03</span>
            <h2 className="report__section-title">Weekly Activity</h2>
            <span className="report__section-aside">Last 7 days</span>
          </div>

          {weeklyHasData ? (
            <div className="report__chart">
              <div className="report__chart-bars">
                {weekly!.days.map((day) => (
                  <div key={day.date} className="report__chart-col">
                    <div className="report__chart-plot">
                      <div
                        className="report__chart-stack"
                        style={{ height: `${(day.total / weekly!.max) * 100}%` }}
                      >
                        {day.total > 0 && (
                          <span className="report__chart-count">{day.total}</span>
                        )}
                        {WEEKLY_CATEGORIES.map((cat) =>
                          (day[cat.key] as number) > 0 ? (
                            <div
                              key={cat.key}
                              className="report__chart-seg"
                              style={{
                                height: `${((day[cat.key] as number) / day.total) * 100}%`,
                                background: cat.color,
                              }}
                            />
                          ) : null,
                        )}
                      </div>
                    </div>
                    <span className="report__chart-label">{day.label}</span>
                  </div>
                ))}
              </div>
              <div className="report__legend">
                {WEEKLY_CATEGORIES.map((cat) => (
                  <span key={cat.key} className="report__legend-item">
                    <span
                      className="report__legend-dot"
                      style={{ background: cat.color }}
                    />
                    {cat.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="report__muted">No recorded activity in the last 7 days.</p>
          )}
        </section>

        {/* ─── Hot Leads ─── */}
        <section className="report__section report__section--break">
          <div className="report__section-head">
            <span className="report__eyebrow">04</span>
            <h2 className="report__section-title">Hot Leads</h2>
            <span className="report__section-aside">High buying intent</span>
          </div>

          {data.hotLeadsList.length > 0 ? (
            <table className="report__table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Company</th>
                  <th className="report__td-right">Budget</th>
                  <th>Next Action</th>
                </tr>
              </thead>
              <tbody>
                {data.hotLeadsList.map((lead) => (
                  <tr key={lead._id}>
                    <td className="report__td-strong">{lead.name}</td>
                    <td>{lead.company || "—"}</td>
                    <td className="report__td-right">{formatBudget(lead.budget)}</td>
                    <td>{lead.nextAction || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="report__muted">No hot leads at this time.</p>
          )}
        </section>

        {/* ─── Next Actions ─── */}
        <section className="report__section">
          <div className="report__section-head">
            <span className="report__eyebrow">05</span>
            <h2 className="report__section-title">Upcoming Follow-ups</h2>
            <span className="report__section-aside">
              {data.nextActionsList.length} pending
            </span>
          </div>

          {data.nextActionsList.length > 0 ? (
            <table className="report__table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Action</th>
                  <th className="report__td-right">Priority</th>
                </tr>
              </thead>
              <tbody>
                {data.nextActionsList.map((a) => (
                  <tr key={a._id}>
                    <td className="report__td-strong">{a.name}</td>
                    <td>{a.nextAction}</td>
                    <td className="report__td-right">
                      <span
                        className={`report__pill report__pill--${a.nextActionPriority || "medium"}`}
                      >
                        {a.nextActionPriority || "medium"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="report__muted">No follow-ups scheduled.</p>
          )}
        </section>

        {/* ─── Footer ─── */}
        <footer className="report__footer">
          <span>Confidential — prepared for {agentName}</span>
          <span><span className="brand-name">Tachikiba</span> · {reportId}</span>
        </footer>
      </div>
    </div>
  );
};

export default ReportPage;
