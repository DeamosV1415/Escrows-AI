import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../utils/authFetch";
import { useCopilotChat } from "../components/dashboard/CopilotChatContext";
import type { Sequence } from "../utils/sequenceMeta";
import "./SequencesPage.css";

interface TemplateCard {
  key: string;
  name: string;
  description: string;
  triggerType: string;
  nodeCount: number;
}
interface ClientLite {
  _id: string;
  name: string;
  email: string;
  intent?: string;
  stage?: string;
}
interface Notification {
  _id: string;
  message: string;
  priority: string;
  read: boolean;
  source: string;
  createdAt: string;
}

const TRIGGER_LABEL: Record<string, string> = {
  client_created: "New client",
  stage_changed: "Stage change",
  manual_enroll: "Manual",
  schedule: "Scheduled",
};

const SequencesPage: React.FC = () => {
  const navigate = useNavigate();
  const { openCopilot } = useCopilotChat();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [killSwitch, setKillSwitch] = useState(false);
  const [activeLimit, setActiveLimit] = useState<number | null>(null);
  const [graceUntil, setGraceUntil] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [enrollFor, setEnrollFor] = useState<Sequence | null>(null);
  const [dryRunFor, setDryRunFor] = useState<Sequence | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, t, n, k] = await Promise.all([
        authFetch("/api/sequences").then((r) => r.json()),
        authFetch("/api/sequences/templates").then((r) => r.json()),
        authFetch("/api/sequences/notifications").then((r) => r.json()),
        authFetch("/api/sequences/kill-switch").then((r) => r.json()),
      ]);
      setSequences(s.sequences || []);
      setActiveLimit(s.usage?.activeLimit ?? null);
      setGraceUntil(s.usage?.graceUntil ?? null);
      setTemplates(t.templates || []);
      setNotifications(n.notifications || []);
      setUnread(n.unread || 0);
      setKillSwitch(!!k.enabled);
    } catch {
      /* surfaced via empty states */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When the Sequences sub-agent saves a draft, pull it into the list.
  useEffect(() => {
    const onGenerated = () => load();
    window.addEventListener("sequence-generated", onGenerated);
    return () => window.removeEventListener("sequence-generated", onGenerated);
  }, [load]);

  const useTemplate = async (key: string) => {
    setBusy("tpl-" + key);
    try {
      const res = await authFetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey: key }),
      });
      const seq = await res.json();
      if (res.ok) navigate(`/dashboard/sequences/${seq._id}/edit`);
    } finally {
      setBusy(null);
    }
  };

  const createBlank = async () => {
    setBusy("blank");
    try {
      const res = await authFetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled sequence" }),
      });
      const seq = await res.json();
      if (res.ok) navigate(`/dashboard/sequences/${seq._id}/edit`);
    } finally {
      setBusy(null);
    }
  };

  const lifecycle = async (seq: Sequence, action: "activate" | "pause") => {
    setBusy(seq._id);
    try {
      const res = await authFetch(`/api/sequences/${seq._id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error + (d.errors ? "\n\n" + d.errors.map((e: any) => "• " + e.message).join("\n") : ""));
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (seq: Sequence) => {
    if (!confirm(`Delete "${seq.name}"? Active enrollments will stop.`)) return;
    setBusy(seq._id);
    try {
      await authFetch(`/api/sequences/${seq._id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const toggleKill = async () => {
    const next = !killSwitch;
    setKillSwitch(next);
    await authFetch("/api/sequences/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  };

  const markAllRead = async () => {
    await authFetch("/api/sequences/notifications/read-all", { method: "POST" });
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const activeCount = sequences.filter((s) => s.status === "active").length;
  const atCap = activeLimit != null && activeCount >= activeLimit;
  const overBy = activeLimit != null ? Math.max(0, activeCount - activeLimit) : 0;
  // Downgrade grace: user is over their new cap and has a deadline to pause down before
  // the sweep auto-pauses the excess (keeping the most-recently-activated ones).
  const graceActive = !!graceUntil && overBy > 0;
  const graceDeadline = graceUntil
    ? new Date(graceUntil).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const totalEnrolled = sequences.reduce((a, s) => a + (s.stats?.active || 0), 0);
  const totalCompleted = sequences.reduce((a, s) => a + (s.stats?.completed || 0), 0);

  return (
    <div className="seq">
      {/* Header */}
      <div className="seq__header">
        <div>
          <h1 className="seq__title">Sequences</h1>
          <p className="seq__subtitle">Automate client outreach with branch-capable, auto-running flows.</p>
        </div>
        <div className="seq__header-actions">
          {/* Create with AI — opens the floating copilot in Sequences-builder mode */}
          <button className="seq__ai-btn" onClick={() => openCopilot({ mode: "sequences" })}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span>Create with AI</span>
          </button>
          {/* Notifications */}
          <div className="seq__notif-wrap">
            <button className="seq__icon-btn" onClick={() => setShowNotifs((v) => !v)} aria-label="Notifications">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              {unread > 0 && <span className="seq__notif-badge">{unread > 99 ? "99+" : unread}</span>}
            </button>
            {showNotifs && (
              <div className="seq__notif-panel">
                <div className="seq__notif-head">
                  <span>Notifications</span>
                  {unread > 0 && <button onClick={markAllRead}>Mark all read</button>}
                </div>
                {notifications.length === 0 ? (
                  <div className="seq__notif-empty">No notifications yet.</div>
                ) : (
                  notifications.slice(0, 30).map((n) => (
                    <div key={n._id} className={`seq__notif-item ${n.read ? "" : "seq__notif-item--unread"}`}>
                      <span className={`seq__dot seq__dot--${n.priority}`} />
                      <div>
                        <div className="seq__notif-msg">{n.message}</div>
                        <div className="seq__notif-time">{new Date(n.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Kill switch */}
          <button className={`seq__kill ${killSwitch ? "seq__kill--on" : ""}`} onClick={toggleKill} title="Halt all sequence sending for your account">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="7" x2="12" y2="13" />
            </svg>
            {killSwitch ? "Sending paused" : "Kill switch"}
          </button>

          <button className="seq__btn seq__btn--primary" onClick={createBlank} disabled={busy === "blank"}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Sequence
          </button>
        </div>
      </div>

      {killSwitch && (
        <div className="seq__kill-banner">
          ⚠️ Your kill switch is ON — no sequence messages will be sent until you turn it off.
        </div>
      )}

      {graceActive && (
        <div className="seq__grace-banner">
          ⚠️ You have <strong>{activeCount}</strong> active sequences but your plan allows{" "}
          <strong>{activeLimit}</strong>. Pause at least <strong>{overBy}</strong> by{" "}
          <strong>{graceDeadline}</strong>, or we'll automatically pause the extras for you
          (keeping your most recently activated ones).
        </div>
      )}

      {/* Stats */}
      <div className="seq__stats">
        <div className="seq__stat"><div className="seq__stat-val">{sequences.length}</div><div className="seq__stat-lbl">Sequences</div></div>
        <div className="seq__stat">
          <div className={`seq__stat-val ${atCap ? "seq__stat-val--cap" : ""}`}>
            {activeCount}{activeLimit != null && <span className="seq__stat-limit">/{activeLimit}</span>}
          </div>
          <div className="seq__stat-lbl">Active{atCap ? " · at limit" : ""}</div>
        </div>
        <div className="seq__stat"><div className="seq__stat-val">{totalEnrolled}</div><div className="seq__stat-lbl">Enrolled now</div></div>
        <div className="seq__stat"><div className="seq__stat-val">{totalCompleted}</div><div className="seq__stat-lbl">Completed</div></div>
      </div>

      {/* Template library */}
      <h2 className="seq__section-title">Start from a template</h2>
      <div className="seq__templates">
        {templates.map((t) => (
          <div key={t.key} className="seq__tpl-card">
            <div className="seq__tpl-top">
              <span className="seq__tpl-name">{t.name}</span>
              <span className="seq__chip">{TRIGGER_LABEL[t.triggerType] || t.triggerType}</span>
            </div>
            <p className="seq__tpl-desc">{t.description}</p>
            <div className="seq__tpl-foot">
              <span className="seq__tpl-meta">{t.nodeCount} blocks</span>
              <button className="seq__btn seq__btn--ghost" onClick={() => useTemplate(t.key)} disabled={busy === "tpl-" + t.key}>
                {busy === "tpl-" + t.key ? "Creating…" : "Use template"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Active sequences */}
      <h2 className="seq__section-title">Your sequences</h2>
      {loading ? (
        <div className="seq__empty">Loading…</div>
      ) : sequences.length === 0 ? (
        <div className="seq__empty">No sequences yet. Start from a template above, or create one from scratch.</div>
      ) : (
        <div className="seq__list">
          {sequences.map((seq) => (
            <div key={seq._id} className="seq__card">
              <div className="seq__card-main">
                <div className="seq__card-top">
                  <span className="seq__card-name">{seq.name}</span>
                  <span className={`seq__status seq__status--${seq.status}`}>{seq.status}</span>
                  <span className="seq__chip">{TRIGGER_LABEL[seq.triggerType] || seq.triggerType}</span>
                </div>
                <p className="seq__card-desc">{seq.description || "No description."}</p>
                <div className="seq__card-meta">
                  <span>{seq.graph?.nodes?.length || 0} blocks</span>
                  <span>·</span>
                  <span>{seq.stats?.active || 0} active</span>
                  <span>·</span>
                  <span>{seq.stats?.completed || 0} completed</span>
                  {(seq.stats?.failed || 0) > 0 && (<><span>·</span><span className="seq__danger">{seq.stats.failed} failed</span></>)}
                </div>
              </div>
              <div className="seq__card-actions">
                <button className="seq__btn seq__btn--ghost" onClick={() => navigate(`/dashboard/sequences/${seq._id}/edit`)}>Edit</button>
                {seq.status === "active" ? (
                  <button className="seq__btn seq__btn--ghost" onClick={() => lifecycle(seq, "pause")} disabled={busy === seq._id}>Pause</button>
                ) : (
                  <button
                    className="seq__btn seq__btn--ghost"
                    onClick={() => lifecycle(seq, "activate")}
                    disabled={busy === seq._id || atCap}
                    title={atCap ? `Active limit reached (${activeLimit}). Pause one or upgrade to activate another.` : ""}
                  >
                    Activate
                  </button>
                )}
                <button className="seq__btn seq__btn--ghost" onClick={() => setDryRunFor(seq)}>Dry-run</button>
                <button className="seq__btn seq__btn--ghost" onClick={() => setEnrollFor(seq)} disabled={seq.status !== "active"} title={seq.status !== "active" ? "Activate first" : ""}>Enroll</button>
                <button className="seq__btn seq__btn--danger" onClick={() => remove(seq)} disabled={busy === seq._id}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {enrollFor && <EnrollModal seq={enrollFor} onClose={() => setEnrollFor(null)} onDone={load} />}
      {dryRunFor && <DryRunModal seq={dryRunFor} onClose={() => setDryRunFor(null)} />}
    </div>
  );
};

/* ─── Enroll modal ─── */
interface EnrollRow {
  status: string;
  nextRunAt?: string;
  hold?: { reason?: string | null; until?: string | null };
}
const HOLD_LABEL: Record<string, string> = {
  rate_cap: "daily message limit reached",
  quiet_hours: "quiet hours",
  kill_switch: "kill switch on",
};
const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
// One-line explanation of where an active enrollment is right now.
const describeEnrollment = (e: EnrollRow): string => {
  if (e.hold?.reason) return `Held — ${HOLD_LABEL[e.hold.reason] || e.hold.reason}; sends ${fmtTime(e.hold.until || e.nextRunAt)}`;
  if (e.nextRunAt && new Date(e.nextRunAt).getTime() > Date.now() + 5000) return `Waiting — next step ${fmtTime(e.nextRunAt)}`;
  return "Active — processing";
};

const EnrollModal: React.FC<{ seq: Sequence; onClose: () => void; onDone: () => void }> = ({ seq, onClose, onDone }) => {
  const [clients, setClients] = useState<ClientLite[]>([]);
  // clientId → current enrollment row, for clients active/running in this sequence.
  const [enrolled, setEnrolled] = useState<Record<string, EnrollRow>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const loadEnrollments = useCallback(async () => {
    try {
      const d = await authFetch(`/api/sequences/${seq._id}/enrollments`).then((r) => r.json());
      const map: Record<string, EnrollRow> = {};
      for (const e of d.enrollments || []) {
        if ((e.status === "active" || e.status === "running") && e.clientId) {
          map[String(e.clientId)] = { status: e.status, nextRunAt: e.nextRunAt, hold: e.hold };
        }
      }
      setEnrolled(map);
    } catch {
      /* leave the map empty — rows just show Enroll */
    }
  }, [seq._id]);

  useEffect(() => {
    authFetch("/api/clients").then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : d.clients || []));
    loadEnrollments();
  }, [loadEnrollments]);

  const enroll = async (clientId: string) => {
    setBusy(clientId);
    setMsg("");
    try {
      const res = await authFetch(`/api/sequences/${seq._id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json();
      setMsg(res.ok ? "Enrolled ✓" : d.error || "Failed");
      if (res.ok) { await loadEnrollments(); onDone(); }
    } finally {
      setBusy(null);
    }
  };

  const unenroll = async (clientId: string) => {
    setBusy(clientId);
    setMsg("");
    try {
      const res = await authFetch(`/api/sequences/${seq._id}/unenroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json();
      setMsg(res.ok ? "Unenrolled ✓" : d.error || "Failed");
      if (res.ok) { await loadEnrollments(); onDone(); }
    } finally {
      setBusy(null);
    }
  };

  const filtered = clients
    .filter((c) => c.name?.toLowerCase().includes(q.toLowerCase()) || c.email?.toLowerCase().includes(q.toLowerCase()))
    // Enrolled clients float to the top so current state is obvious at a glance.
    .sort((a, b) => (enrolled[b._id] ? 1 : 0) - (enrolled[a._id] ? 1 : 0));

  return (
    <div className="seq-modal__overlay" onClick={onClose}>
      <div className="seq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="seq-modal__head">
          <span>Enroll a client in “{seq.name}”</span>
          <button onClick={onClose}>✕</button>
        </div>
        <input className="seq-modal__search" placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
        {msg && <div className="seq-modal__msg">{msg}</div>}
        <div className="seq-modal__list">
          {filtered.slice(0, 50).map((c) => {
            const row = enrolled[c._id];
            const held = !!row?.hold?.reason;
            return (
              <div key={c._id} className="seq-modal__row">
                <div>
                  <div className="seq-modal__row-name">{c.name}</div>
                  <div className="seq-modal__row-sub">{c.email} · {c.intent} · {c.stage}</div>
                  {row && <div className={`seq-modal__row-state ${held ? "seq-modal__row-state--held" : ""}`}>{describeEnrollment(row)}</div>}
                </div>
                {row ? (
                  <div className="seq-modal__row-actions">
                    <span className={`seq-modal__badge ${held ? "seq-modal__badge--held" : ""}`}>{held ? "Held" : "Enrolled"}</span>
                    <button className="seq__btn seq__btn--danger" onClick={() => unenroll(c._id)} disabled={busy === c._id}>{busy === c._id ? "…" : "Unenroll"}</button>
                  </div>
                ) : (
                  <button className="seq__btn seq__btn--ghost" onClick={() => enroll(c._id)} disabled={busy === c._id}>{busy === c._id ? "…" : "Enroll"}</button>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="seq__empty">No clients found.</div>}
        </div>
      </div>
    </div>
  );
};

/* ─── Dry-run modal ─── */
const DryRunModal: React.FC<{ seq: Sequence; onClose: () => void }> = ({ seq, onClose }) => {
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [log, setLog] = useState<any[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    authFetch("/api/clients").then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : d.clients || []));
  }, []);

  const run = async (clientId?: string) => {
    setRunning(true);
    setLog(null);
    try {
      const res = await authFetch(`/api/sequences/${seq._id}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json();
      setLog(d.log || []);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="seq-modal__overlay" onClick={onClose}>
      <div className="seq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="seq-modal__head">
          <span>Dry-run “{seq.name}” (no messages are sent)</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="seq-modal__hint">Pick a client to simulate against, or run without one.</div>
        <div className="seq-modal__dryrun-controls">
          <button className="seq__btn seq__btn--ghost" onClick={() => run(undefined)} disabled={running}>Run (no client)</button>
          <select className="seq-modal__select" onChange={(e) => e.target.value && run(e.target.value)} defaultValue="">
            <option value="" disabled>Run against a client…</option>
            {clients.slice(0, 100).map((c) => <option key={c._id} value={c._id}>{c.name} ({c.intent})</option>)}
          </select>
        </div>
        {running && <div className="seq__empty">Simulating…</div>}
        {log && (
          <div className="seq-modal__log">
            {log.length === 0 && <div className="seq__empty">No steps logged.</div>}
            {log.map((l, i) => (
              <div key={i} className="seq-modal__log-row">
                <span className={`seq-modal__log-tag seq-modal__log-tag--${l.action}`}>{l.action}</span>
                <span className="seq-modal__log-type">{l.type}</span>
                <span className="seq-modal__log-detail">
                  {l.action === "would_send" ? `${l.channel} → ${l.to}: ${(l.body || "").slice(0, 80)}` : l.action === "would_wait" ? `${Math.round((l.ms || 0) / 3600000)}h` : l.detail || ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SequencesPage;
