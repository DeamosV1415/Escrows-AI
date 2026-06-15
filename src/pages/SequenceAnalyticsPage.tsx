import { useState, useEffect } from "react";
import { authFetch } from "../utils/authFetch";
import "./SequenceAnalyticsPage.css";

interface Funnel {
  enrolled: number;
  messagesSent: number;
  replied: number;
  completed: number;
  goalMet: number;
  halted: number;
  failed: number;
}
interface Analytics {
  sequenceId: string;
  name: string;
  status: string;
  activeNow: number;
  funnel: Funnel;
  replyRate: number;
  conversionRate: number;
  haltReasons: Record<string, number>;
}

const REASON_LABEL: Record<string, string> = {
  client_replied: "Client replied",
  deal_closed: "Deal closed",
  client_opted_out: "Opted out",
  client_deleted: "Client deleted",
  sequence_deleted: "Sequence deleted",
  max_steps_exceeded: "Max steps",
};
const prettyReason = (r: string) =>
  REASON_LABEL[r] || (r.startsWith("send_failed") ? "Send failed" : r.replace(/_/g, " "));

const SequenceAnalyticsPage: React.FC = () => {
  const [rows, setRows] = useState<Analytics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/sequences/analytics")
      .then((r) => r.json())
      .then((d) => setRows(d.analytics || []))
      .finally(() => setLoading(false));
  }, []);

  const totals = rows.reduce(
    (a, r) => ({
      enrolled: a.enrolled + r.funnel.enrolled,
      active: a.active + (r.activeNow || 0),
      sent: a.sent + r.funnel.messagesSent,
      replied: a.replied + r.funnel.replied,
      goal: a.goal + r.funnel.goalMet,
    }),
    { enrolled: 0, active: 0, sent: 0, replied: 0, goal: 0 },
  );

  return (
    <div className="sa">
      <div className="sa__header">
        <h1 className="sa__title">Sequence Analytics</h1>
        <p className="sa__subtitle">How your automations are performing across every enrollment.</p>
      </div>

      <div className="sa__stats">
        <div className="sa__stat"><div className="sa__stat-val">{totals.active}</div><div className="sa__stat-lbl">Active now</div></div>
        <div className="sa__stat"><div className="sa__stat-val">{totals.enrolled}</div><div className="sa__stat-lbl">Total enrolled</div></div>
        <div className="sa__stat"><div className="sa__stat-val">{totals.sent}</div><div className="sa__stat-lbl">Messages sent</div></div>
        <div className="sa__stat"><div className="sa__stat-val">{totals.replied}</div><div className="sa__stat-lbl">Replies</div></div>
        <div className="sa__stat"><div className="sa__stat-val">{totals.goal}</div><div className="sa__stat-lbl">Goals met</div></div>
      </div>

      {loading ? (
        <div className="sa__empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="sa__empty">No analytics yet. Activate a sequence and enroll a client to start collecting data.</div>
      ) : (
        <div className="sa__list">
          {rows.map((r) => {
            const f = r.funnel;
            const max = Math.max(f.enrolled, 1);
            const steps = [
              { label: "Enrolled (total)", value: f.enrolled },
              { label: "Messages sent", value: f.messagesSent },
              { label: "Replied", value: f.replied },
              { label: "Completed", value: f.completed },
              { label: "Goal met", value: f.goalMet },
            ];
            return (
              <div key={r.sequenceId} className="sa__card">
                <div className="sa__card-head">
                  <span className="sa__card-name">{r.name}</span>
                  <span className={`sa__status sa__status--${r.status}`}>{r.status}</span>
                  <div className="sa__rates">
                    <span className="sa__active-chip">{r.activeNow} active now</span>
                    <span>Reply rate <b>{(r.replyRate * 100).toFixed(0)}%</b></span>
                    <span>Conversion <b>{(r.conversionRate * 100).toFixed(0)}%</b></span>
                  </div>
                </div>
                <div className="sa__funnel">
                  {steps.map((s) => (
                    <div key={s.label} className="sa__funnel-row">
                      <span className="sa__funnel-label">{s.label}</span>
                      <div className="sa__bar-track">
                        <div className="sa__bar" style={{ width: `${(s.value / max) * 100}%` }} />
                      </div>
                      <span className="sa__funnel-val">{s.value}</span>
                    </div>
                  ))}
                </div>
                {Object.keys(r.haltReasons).length > 0 && (
                  <div className="sa__sub">
                    {Object.entries(r.haltReasons)
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, n]) => (
                        <span key={reason} className={reason.startsWith("send_failed") || reason.startsWith("engine_error") ? "sa__danger" : ""}>
                          {prettyReason(reason)}: {n}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SequenceAnalyticsPage;
