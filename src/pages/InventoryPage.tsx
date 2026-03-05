import { useState, useEffect, useCallback, useRef } from "react";
import "./InventoryPage.css";

/* ─── Types ─── */
interface InventoryItem {
  _id: string;
  clientId: string;
  name: string;
  type: "folder" | "file";
  mimeType: string;
  size: number;
  parentId: string | null;
  storagePath: string;
  createdAt: string;
  updatedAt: string;
}

interface Crumb {
  _id: string;
  name: string;
  type: string;
}

/* ─── API ─── */
const API = "/api/inventory";

async function fetchItems(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch inventory");
  return res.json();
}

async function fetchAncestors(id: string): Promise<Crumb[]> {
  const res = await fetch(`${API}/${id}/ancestors`);
  if (!res.ok) throw new Error("Failed to fetch ancestors");
  return res.json();
}

async function createFolder(data: {
  clientId: string;
  name: string;
  parentId?: string | null;
}) {
  const res = await fetch(`${API}/folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create folder");
  return res.json();
}

async function uploadFile(formData: FormData) {
  const res = await fetch(`${API}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to upload file");
  return res.json();
}

async function renameItem(id: string, name: string) {
  const res = await fetch(`${API}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to rename");
  return res.json();
}

async function deleteItem(id: string) {
  const res = await fetch(`${API}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
  return res.json();
}

async function fetchCounts(
  parentIds: string[],
): Promise<Record<string, { files: number; folders: number }>> {
  if (parentIds.length === 0) return {};
  const res = await fetch(`${API}/counts?parentIds=${parentIds.join(",")}`);
  if (!res.ok) return {};
  return res.json();
}

/* ─── Helpers ─── */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function timeAgo(dateStr: string): string {
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

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function isPreviewable(item: InventoryItem): boolean {
  const ext = getFileExtension(item.name);
  const mime = item.mimeType || "";
  return (
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    ["xlsx", "xls"].includes(ext) ||
    ["docx", "doc"].includes(ext)
  );
}

/* ─── SVG Icons ─── */
const FolderIcon = () => (
  <svg
    className="inv__card-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const FileIcon = ({ ext }: { ext: string }) => {
  const colors: Record<string, string> = {
    pdf: "#e74c3c",
    doc: "#2b579a",
    docx: "#2b579a",
    xls: "#217346",
    xlsx: "#217346",
    png: "#f39c12",
    jpg: "#e67e22",
    jpeg: "#e67e22",
  };
  const color = colors[ext] || "var(--gold-accent)";

  return (
    <svg
      className="inv__card-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fill={color}
        stroke="none"
        fontSize="5"
        fontWeight="700"
        fontFamily="var(--font-body)"
      >
        {ext.toUpperCase().slice(0, 4)}
      </text>
    </svg>
  );
};

const SearchIcon = () => (
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
);

const PlusIcon = () => (
  <svg
    width="15"
    height="15"
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
);

const UploadIcon = () => (
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
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const EditIcon = () => (
  <svg
    width="13"
    height="13"
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
);

const TrashIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

const CloseIcon = () => (
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
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChevronRight = () => <span className="inv__crumb-sep">›</span>;

/* ═══════════════════════════════════════════════════
   InventoryPage Component
   ═══════════════════════════════════════════════════ */

const InventoryPage: React.FC = () => {
  // State
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Navigation — breadcrumb trail
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Crumb[]>([]);

  // Modals
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile_, setUploadFile_] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  // Preview
  const [previewItem, setPreviewItem] = useState<InventoryItem | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string>("");

  // Folder metadata counts
  const [folderCounts, setFolderCounts] = useState<
    Record<string, { files: number; folders: number }>
  >({});

  // Track the clientId from the first root-level folder (for creating subfolders)
  const [activeClientId, setActiveClientId] = useState<string | null>(null);

  /* ─── Load items ─── */
  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};

      if (search.trim()) {
        params.search = search.trim();
        // When searching, include clientId if inside a client folder
        if (activeClientId) params.clientId = activeClientId;
      } else {
        if (currentFolderId) {
          params.parentId = currentFolderId;
        } else {
          params.parentId = "null";
        }
      }

      const data = await fetchItems(params);
      setItems(data);

      // Set active client id from first item
      if (!activeClientId && data.length > 0) {
        setActiveClientId(data[0].clientId);
      }

      // Fetch counts for folders
      const folderIds = data
        .filter((d: InventoryItem) => d.type === "folder")
        .map((d: InventoryItem) => d._id);
      if (folderIds.length > 0) {
        const counts = await fetchCounts(folderIds);
        setFolderCounts(counts);
      } else {
        setFolderCounts({});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, currentFolderId, activeClientId]);

  useEffect(() => {
    const timer = setTimeout(loadItems, 250);
    return () => clearTimeout(timer);
  }, [loadItems]);

  /* ─── Breadcrumbs ─── */
  const loadBreadcrumbs = useCallback(async () => {
    if (!currentFolderId) {
      setBreadcrumbs([]);
      return;
    }
    try {
      const ancestors = await fetchAncestors(currentFolderId);
      setBreadcrumbs(ancestors);
    } catch (err) {
      console.error(err);
    }
  }, [currentFolderId]);

  useEffect(() => {
    loadBreadcrumbs();
  }, [loadBreadcrumbs]);

  /* ─── Navigate into folder ─── */
  const openFolder = (item: InventoryItem) => {
    setSearch("");
    setCurrentFolderId(item._id);
    setActiveClientId(item.clientId);
  };

  const navigateToCrumb = (crumbId: string | null) => {
    setSearch("");
    setCurrentFolderId(crumbId);
  };

  /* ─── Create Folder ─── */
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    // Need a clientId: either from activeClientId or from the current folder context
    let clientId = activeClientId;

    if (!clientId && breadcrumbs.length > 0) {
      // Try fetching the root folder's clientId
      try {
        const res = await fetch(`${API}/${breadcrumbs[0]._id}`);
        const rootFolder = await res.json();
        clientId = rootFolder.clientId;
      } catch {}
    }

    if (!clientId) {
      alert("Please navigate into a client folder first to create subfolders.");
      return;
    }

    try {
      await createFolder({
        clientId,
        name: newFolderName.trim(),
        parentId: currentFolderId,
      });
      setNewFolderOpen(false);
      setNewFolderName("");
      loadItems();
    } catch (err) {
      console.error(err);
      alert("Failed to create folder.");
    }
  };

  /* ─── Upload ─── */
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!uploadFile_) return;

    let clientId = activeClientId;
    if (!clientId && breadcrumbs.length > 0) {
      try {
        const res = await fetch(`${API}/${breadcrumbs[0]._id}`);
        const rootFolder = await res.json();
        clientId = rootFolder.clientId;
      } catch {}
    }

    if (!clientId) {
      alert("Please navigate into a client folder first to upload files.");
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadFile_);
    formData.append("clientId", clientId);
    if (currentFolderId) formData.append("parentId", currentFolderId);

    try {
      await uploadFile(formData);
      setUploadOpen(false);
      setUploadFile_(null);
      loadItems();
    } catch (err) {
      console.error(err);
      alert("Failed to upload file.");
    }
  };

  const onDropHandler = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      setUploadFile_(e.dataTransfer.files[0]);
    }
  };

  /* ─── Rename ─── */
  const startRename = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(item._id);
    setRenameValue(item.name);
    setTimeout(() => renameRef.current?.select(), 50);
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      await renameItem(renamingId, renameValue.trim());
      setRenamingId(null);
      loadItems();
    } catch (err) {
      console.error(err);
    }
  };

  /* ─── Delete ─── */
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteItem(deleteTarget._id);
      setDeleteTarget(null);
      loadItems();
    } catch (err) {
      console.error(err);
      alert("Failed to delete item.");
    }
  };

  /* ─── Preview ─── */
  const closePreview = () => {
    setPreviewItem(null);
    setPreviewContent("");
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl("");
    }
  };

  const openPreview = async (item: InventoryItem) => {
    if (!isPreviewable(item)) return;

    setPreviewItem(item);
    setPreviewContent("");
    setPdfBlobUrl("");
    setPreviewLoading(true);

    const ext = getFileExtension(item.name);
    const mime = item.mimeType || "";

    // For images, we use the download URL directly
    if (mime.startsWith("image/")) {
      setPreviewLoading(false);
      return;
    }

    // For PDF, fetch as blob and create blob URL
    if (mime === "application/pdf") {
      try {
        const res = await fetch(`${API}/${item._id}/download`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
      } catch (err) {
        console.error(err);
      }
      setPreviewLoading(false);
      return;
    }

    // For Excel
    if (["xlsx", "xls"].includes(ext)) {
      try {
        const res = await fetch(`${API}/${item._id}/download`);
        const buf = await res.arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
        setPreviewContent(html);
      } catch (err) {
        console.error(err);
        setPreviewContent("<p>Failed to load Excel preview.</p>");
      }
      setPreviewLoading(false);
      return;
    }

    // For DOCX
    if (["docx", "doc"].includes(ext)) {
      try {
        const res = await fetch(`${API}/${item._id}/download`);
        const buf = await res.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        setPreviewContent(result.value);
      } catch (err) {
        console.error(err);
        setPreviewContent("<p>Failed to load document preview.</p>");
      }
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(false);
  };

  /* ─── Click handler ─── */
  const handleItemClick = (item: InventoryItem) => {
    if (renamingId === item._id) return;
    if (item.type === "folder") {
      openFolder(item);
    } else if (isPreviewable(item)) {
      openPreview(item);
    }
  };

  /* ─── Render ─── */
  return (
    <div className="inv">
      {/* Header */}
      <div className="inv__header">
        <div>
          <h1 className="inv__title">Smart Inventory</h1>
          <p className="inv__subtitle">
            Client assets organized automatically.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="inv__toolbar">
        <div className="inv__search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search files and folders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="inv__search-input"
          />
        </div>
        <div className="inv__toolbar-actions">
          <button
            className="inv__btn inv__btn--secondary"
            onClick={() => {
              setNewFolderName("");
              setNewFolderOpen(true);
            }}
          >
            <PlusIcon />
            New Folder
          </button>
          <button
            className="inv__btn inv__btn--primary"
            onClick={() => {
              setUploadFile_(null);
              setUploadOpen(true);
            }}
          >
            <UploadIcon />
            Upload
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      {(breadcrumbs.length > 0 || currentFolderId) && (
        <div className="inv__breadcrumbs">
          <button className="inv__crumb" onClick={() => navigateToCrumb(null)}>
            Root
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb._id} style={{ display: "contents" }}>
              <ChevronRight />
              <button
                className={`inv__crumb ${i === breadcrumbs.length - 1 ? "inv__crumb--active" : ""}`}
                onClick={() =>
                  i < breadcrumbs.length - 1
                    ? navigateToCrumb(crumb._id)
                    : undefined
                }
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="inv__loading">
          <div className="inv__spinner" />
          <span>Loading inventory...</span>
        </div>
      ) : (
        <div className="inv__grid">
          {items.length === 0 ? (
            <div className="inv__empty">
              <svg
                className="inv__empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              <h3 className="inv__empty-title">
                {search ? "No results found" : "This folder is empty"}
              </h3>
              <p className="inv__empty-desc">
                {search
                  ? "Try adjusting your search terms."
                  : currentFolderId
                    ? "Upload files or create subfolders to get started."
                    : "Client folders appear here automatically when you add clients."}
              </p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item._id}
                className={`inv__card inv__card--${item.type}`}
                onClick={() => handleItemClick(item)}
              >
                {/* Action buttons */}
                <div className="inv__card-actions">
                  <button
                    className="inv__card-action-btn"
                    title="Rename"
                    onClick={(e) => startRename(item, e)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    className="inv__card-action-btn inv__card-action-btn--delete"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(item);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>

                {/* Icon */}
                {item.type === "folder" ? (
                  <FolderIcon />
                ) : (
                  <FileIcon ext={getFileExtension(item.name)} />
                )}

                {/* Name */}
                {renamingId === item._id ? (
                  <input
                    ref={renameRef}
                    className="inv__rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span className="inv__card-name">{item.name}</span>
                )}

                {/* Badge + Meta */}
                <span className="inv__card-type-badge">
                  {item.type === "folder"
                    ? "Client folder"
                    : getFileExtension(item.name).toUpperCase() || "FILE"}
                </span>
                <span className="inv__card-meta">
                  {item.type === "folder" && folderCounts[item._id]
                    ? `${folderCounts[item._id].files} file${folderCounts[item._id].files !== 1 ? "s" : ""} · ${folderCounts[item._id].folders} folder${folderCounts[item._id].folders !== 1 ? "s" : ""}`
                    : item.type === "file" && item.size > 0
                      ? `${formatSize(item.size)} · ${timeAgo(item.updatedAt)}`
                      : timeAgo(item.updatedAt)}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══ New Folder Modal ═══ */}
      {newFolderOpen && (
        <div
          className="inv__modal-backdrop"
          onClick={() => setNewFolderOpen(false)}
        >
          <div className="inv__modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="inv__modal-close"
              onClick={() => setNewFolderOpen(false)}
            >
              <CloseIcon />
            </button>
            <h2 className="inv__modal-title">New Folder</h2>
            <input
              className="inv__folder-input"
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
            <div className="inv__modal-actions">
              <button
                className="inv__btn inv__btn--secondary"
                onClick={() => setNewFolderOpen(false)}
              >
                Cancel
              </button>
              <button
                className="inv__btn inv__btn--primary"
                onClick={handleCreateFolder}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Upload Modal ═══ */}
      {uploadOpen && (
        <div
          className="inv__modal-backdrop"
          onClick={() => setUploadOpen(false)}
        >
          <div className="inv__modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="inv__modal-close"
              onClick={() => setUploadOpen(false)}
            >
              <CloseIcon />
            </button>
            <h2 className="inv__modal-title">Upload Document</h2>

            {!uploadFile_ ? (
              <div
                className={`inv__dropzone ${dragActive ? "inv__dropzone--active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDropHandler}
                onClick={() => fileInputRef.current?.click()}
              >
                <svg
                  className="inv__dropzone-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p className="inv__dropzone-text">
                  <strong>Click to browse</strong> or drag and drop
                </p>
                <p className="inv__dropzone-hint">
                  PDF, DOCX, XLSX, JPG, PNG — up to 50 MB
                </p>
              </div>
            ) : (
              <div className="inv__upload-file-name">
                📄 {uploadFile_.name} ({formatSize(uploadFile_.size)})
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              onChange={(e) => {
                if (e.target.files?.[0]) setUploadFile_(e.target.files[0]);
              }}
            />

            <div className="inv__modal-actions">
              <button
                className="inv__btn inv__btn--secondary"
                onClick={() => {
                  setUploadOpen(false);
                  setUploadFile_(null);
                }}
              >
                Cancel
              </button>
              <button
                className="inv__btn inv__btn--primary"
                onClick={handleUpload}
                style={{ opacity: uploadFile_ ? 1 : 0.5 }}
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Delete Confirmation ═══ */}
      {deleteTarget && (
        <div
          className="inv__modal-backdrop"
          onClick={() => setDeleteTarget(null)}
        >
          <div className="inv__modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="inv__modal-close"
              onClick={() => setDeleteTarget(null)}
            >
              <CloseIcon />
            </button>
            <h2 className="inv__modal-title">Delete {deleteTarget.type}?</h2>
            <p className="inv__confirm-text">
              Are you sure you want to delete{" "}
              <strong>"{deleteTarget.name}"</strong>?
              {deleteTarget.type === "folder" &&
                " This will also delete all files and subfolders inside it."}
              <br />
              This action cannot be undone.
            </p>
            <div className="inv__modal-actions">
              <button
                className="inv__btn inv__btn--secondary"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="inv__btn inv__btn--danger"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Preview Modal ═══ */}
      {previewItem && (
        <div className="inv__preview-backdrop" onClick={closePreview}>
          <div className="inv__preview" onClick={(e) => e.stopPropagation()}>
            <div className="inv__preview-header">
              <span className="inv__preview-title">{previewItem.name}</span>
              <button className="inv__preview-close" onClick={closePreview}>
                <CloseIcon />
              </button>
            </div>

            <div className="inv__preview-body">
              {previewLoading ? (
                <div className="inv__loading">
                  <div className="inv__spinner" />
                  <span>Loading preview...</span>
                </div>
              ) : previewItem.mimeType === "application/pdf" && pdfBlobUrl ? (
                <iframe src={pdfBlobUrl} title={previewItem.name} />
              ) : previewItem.mimeType?.startsWith("image/") ? (
                <img
                  src={`${API}/${previewItem._id}/download`}
                  alt={previewItem.name}
                />
              ) : previewContent ? (
                ["xlsx", "xls"].includes(getFileExtension(previewItem.name)) ? (
                  <div
                    className="inv__preview-table-wrap"
                    dangerouslySetInnerHTML={{ __html: previewContent }}
                  />
                ) : (
                  <div
                    className="inv__preview-docx"
                    dangerouslySetInnerHTML={{ __html: previewContent }}
                  />
                )
              ) : (
                <div className="inv__preview-unsupported">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <p>Preview not available for this file type.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryPage;
