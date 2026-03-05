import "./PlaceholderPage.css";

const SequencesPage: React.FC = () => {
  return (
    <div className="placeholder-page">
      <div className="placeholder-page__icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      </div>
      <h1 className="placeholder-page__title">Sequences</h1>
      <p className="placeholder-page__desc">
        Build automated outreach workflows with our visual canvas editor.
        Nurture leads on autopilot.
      </p>
      <div className="placeholder-page__badge">Coming Soon</div>
    </div>
  );
};

export default SequencesPage;
