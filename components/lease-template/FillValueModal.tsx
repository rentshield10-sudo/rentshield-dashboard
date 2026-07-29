"use client";

import { useState } from "react";
import styles from "./LeaseTemplateTab.module.css";
import type { FieldRow } from "./FieldBox";

export type Suggestion = { source: "rentvine" | "supabase" | "remembered"; value: string };

const SOURCE_LABELS: Record<Suggestion["source"], string> = {
  rentvine: "From Rentvine",
  supabase: "From Supabase",
  remembered: "Remembered",
};

export default function FillValueModal({
  field,
  currentValue,
  suggestions,
  loading,
  onSelect,
  onCancel,
}: {
  field: FieldRow;
  currentValue: string;
  suggestions: Suggestion[];
  loading: boolean;
  onSelect: (value: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState(currentValue);

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>{field.label}</h2>

        {loading && <p className={styles.modalSubtitle}>Loading suggestions…</p>}

        {!loading && suggestions.length > 0 && (
          <div className={styles.suggestionList}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className={styles.suggestionItem}
                onClick={() => onSelect(s.value)}
              >
                <span className={styles.suggestionSource}>{SOURCE_LABELS[s.source]}</span>
                <span>{s.value}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.modalField}>
          <label className={styles.modalLabel}>
            {field.field_type === "signature" ? "Type your name" : "Or type a value"}
          </label>
          <input
            className={
              field.field_type === "signature"
                ? `${styles.modalInput} ${styles.signatureInput}`
                : styles.modalInput
            }
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.smallButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => onSelect(typed)}>
            Use this value
          </button>
        </div>
      </div>
    </div>
  );
}
