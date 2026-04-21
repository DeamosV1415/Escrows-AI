import "./SequencesPage.css";

/* ─── Dummy Data ─── */
const SEQUENCES = [
  {
    id: "1",
    name: "New Lead Introduction",
    status: "active" as const,
    description: "Automated introduction sequence for new leads",
    steps: 3,
    duration: 7,
    contacts: 12,
    lastSent: "2 days ago",
  },
  {
    id: "2",
    name: "Property Viewing Follow-Up",
    status: "active" as const,
    description: "Follow up after property viewings",
    steps: 2,
    duration: 5,
    contacts: 8,
    lastSent: "5 hours ago",
  },
  {
    id: "3",
    name: "Re-engagement Campaign",
    status: "draft" as const,
    description: "Win back inactive leads with a targeted drip sequence",
    steps: 4,
    duration: 14,
    contacts: 0,
    lastSent: "Not sent yet",
  },
];

const STATS = [
  { label: "Total Sequences", value: "3", variant: "olive" },
  { label: "Active", value: "2", variant: "teal" },
  { label: "Total Steps", value: "9", variant: "gold" },
  { label: "Avg Duration", value: "8.7d", variant: "purple" },
];

/* ─── Icons ─── */
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const StepsIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const UsersIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
);

const SendIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

/* ─── Page ─── */
const SequencesPage: React.FC = () => {
  return (
    <div className="sequences">
      {/* Header */}
      <div className="sequences__header">
        <div className="sequences__header-text">
          <h1 className="sequences__title">Follow-Up Sequences</h1>
          <p className="sequences__subtitle">
            Automate your client outreach with intelligent sequences
          </p>
        </div>
        <button className="sequences__create-btn">
          <PlusIcon />
          Create Sequence
        </button>
      </div>

      {/* Stats */}
      <div className="sequences__stats">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className={`sequences__stat-card sequences__stat-card--${stat.variant}`}
          >
            <div className="sequences__stat-label">{stat.label}</div>
            <div className="sequences__stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Sequence Cards */}
      <div className="sequences__list">
        {SEQUENCES.map((seq) => (
          <div
            key={seq.id}
            className={`sequences__card ${seq.status === "draft" ? "sequences__card--draft" : ""}`}
          >
            <div className="sequences__card-content">
              <div className="sequences__card-top">
                <span className="sequences__card-name">{seq.name}</span>
                <span
                  className={`sequences__status-badge sequences__status-badge--${seq.status}`}
                >
                  {seq.status === "active" ? "Active" : "Draft"}
                </span>
              </div>
              <p className="sequences__card-desc">{seq.description}</p>
              <div className="sequences__card-meta">
                <span className="sequences__meta-item">
                  <StepsIcon />
                  {seq.steps} steps
                </span>
                <span className="sequences__meta-sep" />
                <span className="sequences__meta-item">
                  <ClockIcon />
                  {seq.duration} day duration
                </span>
                <span className="sequences__meta-sep" />
                <span className="sequences__meta-item">
                  <UsersIcon />
                  {seq.contacts} contacts enrolled
                </span>
                <span className="sequences__meta-sep" />
                <span className="sequences__meta-item">
                  <SendIcon />
                  {seq.lastSent}
                </span>
              </div>
            </div>

            <div className="sequences__card-actions">
              <button className="sequences__action-btn sequences__action-btn--edit">
                <EditIcon />
                Edit
              </button>
              <button className="sequences__action-btn sequences__action-btn--delete">
                <TrashIcon />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SequencesPage;
