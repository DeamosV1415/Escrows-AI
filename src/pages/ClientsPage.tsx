import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import "./ClientsPage.css";
import { authFetch } from "../utils/authFetch";
import ClientModal from "../components/dashboard/ClientModal";
import ClientDetailModal from "../components/dashboard/ClientDetailModal";

/* ─── Types ─── */
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

const STAGES = ["Lead", "Engaged", "Under Contract", "Closed"];

/* Transaction milestone labels — used on cards and the detail modal. */
const TXN_STATUS_LABEL: Record<string, string> = {
  active: "Escrow open",
  inspection: "Inspection",
  appraisal: "Appraisal",
  loan: "Loan",
  clear_to_close: "Clear to close",
  closed: "Closed",
};
const shortDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

const STAGE_COLORS: Record<string, string> = {
  Lead: "#6b8035",
  Engaged: "#b8860b",
  "Under Contract": "#c44",
  Closed: "#3d7a76",
};

const INTENT_DOT: Record<string, string> = {
  hot: "#4caf50",
  warm: "#f9a825",
  cold: "#bdbdbd",
};

/* ─── API helpers ─── */
const API = "/api/clients";

async function fetchClients(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`${API}?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch clients");
  return res.json();
}

async function createClient(data: Partial<Client>) {
  const res = await authFetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create client");
  return res.json();
}

async function updateClient(id: string, data: Partial<Client>) {
  const res = await authFetch(`${API}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update client");
  return res.json();
}

async function deleteClient(id: string) {
  const res = await authFetch(`${API}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete client");
  return res.json();
}

/* ─── Page ─── */
const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [intentFilter, setIntentFilter] = useState("all");
  const [sortBy, setSortBy] = useState("activity");

  // Modal states
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [detailClient, setDetailClient] = useState<Client | null>(null);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Deep-link from the global header search: open a client's detail modal, or
  // pre-fill the search box for a "see all" handoff.
  const location = useLocation();
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (stageFilter !== "all") params.stage = stageFilter;
      if (intentFilter !== "all") params.intent = intentFilter;
      if (sortBy === "name") params.sort = "name";
      else if (sortBy === "budget") params.sort = "budget";
      else if (sortBy === "created") params.sort = "created";
      // default is activity
      const data = await fetchClients(params);
      setClients(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, stageFilter, intentFilter, sortBy]);

  useEffect(() => {
    const timer = setTimeout(loadClients, 300); // debounce search
    return () => clearTimeout(timer);
  }, [loadClients]);

  // Listen for updates from the header's "New Lead" button
  useEffect(() => {
    const handler = () => loadClients();
    window.addEventListener("client-updated", handler);
    return () => window.removeEventListener("client-updated", handler);
  }, [loadClients]);

  // Read navigation state from the global search (openClientId or search handoff).
  useEffect(() => {
    const state = location.state as { openClientId?: string; search?: string } | null;
    if (!state) return;
    if (state.search) setSearch(state.search);
    if (state.openClientId) setPendingClientId(state.openClientId);
    window.history.replaceState({}, ""); // don't re-apply on refresh
  }, [location.state]);

  // Once the matching client is loaded, open its detail modal.
  useEffect(() => {
    if (!pendingClientId) return;
    const match = clients.find((c) => c._id === pendingClientId);
    if (match) {
      setDetailClient(match);
      setPendingClientId(null);
    }
  }, [pendingClientId, clients]);

  /* ─── CRUD handlers ─── */
  const handleCreate = async (data: Partial<Client>) => {
    await createClient(data);
    setAddModalOpen(false);
    loadClients();
  };

  const handleEdit = async (data: Partial<Client>) => {
    if (!editClient) return;
    await updateClient(editClient._id, data);
    setEditClient(null);
    setDetailClient(null);
    loadClients();
  };

  const handleDelete = async (id: string) => {
    await deleteClient(id);
    setDetailClient(null);
    loadClients();
  };

  const handleNotesUpdate = async (id: string, notes: string) => {
    await updateClient(id, { notes } as Partial<Client>);
    loadClients();
  };

  /* ─── Drag-and-Drop ─── */
  const onDragStart = (e: React.DragEvent, clientId: string) => {
    setDragId(clientId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", clientId);
    // Add a slight delay so the drag image shows
    const el = e.currentTarget as HTMLElement;
    el.classList.add("clients__card--dragging");
  };

  const onDragEnd = (e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.classList.remove("clients__card--dragging");
    setDragId(null);
    setDragOverStage(null);
  };

  const onDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stage);
  };

  const onDragLeave = () => {
    setDragOverStage(null);
  };

  const onDrop = async (e: React.DragEvent, newStage: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const clientId = e.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    if (!clientId) return;

    const client = clients.find((c) => c._id === clientId);
    if (!client || client.stage === newStage) return;

    // Optimistic update
    setClients((prev) =>
      prev.map((c) => (c._id === clientId ? { ...c, stage: newStage } : c)),
    );

    try {
      await updateClient(clientId, { stage: newStage } as Partial<Client>);
    } catch {
      loadClients(); // revert on failure
    }
  };

  /* ─── Group clients by stage ─── */
  const grouped: Record<string, Client[]> = {};
  STAGES.forEach((s) => (grouped[s] = []));
  clients.forEach((c) => {
    if (grouped[c.stage]) grouped[c.stage].push(c);
  });

  const totalCount = clients.length;

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
    return `$${val}`;
  };

  return (
    <div className="clients">
      {/* Header */}
      <div className="clients__header">
        <div>
          <h1 className="clients__title">Clients</h1>
          <p className="clients__count">
            {totalCount} client{totalCount !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          className="clients__add-btn"
          onClick={() => setAddModalOpen(true)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Client
        </button>
      </div>

      {/* Toolbar */}
      <div className="clients__toolbar">
        <div className="clients__search">
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
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="clients__search-input"
          />
        </div>

        <div className="clients__filters">
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="clients__select"
          >
            <option value="all">All Stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={intentFilter}
            onChange={(e) => setIntentFilter(e.target.value)}
            className="clients__select"
          >
            <option value="all">All Intents</option>
            <option value="hot">🟢 Hot</option>
            <option value="warm">🟡 Warm</option>
            <option value="cold">⚪ Cold</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="clients__select"
          >
            <option value="activity">Sort: Last Activity</option>
            <option value="name">Sort: Name</option>
            <option value="budget">Sort: Budget</option>
            <option value="created">Sort: Date Created</option>
          </select>
        </div>
      </div>

      {/* Pipeline Board */}
      {loading ? (
        <div className="clients__loading">
          <div className="clients__spinner" />
          <span>Loading clients...</span>
        </div>
      ) : (
        <div className="clients__board">
          {STAGES.map((stage) => (
            <div
              key={stage}
              className={`clients__column ${dragOverStage === stage ? "clients__column--drag-over" : ""}`}
              onDragOver={(e) => onDragOver(e, stage)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, stage)}
            >
              <div className="clients__column-header">
                <span
                  className="clients__stage-badge"
                  style={{ background: STAGE_COLORS[stage] }}
                >
                  {stage}
                </span>
                <span className="clients__stage-count">
                  {grouped[stage].length}
                </span>
              </div>

              <div className="clients__column-cards">
                {grouped[stage].length === 0 ? (
                  <div className="clients__empty">
                    <span>No clients</span>
                  </div>
                ) : (
                  grouped[stage].map((client) => (
                    <div
                      key={client._id}
                      className={`clients__card ${dragId === client._id ? "clients__card--dragging" : ""}`}
                      draggable
                      onDragStart={(e) => onDragStart(e, client._id)}
                      onDragEnd={onDragEnd}
                      onClick={() => setDetailClient(client)}
                    >
                      <div className="clients__card-top">
                        <span className="clients__card-name">
                          {client.name}
                        </span>
                        <span
                          className="clients__intent-dot"
                          style={{ background: INTENT_DOT[client.intent] }}
                          title={client.intent}
                        />
                      </div>
                      {client.company && (
                        <span className="clients__card-company">
                          {client.company}
                        </span>
                      )}

                      <div className="clients__card-details">
                        {client.email && (
                          <div className="clients__card-row">
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
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                              <polyline points="22,6 12,13 2,6" />
                            </svg>
                            <span>{client.email}</span>
                          </div>
                        )}
                        {client.phone && (
                          <div className="clients__card-row">
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
                              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 11.042 11.042 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 11.042 11.042 0 002.81.7A2 2 0 0122 16.92z" />
                            </svg>
                            <span>{client.phone}</span>
                          </div>
                        )}
                        <div className="clients__card-row">
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
                            <rect
                              x="3"
                              y="4"
                              width="18"
                              height="18"
                              rx="2"
                              ry="2"
                            />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          <span>Last: {timeAgo(client.updatedAt)}</span>
                        </div>
                      </div>

                      {client.budget > 0 && (
                        <div className="clients__card-budget">
                          {formatBudget(client.budget)}
                        </div>
                      )}

                      {client.transaction?.status &&
                        client.transaction.status !== "none" && (
                          <div className="clients__card-txn">
                            <span className="clients__txn-badge">
                              {TXN_STATUS_LABEL[client.transaction.status] ||
                                client.transaction.status}
                            </span>
                            {client.transaction.closingDate && (
                              <span className="clients__txn-date">
                                Closes {shortDate(client.transaction.closingDate)}
                              </span>
                            )}
                          </div>
                        )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Client Modal */}
      {addModalOpen && (
        <ClientModal
          onClose={() => setAddModalOpen(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* Edit Client Modal */}
      {editClient && (
        <ClientModal
          client={editClient}
          onClose={() => setEditClient(null)}
          onSubmit={handleEdit}
        />
      )}

      {/* Client Detail Modal */}
      {detailClient && (
        <ClientDetailModal
          client={detailClient}
          onClose={() => setDetailClient(null)}
          onEdit={(c) => {
            setDetailClient(null);
            setEditClient(c);
          }}
          onDelete={handleDelete}
          onNotesUpdate={handleNotesUpdate}
        />
      )}
    </div>
  );
};

export default ClientsPage;
