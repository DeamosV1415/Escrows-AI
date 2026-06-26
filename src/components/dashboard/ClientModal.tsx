import React, { useState, useEffect } from "react";
import "./ClientModal.css";

interface Transaction {
  status?: string;
  contractDate?: string | null;
  inspectionDate?: string | null;
  appraisalDate?: string | null;
  loanContingencyDate?: string | null;
  closingDate?: string | null;
}

interface ClientData {
  _id?: string;
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
  transaction?: Transaction;
}

const TXN_STATUSES = ["none", "active", "inspection", "appraisal", "loan", "clear_to_close", "closed"];
const TXN_DATES: { key: keyof Transaction; label: string }[] = [
  { key: "contractDate", label: "Contract date" },
  { key: "inspectionDate", label: "Inspection date" },
  { key: "appraisalDate", label: "Appraisal date" },
  { key: "loanContingencyDate", label: "Loan contingency" },
  { key: "closingDate", label: "Closing date" },
];
// ISO/date string → "YYYY-MM-DD" for <input type="date">; empty otherwise.
const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

interface ClientModalProps {
  client?: ClientData;
  onClose: () => void;
  onSubmit: (data: Partial<ClientData>) => Promise<void>;
}

const STAGES = ["Lead", "Engaged", "Under Contract", "Closed"];
const INTENTS = [
  { value: "hot", label: "Hot", color: "#4caf50" },
  { value: "warm", label: "Warm", color: "#f9a825" },
  { value: "cold", label: "Cold", color: "#bdbdbd" },
];

const defaultForm: ClientData = {
  name: "",
  email: "",
  company: "",
  phone: "",
  stage: "Lead",
  intent: "warm",
  budget: 0,
  requirements: "",
  nextAction: "",
  nextActionPriority: "medium",
  notes: "",
  transaction: { status: "none" },
};

const ClientModal: React.FC<ClientModalProps> = ({
  client,
  onClose,
  onSubmit,
}) => {
  const isEdit = !!client;
  const [form, setForm] = useState<ClientData>(client || defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    if (name === "phone") {
      // Only allow digits, +, -, (, ), and spaces
      const cleaned = value.replace(/[^\d+\-()\s]/g, "");
      setForm((prev) => ({ ...prev, phone: cleaned }));
      return;
    }
    if (name === "budget") {
      // Only allow digits
      const num = Number(value.replace(/[^\d]/g, "")) || 0;
      setForm((prev) => ({ ...prev, budget: num }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleTxnChange = (key: keyof Transaction, value: string) => {
    setForm((prev) => ({
      ...prev,
      transaction: { ...(prev.transaction || {}), [key]: value },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // All fields required
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!form.company.trim()) {
      setError("Company is required.");
      return;
    }
    if (!form.phone.trim()) {
      setError("Phone is required.");
      return;
    }

    // Email validation — must have valid format with real TLD
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(form.email.trim())) {
      setError("Please enter a valid email address (e.g. name@company.com).");
      return;
    }

    // Phone: must have at least 7 digits
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 7) {
      setError("Phone number must have at least 7 digits.");
      return;
    }

    try {
      setSubmitting(true);
      // Sanitize transaction dates: empty strings → null so Mongoose doesn't reject them.
      const t = form.transaction || {};
      const payload: Partial<ClientData> = {
        ...form,
        transaction: {
          status: t.status || "none",
          contractDate: t.contractDate || null,
          inspectionDate: t.inspectionDate || null,
          appraisalDate: t.appraisalDate || null,
          loanContingencyDate: t.loanContingencyDate || null,
          closingDate: t.closingDate || null,
        },
      };
      await onSubmit(payload);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="client-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="client-modal__header">
          <h2 className="client-modal__title">
            {isEdit ? "Edit Client" : "Add New Client"}
          </h2>
          <button className="client-modal__close" onClick={onClose}>
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

        {/* Form */}
        <form className="client-modal__form" onSubmit={handleSubmit}>
          <div className="client-modal__row">
            <div className="client-modal__field">
              <label className="client-modal__label">
                Name <span className="client-modal__required">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="John Doe"
                className="client-modal__input"
                autoFocus
                required
              />
            </div>
            <div className="client-modal__field">
              <label className="client-modal__label">
                Company <span className="client-modal__required">*</span>
              </label>
              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                placeholder="Acme Corp"
                className="client-modal__input"
                required
              />
            </div>
          </div>

          <div className="client-modal__row">
            <div className="client-modal__field">
              <label className="client-modal__label">
                Email <span className="client-modal__required">*</span>
              </label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="john@example.com"
                className="client-modal__input"
                required
              />
            </div>
            <div className="client-modal__field">
              <label className="client-modal__label">
                Phone <span className="client-modal__required">*</span>
              </label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="(555) 123-4567"
                className="client-modal__input"
                required
              />
            </div>
          </div>

          <div className="client-modal__row client-modal__row--three">
            <div className="client-modal__field">
              <label className="client-modal__label">Stage</label>
              <select
                name="stage"
                value={form.stage}
                onChange={handleChange}
                className="client-modal__input client-modal__select"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="client-modal__field">
              <label className="client-modal__label">Intent</label>
              <select
                name="intent"
                value={form.intent}
                onChange={handleChange}
                className="client-modal__input client-modal__select"
              >
                {INTENTS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.value === "hot"
                      ? "🟢"
                      : i.value === "warm"
                        ? "🟡"
                        : "⚪"}{" "}
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="client-modal__field">
              <label className="client-modal__label">Budget ($)</label>
              <input
                type="number"
                name="budget"
                value={form.budget}
                onChange={handleChange}
                placeholder="0"
                className="client-modal__input"
                min="0"
              />
            </div>
          </div>

          <div className="client-modal__field">
            <label className="client-modal__label">Requirements</label>
            <textarea
              name="requirements"
              value={form.requirements}
              onChange={handleChange}
              placeholder="What is the client looking for?"
              className="client-modal__textarea"
              rows={3}
            />
          </div>

          <div className="client-modal__row">
            <div className="client-modal__field" style={{ flex: 1 }}>
              <label className="client-modal__label">Next Action</label>
              <input
                type="text"
                name="nextAction"
                value={form.nextAction}
                onChange={handleChange}
                placeholder="Follow up on property tour"
                className="client-modal__input"
              />
            </div>
            <div className="client-modal__field" style={{ width: 140, flexShrink: 0 }}>
              <label className="client-modal__label">Priority</label>
              <select
                name="nextActionPriority"
                value={form.nextActionPriority}
                onChange={handleChange}
                className="client-modal__input client-modal__select"
              >
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          {/* Transaction / escrow tracking — relevant once a deal is under contract */}
          {(form.stage === "Under Contract" || form.stage === "Closed") && (
            <div className="client-modal__txn">
              <div className="client-modal__txn-head">
                <span>Transaction</span>
                <select
                  className="client-modal__input client-modal__select client-modal__txn-status"
                  value={form.transaction?.status || "none"}
                  onChange={(e) => handleTxnChange("status", e.target.value)}
                >
                  {TXN_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <p className="client-modal__txn-hint">
                Deadline dates power Contract-to-Close reminders. Leave blank to skip a reminder.
              </p>
              <div className="client-modal__txn-grid">
                {TXN_DATES.map((d) => (
                  <div className="client-modal__field" key={d.key}>
                    <label className="client-modal__label">{d.label}</label>
                    <input
                      type="date"
                      className="client-modal__input"
                      value={toDateInput(form.transaction?.[d.key])}
                      onChange={(e) => handleTxnChange(d.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <div className="client-modal__error">{error}</div>}

          <div className="client-modal__actions">
            <button
              type="button"
              className="client-modal__cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="client-modal__submit"
              disabled={submitting}
            >
              {submitting
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Add Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClientModal;
