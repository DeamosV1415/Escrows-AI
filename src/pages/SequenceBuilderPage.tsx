import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { authFetch } from "../utils/authFetch";
import { useCopilotChat } from "../components/dashboard/CopilotChatContext";
import {
  BLOCK_META, FAMILY_COLOR, FAMILY_LABEL, handlesFor, newNodeId, MERGE_FIELDS,
  STAGES, INTENTS, PRIORITIES, TXN_STATUSES, TXN_DATE_FIELDS,
  type Family, type SeqGraph, type Sequence,
} from "../utils/sequenceMeta";
import "./SequenceBuilderPage.css";

type RFData = {
  blockType: string;
  family: Family;
  label: string;
  config: Record<string, any>;
  handles: string[];
  error?: boolean;
};

/* ───────────────────────── custom node ───────────────────────── */
function BlockNode({ data, selected }: NodeProps<Node<RFData>>) {
  const color = FAMILY_COLOR[data.family];
  const handles = data.handles;
  const isExit = data.family === "exit";
  const isTrigger = data.family === "trigger";
  const summary = summarize(data.blockType, data.config);
  const multi = handles.length > 1;
  return (
    <div
      className={`sbn sbn--${data.family} ${selected ? "sbn--sel" : ""} ${data.error ? "sbn--err" : ""} ${multi ? "sbn--branch" : ""}`}
      style={{ ["--fam" as string]: color } as React.CSSProperties}
    >
      {!isTrigger && <Handle type="target" position={Position.Top} className="sbn__handle sbn__handle--target" />}
      <div className="sbn__head">
        <span className="sbn__dot" />
        <span className="sbn__fam">{FAMILY_LABEL[data.family]}</span>
      </div>
      <div className="sbn__body">
        <div className="sbn__label">{data.label}</div>
        {summary && <div className="sbn__summary">{summary}</div>}
      </div>

      {/* Branch nodes get a labelled footer with one outcome port per column; the source
          handle sits on the bottom edge directly under its label (no floating pills). */}
      {!isExit && multi && (
        <div className="sbn__ports">
          {handles.map((h) => (
            <div key={h} className="sbn__port">
              <span className="sbn__port-label">{h}</span>
              <Handle
                type="source"
                id={h}
                position={Position.Bottom}
                className="sbn__handle sbn__handle--port"
                style={{ position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)" }}
              />
            </div>
          ))}
        </div>
      )}
      {/* Single-outcome nodes: one centred handle on the bottom edge. */}
      {!isExit && !multi && handles.length > 0 && (
        <Handle type="source" id={handles[0]} position={Position.Bottom} className="sbn__handle" />
      )}
    </div>
  );
}

function summarize(type: string, cfg: Record<string, any>): string {
  switch (type) {
    case "send_email": return cfg.subject ? `“${cfg.subject}”` : "no subject";
    case "send_whatsapp": return (cfg.body || "").slice(0, 40) || "empty";
    case "wait": return `${cfg.value ?? "?"} ${cfg.unit ?? ""}`;
    case "wait_for_reply": return `timeout ${cfg.timeout?.value ?? 3} ${cfg.timeout?.unit ?? "days"}`;
    case "condition": return `on ${cfg.field}`;
    case "wait_until": return `until ${(cfg.dateField || "").split(".")[1] || "date"}`;
    case "wait_for_document": return `doc · timeout ${cfg.timeout?.value ?? 5} ${cfg.timeout?.unit ?? "days"}`;
    case "request_documents": return cfg.docName || "document";
    case "stage_changed": return `→ ${cfg.toStage}`;
    case "schedule": return `${cfg.frequency} @ ${cfg.time}`;
    case "notify_broker": return (cfg.message || "").slice(0, 40);
    case "update_client": return Object.keys(cfg.set || {}).join(", ") || (cfg.appendNote ? "append note" : "—");
    case "end": return cfg.goal ? "goal ✓" : "stop";
    default: return "";
  }
}

/* ───────────────────────── dagre auto-layout ───────────────────────── */
function layout(nodes: Node<RFData>[], edges: Edge[]): Node<RFData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  const nodeH = (n: Node<RFData>) => ((n.data.handles?.length || 0) > 1 ? 128 : 92);
  g.setGraph({ rankdir: "TB", nodesep: 70, ranksep: 90 });
  nodes.forEach((n) => g.setNode(n.id, { width: 220, height: nodeH(n) }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - 110, y: p.y - nodeH(n) / 2 } };
  });
}

/* ───────────────────────── graph ⇄ React Flow ───────────────────────── */
function toRF(graph: SeqGraph): { nodes: Node<RFData>[]; edges: Edge[] } {
  const nodes = (graph.nodes || []).map((n) => ({
    id: n.id,
    type: "block",
    position: n.position || { x: 0, y: 0 },
    data: {
      blockType: n.type,
      family: n.family,
      label: BLOCK_META[n.type]?.label || n.type,
      config: n.config || {},
      handles: handlesFor(n.type, n.config || {}),
    } as RFData,
  }));
  const edges = (graph.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.handle,
    // outcome name is shown on the node's footer port, so the edge itself stays unlabelled
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return { nodes, edges };
}

function fromRF(nodes: Node<RFData>[], edges: Edge[]): SeqGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.blockType,
      family: n.data.family,
      config: n.data.config,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      handle: (e.sourceHandle as string) || "out",
    })),
  };
}

const nodeTypes = { block: BlockNode };

const clampW = (w: number, min: number, max: number) => Math.min(max, Math.max(min, w || min));

/* ───────────────────────── builder ───────────────────────── */
function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { openCopilot } = useCopilotChat();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<RFData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [seq, setSeq] = useState<Sequence | null>(null);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ message: string; nodeId?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [otherSeqs, setOtherSeqs] = useState<Sequence[]>([]);
  // Collapsible block palette — only takes effect on the phone layout (CSS keeps
  // the palette expanded on desktop regardless of this flag).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Freely resizable side panels (palette on the left, config on the right). Persisted.
  const [paletteW, setPaletteW] = useState(() => clampW(Number(localStorage.getItem("sbPaletteW")) || 210, 160, 440));
  const [configW, setConfigW] = useState(() => clampW(Number(localStorage.getItem("sbConfigW")) || 320, 240, 600));

  const startResize = (which: "palette" | "config") => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === "palette" ? paletteW : configW;
    let latest = startW;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (which === "palette") {
        latest = clampW(startW + dx, 160, 440);
        setPaletteW(latest);
      } else {
        latest = clampW(startW - dx, 240, 600); // right panel grows as you drag left
        setConfigW(latest);
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("sb--resizing");
      localStorage.setItem(which === "palette" ? "sbPaletteW" : "sbConfigW", String(latest));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.classList.add("sb--resizing");
  };

  const loadSequence = useCallback(() => {
    return authFetch(`/api/sequences/${id}`).then((r) => r.json()).then((s) => {
      setSeq(s);
      setName(s.name);
      const rf = toRF(s.graph);
      setNodes(rf.nodes);
      setEdges(rf.edges);
    });
  }, [id, setNodes, setEdges]);

  useEffect(() => {
    loadSequence();
    authFetch("/api/sequences").then((r) => r.json()).then((d) => setOtherSeqs((d.sequences || []).filter((x: Sequence) => x._id !== id)));
  }, [id, loadSequence]);

  // When the Sequences sub-agent edits THIS sequence, reload the canvas so the broker
  // reviews the AI's changes in place (its draft was saved server-side under the same id).
  useEffect(() => {
    const onGenerated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sequenceId?: string } | undefined;
      if (detail?.sequenceId && detail.sequenceId === id) {
        loadSequence();
        setSavedMsg("Updated by AI — review and save");
        setTimeout(() => setSavedMsg(""), 4000);
      }
    };
    window.addEventListener("sequence-generated", onGenerated);
    return () => window.removeEventListener("sequence-generated", onGenerated);
  }, [id, loadSequence]);

  const onConnect = useCallback(
    (c: Connection) => {
      // one edge per (source, handle): replace any existing edge on that handle
      setEdges((eds) => {
        const pruned = eds.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle));
        return addEdge(
          { ...c, id: `e_${c.source}_${c.sourceHandle}_${c.target}_${Date.now().toString(36)}`, markerEnd: { type: MarkerType.ArrowClosed } },
          pruned,
        );
      });
    },
    [setEdges],
  );

  const addBlock = (type: string) => {
    const meta = BLOCK_META[type];
    if (!meta) return;
    if (meta.family === "trigger" && nodes.some((n) => n.data.family === "trigger")) {
      setSavedMsg("A sequence can only have one trigger.");
      setTimeout(() => setSavedMsg(""), 2500);
      return;
    }
    const cfg = meta.defaultConfig();
    const nid = newNodeId(type);
    const pos = { x: 120 + Math.random() * 80, y: 80 + nodes.length * 30 };
    setNodes((ns) => ns.concat({
      id: nid, type: "block", position: pos,
      data: { blockType: type, family: meta.family, label: meta.label, config: cfg, handles: handlesFor(type, cfg) },
    }));
    setSelectedId(nid);
  };

  const updateNodeConfig = (nodeId: string, config: Record<string, any>) => {
    const type = nodes.find((n) => n.id === nodeId)?.data.blockType;
    const newHandles = type ? handlesFor(type, config) : ["out"];
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config, handles: newHandles } } : n)));
    // prune edges whose handle no longer exists on this node
    setEdges((eds) => eds.filter((e) => e.source !== nodeId || newHandles.includes((e.sourceHandle as string) || "out")));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setSavedMsg("");
    try {
      const graph = fromRF(nodes, edges);
      const res = await authFetch(`/api/sequences/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, graph }),
      });
      const d = await res.json();
      if (!res.ok) {
        const errs = d.errors || [{ message: d.error || "Save failed" }];
        setErrors(errs);
        markErrors(errs);
        setSavedMsg("Couldn't save — fix the highlighted issues.");
        return false;
      }
      setErrors([]);
      markErrors([]);
      setSeq(d);
      setSavedMsg("Saved ✓");
      setTimeout(() => setSavedMsg(""), 2000);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const markErrors = (errs: { nodeId?: string }[]) => {
    const bad = new Set(errs.map((e) => e.nodeId).filter(Boolean));
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, error: bad.has(n.id) } })));
  };

  const activate = async () => {
    const ok = await save();
    if (!ok) return;
    const res = await authFetch(`/api/sequences/${id}/activate`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) {
      const errs = d.errors || [{ message: d.error }];
      setErrors(errs);
      markErrors(errs);
      setSavedMsg("Can't activate — fix the issues.");
    } else {
      setSeq((s) => (s ? { ...s, status: "active" } : s));
      setSavedMsg("Activated ✓");
      setTimeout(() => setSavedMsg(""), 2000);
    }
  };

  const autoLayout = () => setNodes((ns) => layout(ns, edges));

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) || null, [nodes, selectedId]);

  if (!seq) return <div className="sb__loading">Loading builder…</div>;

  return (
    <div className="sb" ref={wrapRef}>
      {/* top bar */}
      <div className="sb__topbar">
        <button className="sb__back" onClick={() => navigate("/dashboard/sequences")}>← Sequences</button>
        <input className="sb__name" value={name} onChange={(e) => setName(e.target.value)} />
        <span className={`sb__status sb__status--${seq.status}`}>{seq.status}</span>
        <div className="sb__top-actions">
          {savedMsg && <span className="sb__saved">{savedMsg}</span>}
          <button className="sb__btn" onClick={autoLayout}>Auto-layout</button>
          <button className="sb__btn" onClick={() => openCopilot({ mode: "sequences", sequenceId: id, sequenceName: name })}>✨ Create with AI</button>
          <button className="sb__btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          {seq.status === "active" ? (
            <button className="sb__btn" onClick={async () => { await authFetch(`/api/sequences/${id}/pause`, { method: "POST" }); setSeq((s) => s ? { ...s, status: "paused" } : s); }}>Pause</button>
          ) : (
            <button className="sb__btn sb__btn--primary" onClick={activate}>Activate</button>
          )}
        </div>
      </div>

      <div className="sb__body">
        {/* palette */}
        <div className={`sb__palette ${paletteOpen ? "sb__palette--open" : ""}`} style={{ width: paletteW }}>
          <button
            type="button"
            className="sb__palette-title"
            onClick={() => setPaletteOpen((o) => !o)}
            aria-expanded={paletteOpen}
          >
            Blocks
            <svg className="sb__palette-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div className="sb__palette-body">
            {(["trigger", "action", "control", "exit"] as Family[]).map((fam) => (
              <div key={fam} className="sb__palette-group">
                <div className="sb__palette-fam" style={{ color: FAMILY_COLOR[fam] }}>{FAMILY_LABEL[fam]}</div>
                {Object.values(BLOCK_META).filter((b) => b.family === fam).map((b) => (
                  <button key={b.type} className="sb__palette-item" onClick={() => addBlock(b.type)} title={b.description}>
                    <span className="sb__palette-dot" style={{ background: FAMILY_COLOR[fam] }} />
                    {b.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* drag to resize the palette */}
        <div className="sb__resizer" onMouseDown={startResize("palette")} role="separator" aria-orientation="vertical" title="Drag to resize" />

        {/* canvas */}
        <div className="sb__canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable nodeColor={(n) => FAMILY_COLOR[(n.data as RFData).family]} />
          </ReactFlow>

          {errors.length > 0 && (
            <div className="sb__errors">
              <div className="sb__errors-head">{errors.length} issue{errors.length > 1 ? "s" : ""} to fix</div>
              {errors.map((e, i) => <div key={i} className="sb__error">• {e.message}</div>)}
            </div>
          )}
        </div>

        {/* drag to resize the config panel */}
        <div className="sb__resizer" onMouseDown={startResize("config")} role="separator" aria-orientation="vertical" title="Drag to resize" />

        {/* config panel */}
        <div className="sb__config" style={{ width: configW }}>
          {selectedNode ? (
            <ConfigPanel
              node={selectedNode}
              otherSeqs={otherSeqs}
              onChange={(cfg) => updateNodeConfig(selectedNode.id, cfg)}
              onDelete={deleteSelected}
            />
          ) : (
            <div className="sb__config-empty">
              <p>Select a block to edit it, or add one from the palette.</p>
              <p className="sb__hint">Connect blocks by dragging from a node's bottom handle to another node's top. Branch nodes (condition, wait for reply) have one handle per outcome.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── config panel ───────────────────────── */
const ConfigPanel: React.FC<{
  node: Node<RFData>;
  otherSeqs: Sequence[];
  onChange: (cfg: Record<string, any>) => void;
  onDelete: () => void;
}> = ({ node, otherSeqs, onChange, onDelete }) => {
  const meta = BLOCK_META[node.data.blockType];
  const cfg = node.data.config;
  const set = (patch: Record<string, any>) => onChange({ ...cfg, ...patch });

  return (
    <div className="sb__cfg">
      <div className="sb__cfg-head">
        <span className="sb__cfg-fam" style={{ background: FAMILY_COLOR[node.data.family] }}>{FAMILY_LABEL[node.data.family]}</span>
        <span className="sb__cfg-title">{meta?.label}</span>
      </div>
      <p className="sb__cfg-desc">{meta?.description}</p>

      {meta?.special === "condition" && <ConditionEditor cfg={cfg} onChange={onChange} />}
      {meta?.special === "update_client" && <UpdateClientEditor cfg={cfg} set={set} />}
      {meta?.special === "wait_until" && <WaitUntilEditor cfg={cfg} onChange={onChange} />}
      {meta?.special === "enroll_in_sequence" && (
        <Field label="Target sequence">
          <select value={cfg.targetSequenceId || ""} onChange={(e) => set({ targetSequenceId: e.target.value })}>
            <option value="">Select…</option>
            {otherSeqs.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </Field>
      )}

      {meta?.fields.map((f) => {
        if (f.kind === "duration") {
          const usesTimeout = node.data.blockType === "wait_for_reply" || node.data.blockType === "wait_for_document";
          const d = usesTimeout ? (cfg.timeout || { value: 3, unit: "days" }) : cfg;
          const apply = (patch: any) => (usesTimeout ? set({ timeout: { ...d, ...patch } }) : set(patch));
          return (
            <Field key={f.key} label={f.label}>
              <div className="sb__row">
                <input type="number" min={1} value={d.value ?? 1} onChange={(e) => apply({ value: Number(e.target.value) })} />
                <select value={d.unit ?? "days"} onChange={(e) => apply({ unit: e.target.value })}>
                  <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
                </select>
              </div>
            </Field>
          );
        }
        if (f.kind === "select") {
          return (
            <Field key={f.key} label={f.label}>
              <select value={cfg[f.key] ?? ""} onChange={(e) => set({ [f.key]: e.target.value })}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
          );
        }
        if (f.kind === "checklist") {
          const cur: string[] = cfg[f.key] || [];
          return (
            <Field key={f.key} label={f.label}>
              <div className="sb__checks">
                {f.options.map((o) => (
                  <label key={o} className="sb__check">
                    <input type="checkbox" checked={cur.includes(o)} onChange={(e) => set({ [f.key]: e.target.checked ? [...cur, o] : cur.filter((x) => x !== o) })} />
                    {o}
                  </label>
                ))}
              </div>
            </Field>
          );
        }
        if (f.kind === "textarea") {
          return (
            <Field key={f.key} label={f.label} merge={f.merge} onInsert={(t) => set({ [f.key]: (cfg[f.key] || "") + t })}>
              <textarea rows={5} value={cfg[f.key] ?? ""} onChange={(e) => set({ [f.key]: e.target.value })} placeholder={f.placeholder} />
            </Field>
          );
        }
        return (
          <Field key={f.key} label={f.label} merge={f.merge} onInsert={(t) => set({ [f.key]: (cfg[f.key] || "") + t })}>
            <input type={f.kind === "number" ? "number" : "text"} value={cfg[f.key] ?? ""} onChange={(e) => set({ [f.key]: f.kind === "number" ? Number(e.target.value) : e.target.value })} placeholder={f.placeholder} />
          </Field>
        );
      })}

      {(node.data.blockType === "send_email" || node.data.blockType === "send_whatsapp") && (
        <QuietHoursEditor cfg={cfg} set={set} />
      )}

      {node.data.blockType === "end" && (
        <>
          <Field label="Mark as goal/conversion">
            <label className="sb__check"><input type="checkbox" checked={!!cfg.goal} onChange={(e) => set({ goal: e.target.checked })} /> This end counts as a conversion</label>
          </Field>
          {cfg.goal && (
            <Field label="Goal name"><input value={cfg.goalName ?? ""} onChange={(e) => set({ goalName: e.target.value })} placeholder="e.g. lead_replied" /></Field>
          )}
        </>
      )}

      {node.data.family !== "trigger" && (
        <button className="sb__delete" onClick={onDelete}>Delete block</button>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; merge?: boolean; onInsert?: (t: string) => void; children: React.ReactNode }> = ({ label, merge, onInsert, children }) => (
  <div className="sb__field">
    <label className="sb__field-label">{label}</label>
    {children}
    {merge && onInsert && (
      <div className="sb__merge">
        {MERGE_FIELDS.map((m) => <button key={m} className="sb__merge-chip" onClick={() => onInsert(m)} type="button">{m}</button>)}
      </div>
    )}
  </div>
);

const QuietHoursEditor: React.FC<{ cfg: any; set: (p: any) => void }> = ({ cfg, set }) => {
  const qh = cfg.quietHours || { enabled: false, start: "21:00", end: "08:00" };
  const update = (patch: Record<string, any>) => set({ quietHours: { ...qh, ...patch } });
  return (
    <Field label="Quiet hours">
      <label className="sb__check">
        <input
          type="checkbox"
          checked={!!qh.enabled}
          onChange={(e) => update({ enabled: e.target.checked, start: qh.start || "21:00", end: qh.end || "08:00" })}
        />
        Don't send during quiet hours
      </label>
      {qh.enabled && (
        <>
          <div className="sb__row sb__row--quiet">
            <label className="sb__quiet-col">
              <span>From</span>
              <input type="time" value={qh.start || "21:00"} onChange={(e) => update({ start: e.target.value })} />
            </label>
            <label className="sb__quiet-col">
              <span>To</span>
              <input type="time" value={qh.end || "08:00"} onChange={(e) => update({ end: e.target.value })} />
            </label>
          </div>
          <p className="sb__cfg-hint">24-hour, in the client's local timezone. The message is held and sent when the window ends.</p>
        </>
      )}
    </Field>
  );
};

const ConditionEditor: React.FC<{ cfg: any; onChange: (c: any) => void }> = ({ cfg, onChange }) => {
  const cases = cfg.cases || [];
  const setCase = (i: number, patch: any) => {
    const next = cases.map((c: any, idx: number) => (idx === i ? { ...c, ...patch } : c));
    onChange({ ...cfg, cases: next });
  };
  const addCase = () => onChange({ ...cfg, cases: [...cases, { op: "eq", value: "", handle: `case${cases.length + 1}` }] });
  const rmCase = (i: number) => onChange({ ...cfg, cases: cases.filter((_: any, idx: number) => idx !== i) });

  const valueOptions = cfg.field === "client.intent" ? INTENTS : cfg.field === "client.stage" ? STAGES : null;

  return (
    <>
      <Field label="Field">
        <select value={cfg.field} onChange={(e) => onChange({ ...cfg, field: e.target.value })}>
          <option value="client.intent">client.intent</option>
          <option value="client.stage">client.stage</option>
          <option value="client.budget">client.budget</option>
          <option value="replied">replied?</option>
        </select>
      </Field>
      <div className="sb__field-label">Cases (each is a branch handle)</div>
      {cases.map((c: any, i: number) => (
        <div key={i} className="sb__case">
          <select value={c.op} onChange={(e) => setCase(i, { op: e.target.value })}>
            <option value="eq">=</option><option value="ne">≠</option><option value="gt">&gt;</option><option value="lt">&lt;</option>
          </select>
          {valueOptions ? (
            <select value={c.value} onChange={(e) => setCase(i, { value: e.target.value })}>
              {valueOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input value={c.value} onChange={(e) => setCase(i, { value: e.target.value })} placeholder="value" />
          )}
          <input className="sb__case-handle" value={c.handle} onChange={(e) => setCase(i, { handle: e.target.value })} placeholder="handle" />
          <button onClick={() => rmCase(i)}>✕</button>
        </div>
      ))}
      <button className="sb__add-case" onClick={addCase}>+ Add case</button>
      <Field label="Else handle (fallback branch)"><input value={cfg.elseHandle ?? "else"} onChange={(e) => onChange({ ...cfg, elseHandle: e.target.value })} /></Field>
    </>
  );
};

const UpdateClientEditor: React.FC<{ cfg: any; set: (p: any) => void }> = ({ cfg, set }) => {
  const s = cfg.set || {};
  const setSet = (patch: any) => {
    const next = { ...s, ...patch };
    Object.keys(next).forEach((k) => (next[k] === "" || next[k] == null) && delete next[k]);
    set({ set: next });
  };
  return (
    <>
      <Field label="Set stage">
        <select value={s.stage ?? ""} onChange={(e) => setSet({ stage: e.target.value })}>
          <option value="">— no change —</option>{STAGES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Set intent">
        <select value={s.intent ?? ""} onChange={(e) => setSet({ intent: e.target.value })}>
          <option value="">— no change —</option>{INTENTS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Set next action"><input value={s.nextAction ?? ""} onChange={(e) => setSet({ nextAction: e.target.value })} placeholder="e.g. Offer prep" /></Field>
      <Field label="Next action priority">
        <select value={s.nextActionPriority ?? ""} onChange={(e) => setSet({ nextActionPriority: e.target.value })}>
          <option value="">— no change —</option>{PRIORITIES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Set transaction status">
        <select value={s.transactionStatus ?? ""} onChange={(e) => setSet({ transactionStatus: e.target.value })}>
          <option value="">— no change —</option>{TXN_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Append note"><input value={cfg.appendNote ?? ""} onChange={(e) => set({ appendNote: e.target.value })} placeholder="Adds a note to the client" /></Field>
    </>
  );
};

const WaitUntilEditor: React.FC<{ cfg: any; onChange: (c: any) => void }> = ({ cfg, onChange }) => {
  const off = cfg.offset || { value: 0, unit: "days", direction: "before" };
  const setOff = (patch: any) => onChange({ ...cfg, offset: { ...off, ...patch } });
  return (
    <>
      <Field label="Deadline date">
        <select value={cfg.dateField} onChange={(e) => onChange({ ...cfg, dateField: e.target.value })}>
          {TXN_DATE_FIELDS.map((o) => <option key={o} value={o}>{o.split(".")[1]}</option>)}
        </select>
      </Field>
      <Field label="Offset (optional)">
        <div className="sb__row">
          <input type="number" min={0} value={off.value ?? 0} onChange={(e) => setOff({ value: Number(e.target.value) })} />
          <select value={off.unit ?? "days"} onChange={(e) => setOff({ unit: e.target.value })}>
            <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
          </select>
          <select value={off.direction ?? "before"} onChange={(e) => setOff({ direction: e.target.value })}>
            <option value="before">before</option><option value="after">after</option>
          </select>
        </div>
      </Field>
      <p className="sb__hint">If the date is unset or already passed, this step is skipped so the flow never stalls.</p>
    </>
  );
};

export default function SequenceBuilderPage() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}
