import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";
import "./GlobalSearch.css";

/* ─── Result shapes (mirror server/routes/search.js) ─── */
interface ClientResult { id: string; title: string; subtitle: string; intent: string; stage: string; }
interface InventoryResult { id: string; title: string; subtitle: string; kind: "folder" | "file"; folderId: string | null; clientId: string | null; }
interface InboxResult { contactIdentifier: string; title: string; snippet: string; channel: string; when: string | null; }
interface SequenceResult { id: string; title: string; subtitle: string; status: string; }
interface SearchResponse { query: string; clients: ClientResult[]; inventory: InventoryResult[]; inbox: InboxResult[]; sequences: SequenceResult[]; }

/* A flattened, navigable row — every result becomes one of these for keyboard nav. */
type FlatRow =
  | { category: "clients"; key: string; label: string; sub: string; data: ClientResult }
  | { category: "inventory"; key: string; label: string; sub: string; data: InventoryResult }
  | { category: "inbox"; key: string; label: string; sub: string; data: InboxResult }
  | { category: "sequences"; key: string; label: string; sub: string; data: SequenceResult };

const EMPTY: SearchResponse = { query: "", clients: [], inventory: [], inbox: [], sequences: [] };
const RECENTS_KEY = "globalSearchRecents";
const MAX_RECENTS = 3; // keep the empty-state dropdown compact

const CATEGORY_LABEL: Record<FlatRow["category"], string> = {
  clients: "Clients",
  inventory: "Inventory",
  inbox: "Inbox",
  sequences: "Sequences",
};

/* ─── Tiny inline icons (stroke = currentColor, matches the header set) ─── */
const Icon = ({ d, paths }: { d?: string; paths?: React.ReactNode }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : paths}
  </svg>
);
const CATEGORY_ICON: Record<FlatRow["category"], React.ReactNode> = {
  clients: <Icon paths={<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></>} />,
  inventory: <Icon d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />,
  inbox: <Icon paths={<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>} />,
  sequences: <Icon paths={<><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></>} />,
};

const DEBOUNCE_MS = 250;

const GlobalSearch: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState<FlatRow[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ─── Load recents from localStorage on mount ─── */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENTS_KEY);
      if (stored) setRecents(JSON.parse(stored).slice(0, MAX_RECENTS));
    } catch { /* ignore corrupt storage */ }
  }, []);

  /* ─── Global ⌘K / Ctrl-K to open & focus, Esc to close ─── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* ─── Close on outside click ─── */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /* ─── Debounced fetch ─── */
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(EMPTY); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) setResults(await res.json());
      } catch { /* network errors render as "no results" */ }
      finally { setLoading(false); }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  /* ─── Flatten grouped results into one ordered list for keyboard nav ─── */
  const flat = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    results.clients.forEach((c) => rows.push({ category: "clients", key: `c-${c.id}`, label: c.title, sub: c.subtitle, data: c }));
    results.inventory.forEach((i) => rows.push({ category: "inventory", key: `i-${i.id}`, label: i.title, sub: i.subtitle, data: i }));
    results.inbox.forEach((m) => rows.push({ category: "inbox", key: `m-${m.contactIdentifier}`, label: m.title, sub: m.snippet, data: m }));
    results.sequences.forEach((s) => rows.push({ category: "sequences", key: `s-${s.id}`, label: s.title, sub: s.subtitle, data: s }));
    return rows;
  }, [results]);

  // What we actually render: live results when typing, recents when the box is empty.
  const rows = query.trim() ? flat : recents;
  useEffect(() => { setActiveIndex(0); }, [query, results]);

  // Single place to write recents to state + storage.
  const persistRecents = useCallback((next: FlatRow[]) => {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setRecents(next);
  }, []);

  /* ─── Persist a row to recents (most-recent-first, deduped, capped) ─── */
  const remember = useCallback((row: FlatRow) => {
    setRecents((prev) => {
      const next = [row, ...prev.filter((r) => r.key !== row.key)].slice(0, MAX_RECENTS);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const removeRecent = useCallback((key: string) => {
    setRecents((prev) => {
      const next = prev.filter((r) => r.key !== key);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => persistRecents([]), [persistRecents]);

  /* ─── Deep-link a result to its home page ─── */
  const openResult = useCallback((row: FlatRow) => {
    remember(row);
    setOpen(false);
    setQuery("");
    switch (row.category) {
      case "clients":
        navigate("/dashboard/clients", { state: { openClientId: row.data.id } });
        break;
      case "inventory":
        navigate("/dashboard/inventory", { state: { folderId: row.data.folderId, clientId: row.data.clientId } });
        break;
      case "inbox":
        navigate("/dashboard/inbox", { state: { conversationId: row.data.contactIdentifier } });
        break;
      case "sequences":
        navigate(`/dashboard/sequences/${row.data.id}/edit`);
        break;
    }
  }, [navigate, remember]);

  /* "See all in X" → hand off to that page's own specialized search. */
  const seeAll = useCallback((category: FlatRow["category"]) => {
    const q = query.trim();
    setOpen(false);
    if (category === "clients") navigate("/dashboard/clients", { state: { search: q } });
    else if (category === "inventory") navigate("/dashboard/inventory", { state: { search: q } });
    else if (category === "inbox") navigate("/dashboard/inbox", { state: { search: q } });
    else navigate("/dashboard/sequences");
  }, [navigate, query]);

  /* ─── Arrow / Enter navigation within the dropdown ─── */
  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && rows[activeIndex]) { e.preventDefault(); openResult(rows[activeIndex]); }
  };

  // Group the live rows by category for rendering (keeps section headers + "see all").
  const grouped = useMemo(() => {
    const g: Record<FlatRow["category"], FlatRow[]> = { clients: [], inventory: [], inbox: [], sequences: [] };
    flat.forEach((r) => g[r.category].push(r));
    return g;
  }, [flat]);

  const hasQuery = !!query.trim();
  const noResults = hasQuery && !loading && flat.length === 0;

  return (
    <div className="global-search" ref={containerRef}>
      <div className="dashboard-header__search global-search__bar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          placeholder="Search clients, files, messages, sequences…"
          className="dashboard-header__search-input"
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
        />
        <kbd className="dashboard-header__search-kbd">⌘K</kbd>
      </div>

      {open && (
        <div className="global-search__dropdown" id="global-search-results" role="listbox">
          {/* Empty box → recents / quick actions */}
          {!hasQuery && (
            <>
              {recents.length > 0 && (
                <div className="global-search__group">
                  <div className="global-search__group-title">
                    Recent
                    <button className="global-search__see-all" onMouseDown={(e) => e.preventDefault()} onClick={clearRecents}>
                      Clear all
                    </button>
                  </div>
                  {recents.map((row, idx) => (
                    <ResultRow key={row.key} row={row} active={idx === activeIndex}
                      onMouseEnter={() => setActiveIndex(idx)} onClick={() => openResult(row)}
                      onDelete={() => removeRecent(row.key)} />
                  ))}
                </div>
              )}
              <div className="global-search__group">
                <div className="global-search__group-title">Quick actions</div>
                <div className="global-search__chips">
                  <button className="global-search__chip" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setOpen(false); window.dispatchEvent(new Event("open-new-lead")); }}>
                    ＋ New Lead
                  </button>
                  <button className="global-search__chip" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setOpen(false); navigate("/dashboard/inbox"); }}>
                    ✉️ Inbox
                  </button>
                  <button className="global-search__chip" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setOpen(false); navigate("/dashboard/sequences"); }}>
                    🔄 Sequences
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Live results, grouped */}
          {hasQuery && loading && <div className="global-search__status">Searching…</div>}
          {noResults && <div className="global-search__status">No results for “{query.trim()}”</div>}

          {hasQuery && !loading && flat.length > 0 && (
            <div id="global-search-list">
              {(Object.keys(grouped) as FlatRow["category"][]).map((cat) =>
                grouped[cat].length === 0 ? null : (
                  <div className="global-search__group" key={cat}>
                    <div className="global-search__group-title">
                      <span className="global-search__group-icon">{CATEGORY_ICON[cat]}</span>
                      {CATEGORY_LABEL[cat]}
                      <button className="global-search__see-all" onMouseDown={(e) => e.preventDefault()} onClick={() => seeAll(cat)}>
                        See all →
                      </button>
                    </div>
                    {grouped[cat].map((row) => {
                      const idx = flat.indexOf(row);
                      return (
                        <ResultRow key={row.key} row={row} active={idx === activeIndex}
                          onMouseEnter={() => setActiveIndex(idx)} onClick={() => openResult(row)} />
                      );
                    })}
                  </div>
                ),
              )}
            </div>
          )}

          <div className="global-search__footer">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── A single result row ─── */
/* Rendered as a div (not a button) so recents can nest a delete button inside. */
const ResultRow: React.FC<{
  row: FlatRow; active: boolean; onMouseEnter: () => void; onClick: () => void; onDelete?: () => void;
}> = ({ row, active, onMouseEnter, onClick, onDelete }) => (
  <div
    className={`global-search__row ${active ? "global-search__row--active" : ""}`}
    role="option"
    aria-selected={active}
    tabIndex={-1}
    onMouseEnter={onMouseEnter}
    onMouseDown={(e) => e.preventDefault()} // keep input focus so Enter still works
    onClick={onClick}
  >
    <span className="global-search__row-icon">{CATEGORY_ICON[row.category]}</span>
    <span className="global-search__row-text">
      <span className="global-search__row-label">{row.label}</span>
      {row.sub && <span className="global-search__row-sub">{row.sub}</span>}
    </span>
    {onDelete && (
      <button
        className="global-search__row-delete"
        aria-label={`Remove ${row.label} from recents`}
        title="Remove from recent"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <Icon paths={<><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></>} />
      </button>
    )}
  </div>
);

export default GlobalSearch;
