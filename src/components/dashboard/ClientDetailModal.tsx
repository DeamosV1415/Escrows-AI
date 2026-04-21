import React, { useState, useEffect } from "react";
import "./ClientDetailModal.css";

interface Client {
  _id: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  stage: string;
  intent: "hot" | "warm" | "cold";
  budget: number;
  requirements: string;
  nextAction: string;
  nextActionPriority: "high" | "medium" | "low";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  client: Client;
  onClose: () => void;
  onEdit: (client: Client) => void;
  onDelete: (id: string) => void;
  onNotesUpdate: (id: string, notes: string) => Promise<void>;
}

const TABS = [
  {
    key: "overview",
    label: "Overview",
    icon: (
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
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    key: "emails",
    label: "Emails",
    icon: (
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
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
  },
  {
    key: "inventory",
    label: "Inventory & Docs",
    icon: (
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
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    key: "activity",
    label: "Activity Log",
    icon: (
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
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

const STAGE_COLORS: Record<string, string> = {
  Lead: "#6b8035",
  Engaged: "#b8860b",
  "Under Contract": "#c44",
  Closed: "#3d7a76",
};

const INTENT_LABELS: Record<string, { emoji: string; label: string }> = {
  hot: { emoji: "🟢", label: "Hot" },
  warm: { emoji: "🟡", label: "Warm" },
  cold: { emoji: "⚪", label: "Cold" },
};

const ClientDetailModal: React.FC<Props> = ({
  client,
  onClose,
  onEdit,
  onDelete,
  onNotesUpdate,
}) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [notes, setNotes] = useState(client.notes || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Reset saved state when notes change
  useEffect(() => {
    setSaved(false);
  }, [notes]);

  const handleSaveNotes = async () => {
    try {
      setSaving(true);
      await onNotesUpdate(client._id, notes);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const formatBudget = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return val > 0 ? `$${val}` : "—";
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="detail-modal__header">
          <div className="detail-modal__header-left">
            <h2 className="detail-modal__name">{client.name}</h2>
            {client.company && (
              <p className="detail-modal__company">{client.company}</p>
            )}
            <div className="detail-modal__badges">
              <span
                className="detail-modal__stage-badge"
                style={{ background: STAGE_COLORS[client.stage] }}
              >
                {client.stage}
              </span>
              <span className="detail-modal__intent-badge">
                {INTENT_LABELS[client.intent]?.emoji}{" "}
                {INTENT_LABELS[client.intent]?.label}
              </span>
            </div>
          </div>
          <div className="detail-modal__header-right">
            <button
              className="detail-modal__edit-btn"
              onClick={() => onEdit(client)}
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
            <button
              className="detail-modal__delete-btn"
              onClick={() => setShowDeleteConfirm(true)}
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
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Delete
            </button>
            <button className="detail-modal__close" onClick={onClose}>
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="detail-modal__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`detail-modal__tab ${activeTab === tab.key ? "detail-modal__tab--active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="detail-modal__content">
          {activeTab === "overview" && (
            <div className="detail-modal__overview">
              {/* Contact Info Grid */}
              <div className="detail-modal__info-grid">
                <div className="detail-modal__info-item">
                  <span className="detail-modal__info-label">Email</span>
                  <span className="detail-modal__info-value">
                    {client.email}
                  </span>
                </div>
                <div className="detail-modal__info-item">
                  <span className="detail-modal__info-label">Phone</span>
                  <span className="detail-modal__info-value">
                    {client.phone || "—"}
                  </span>
                </div>
                <div className="detail-modal__info-item">
                  <span className="detail-modal__info-label">Budget</span>
                  <span className="detail-modal__info-value detail-modal__info-value--budget">
                    {formatBudget(client.budget)}
                  </span>
                </div>
                <div className="detail-modal__info-item">
                  <span className="detail-modal__info-label">
                    Last Activity
                  </span>
                  <span className="detail-modal__info-value">
                    {formatDate(client.updatedAt)}
                  </span>
                </div>
                <div className="detail-modal__info-item">
                  <span className="detail-modal__info-label">Created</span>
                  <span className="detail-modal__info-value">
                    {formatDate(client.createdAt)}
                  </span>
                </div>
              </div>

              {/* Requirements */}
              {client.requirements && (
                <div className="detail-modal__section">
                  <h3 className="detail-modal__section-title">Requirements</h3>
                  <p className="detail-modal__section-text">
                    {client.requirements}
                  </p>
                </div>
              )}

              {/* Next Action */}
              {client.nextAction && (
                <div className="detail-modal__section">
                  <h3 className="detail-modal__section-title">
                    Next Action
                    {client.nextActionPriority && (
                      <span
                        className={`detail-modal__priority-badge detail-modal__priority-badge--${client.nextActionPriority}`}
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontWeight: 500,
                          background:
                            client.nextActionPriority === "high"
                              ? "rgba(204,68,68,0.12)"
                              : client.nextActionPriority === "medium"
                                ? "rgba(249,168,37,0.12)"
                                : "rgba(76,175,80,0.12)",
                          color:
                            client.nextActionPriority === "high"
                              ? "#c44"
                              : client.nextActionPriority === "medium"
                                ? "#b8860b"
                                : "#4caf50",
                        }}
                      >
                        {client.nextActionPriority}
                      </span>
                    )}
                  </h3>
                  <p className="detail-modal__section-text">
                    {client.nextAction}
                  </p>
                </div>
              )}

              {/* Notes */}
              <div className="detail-modal__section">
                <h3 className="detail-modal__section-title">Notes</h3>
                <textarea
                  className="detail-modal__notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this client..."
                  rows={5}
                />
                <button
                  className="detail-modal__save-notes"
                  onClick={handleSaveNotes}
                  disabled={saving}
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
                    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  {saving ? "Saving..." : saved ? "Saved ✓" : "Save Notes"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "emails" && (
            <div className="detail-modal__placeholder">
              <div className="detail-modal__placeholder-icon">
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
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <h3>Emails</h3>
              <p>
                This tab will show all email conversations with {client.name}{" "}
                once the Inbox feature is connected.
              </p>
            </div>
          )}

          {activeTab === "inventory" && (
            <div className="detail-modal__placeholder">
              <div className="detail-modal__placeholder-icon">
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
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <h3>Inventory & Documents</h3>
              <p>
                Properties and documents associated with {client.name} will
                appear here once the Inventory feature is built.
              </p>
            </div>
          )}

          {activeTab === "activity" && (
            <div className="detail-modal__placeholder">
              <div className="detail-modal__placeholder-icon">
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
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h3>Activity Log</h3>
              <p>
                A complete timeline of all interactions with {client.name} will
                be tracked here automatically.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Delete Client Confirmation Modal ═══ */}
      {showDeleteConfirm && (
        <div
          className="detail-modal__confirm-overlay"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="detail-modal__confirm-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-modal__confirm-header">
              <h3>Delete Client</h3>
              <button
                className="detail-modal__close"
                onClick={() => setShowDeleteConfirm(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="detail-modal__confirm-body">
              <p>Are you sure you want to delete <strong>{client.name}</strong>? This action cannot be undone.</p>
              <div className="detail-modal__confirm-actions">
                <button
                  className="detail-modal__confirm-cancel"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="detail-modal__confirm-delete"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    onDelete(client._id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDetailModal;
