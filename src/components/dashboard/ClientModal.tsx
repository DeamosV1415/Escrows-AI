import React, { useState, useEffect } from "react";
import "./ClientModal.css";

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
  notes: string;
}

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
  notes: "",
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
    setForm((prev) => ({
      ...prev,
      [name]: name === "budget" ? Number(value) || 0 : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and Email are required.");
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit(form);
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
              />
            </div>
            <div className="client-modal__field">
              <label className="client-modal__label">Company</label>
              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                placeholder="Acme Corp"
                className="client-modal__input"
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
              />
            </div>
            <div className="client-modal__field">
              <label className="client-modal__label">Phone</label>
              <input
                type="text"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="(555) 123-4567"
                className="client-modal__input"
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

          <div className="client-modal__field">
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
