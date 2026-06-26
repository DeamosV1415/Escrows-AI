import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";
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
  transaction?: {
    status?: string;
    contractDate?: string | null;
    inspectionDate?: string | null;
    appraisalDate?: string | null;
    loanContingencyDate?: string | null;
    closingDate?: string | null;
  };
}

const TXN_STATUS_LABEL: Record<string, string> = {
  none: "Not started",
  active: "Escrow open",
  inspection: "Inspection",
  appraisal: "Appraisal",
  loan: "Loan",
  clear_to_close: "Clear to close",
  closed: "Closed",
};
const TXN_DATE_LABELS: { key: string; label: string }[] = [
  { key: "contractDate", label: "Contract" },
  { key: "inspectionDate", label: "Inspection" },
  { key: "appraisalDate", label: "Appraisal" },
  { key: "loanContingencyDate", label: "Loan contingency" },
  { key: "closingDate", label: "Closing" },
];
const fmtTxnDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

interface DocRequest {
  _id: string;
  docName: string;
  status: "pending" | "received";
  createdAt: string;
  receivedAt?: string | null;
}

interface InventoryItem {
  _id: string;
  clientId: string;
  name: string;
  type: "folder" | "file";
  mimeType: string;
  size: number;
  parentId: string | null;
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

/* ─── Helpers ─── */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function fileTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const FILE_EXT_COLORS: Record<string, string> = {
  pdf: "#e74c3c",
  doc: "#2b579a",
  docx: "#2b579a",
  xls: "#217346",
  xlsx: "#217346",
  png: "#f39c12",
  jpg: "#e67e22",
  jpeg: "#e67e22",
  csv: "#3d7a76",
  txt: "#888",
};

const ClientDetailModal: React.FC<Props> = ({
  client,
  onClose,
  onEdit,
  onDelete,
  onNotesUpdate,
}) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [notes, setNotes] = useState(client.notes || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Inventory state
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);

  // Sequence-requested documents (request_documents / wait_for_document)
  const [docRequests, setDocRequests] = useState<DocRequest[]>([]);
  const [receivingId, setReceivingId] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Fetch inventory items for this client when inventory tab is opened
  const loadInventory = useCallback(async () => {
    if (inventoryLoaded) return;
    setInventoryLoading(true);
    try {
      const res = await authFetch(`/api/inventory?clientId=${client._id}`);
      if (res.ok) {
        const data = await res.json();
        setInventoryItems(data);
      }
    } catch (err) {
      console.error("Failed to fetch inventory:", err);
    } finally {
      setInventoryLoading(false);
      setInventoryLoaded(true);
    }
  }, [client._id, inventoryLoaded]);

  const loadDocRequests = useCallback(async () => {
    try {
      const res = await authFetch(`/api/sequences/document-requests?clientId=${client._id}`);
      if (res.ok) {
        const data = await res.json();
        setDocRequests(data.requests || []);
      }
    } catch {
      /* non-critical */
    }
  }, [client._id]);

  useEffect(() => {
    if (activeTab === "inventory") {
      loadInventory();
      loadDocRequests();
    }
  }, [activeTab, loadInventory, loadDocRequests]);

  const markReceived = async (id: string) => {
    setReceivingId(id);
    try {
      const res = await authFetch(`/api/sequences/document-requests/${id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) await loadDocRequests();
    } finally {
      setReceivingId(null);
    }
  };

  const handleGoToInventory = () => {
    onClose();
    navigate("/dashboard/inventory", { state: { search: client.name } });
  };

  const handleOpenFolder = (item: InventoryItem) => {
    onClose();
    navigate("/dashboard/inventory", {
      state: { folderId: item._id, clientId: item.clientId },
    });
  };

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

              {/* Transaction / escrow — shown once a deal is under contract or has a status */}
              {(client.stage === "Under Contract" ||
                client.stage === "Closed" ||
                (client.transaction?.status && client.transaction.status !== "none")) && (
                <div className="detail-modal__section">
                  <h3 className="detail-modal__section-title">
                    Transaction
                    <span className="detail-modal__txn-status">
                      {TXN_STATUS_LABEL[client.transaction?.status || "none"] ||
                        client.transaction?.status}
                    </span>
                  </h3>
                  <div className="detail-modal__txn-grid">
                    {TXN_DATE_LABELS.map((d) => (
                      <div key={d.key} className="detail-modal__txn-item">
                        <span className="detail-modal__txn-label">{d.label}</span>
                        <span className="detail-modal__txn-value">
                          {fmtTxnDate(
                            client.transaction?.[d.key as keyof typeof client.transaction] as string | null | undefined,
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
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
            <div className="detail-modal__inventory">
              {/* Sequence-requested documents (Contract-to-Close etc.) */}
              {docRequests.length > 0 && (
                <div className="detail-modal__docreq">
                  <div className="detail-modal__docreq-title">Requested documents</div>
                  {docRequests.map((r) => (
                    <div key={r._id} className="detail-modal__docreq-row">
                      <div>
                        <span className="detail-modal__docreq-name">{r.docName}</span>
                        <span className={`detail-modal__docreq-status detail-modal__docreq-status--${r.status}`}>
                          {r.status === "received" ? "Received" : "Pending"}
                        </span>
                      </div>
                      {r.status === "pending" ? (
                        <button
                          className="detail-modal__docreq-btn"
                          onClick={() => markReceived(r._id)}
                          disabled={receivingId === r._id}
                        >
                          {receivingId === r._id ? "…" : "Mark received"}
                        </button>
                      ) : (
                        <span className="detail-modal__docreq-check">✓</span>
                      )}
                    </div>
                  ))}
                  <p className="detail-modal__docreq-hint">
                    Marking a document received advances any sequence waiting on it.
                  </p>
                </div>
              )}

              {inventoryLoading ? (
                <div className="detail-modal__inv-loading">
                  <div className="detail-modal__inv-spinner" />
                  <span>Loading documents...</span>
                </div>
              ) : inventoryItems.length === 0 ? (
                /* ─── Empty State ─── */
                <div className="detail-modal__inv-empty">
                  <div className="detail-modal__inv-empty-icon">
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <h4>No documents yet</h4>
                  <p>
                    Upload files and organize documents for {client.name} in the
                    Inventory.
                  </p>
                  <button
                    className="detail-modal__inv-goto-btn"
                    onClick={handleGoToInventory}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    Go to Inventory
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              ) : (
                /* ─── Items List ─── */
                <>
                  <div className="detail-modal__inv-header">
                    <span className="detail-modal__inv-count">
                      {inventoryItems.length} item{inventoryItems.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="detail-modal__inv-list">
                    {inventoryItems.slice(0, 5).map((item) => {
                      const ext = getFileExtension(item.name);
                      const color =
                        item.type === "folder"
                          ? "var(--olive-500, #6b8035)"
                          : FILE_EXT_COLORS[ext] || "var(--gold-accent, #b8860b)";
                      return (
                        <div
                          key={item._id}
                          className={`detail-modal__inv-item ${item.type === "folder" ? "detail-modal__inv-item--clickable" : ""}`}
                          onClick={item.type === "folder" ? () => handleOpenFolder(item) : undefined}
                        >
                          <div
                            className="detail-modal__inv-item-icon"
                            style={{ color }}
                          >
                            {item.type === "folder" ? (
                              <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                              </svg>
                            ) : (
                              <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                            )}
                          </div>
                          <div className="detail-modal__inv-item-info">
                            <span className="detail-modal__inv-item-name">
                              {item.name}
                            </span>
                            <span className="detail-modal__inv-item-meta">
                              {item.type === "folder"
                                ? "Folder"
                                : ext.toUpperCase() || "File"}
                              {item.type === "file" && item.size > 0 &&
                                ` · ${formatFileSize(item.size)}`}
                              {" · "}
                              {fileTimeAgo(item.updatedAt)}
                            </span>
                          </div>
                          {item.type === "file" && ext && (
                            <span
                              className="detail-modal__inv-item-badge"
                              style={{
                                background: `${color}14`,
                                color,
                              }}
                            >
                              {ext.toUpperCase()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {inventoryItems.length > 5 && (
                    <p className="detail-modal__inv-more">
                      +{inventoryItems.length - 5} more item
                      {inventoryItems.length - 5 !== 1 ? "s" : ""}
                    </p>
                  )}
                  <button
                    className="detail-modal__inv-view-all"
                    onClick={handleGoToInventory}
                  >
                    View All in Inventory
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </>
              )}
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
