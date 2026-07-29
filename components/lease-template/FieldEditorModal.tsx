"use client";

import { useState } from "react";
import styles from "./LeaseTemplateTab.module.css";

export type FieldType = "text" | "date" | "signature";

export default function FieldEditorModal({
  initialLabel,
  initialFieldType,
  onSave,
  onCancel,
  onDelete,
}: {
  initialLabel: string;
  initialFieldType: FieldType;
  onSave: (label: string, fieldType: FieldType) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [fieldType, setFieldType] = useState<FieldType>(initialFieldType);

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>Field</h2>
        <div className={styles.modalField}>
          <label className={styles.modalLabel}>Label</label>
          <input
            className={styles.modalInput}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </div>
        <div className={styles.modalField}>
          <label className={styles.modalLabel}>Type</label>
          <select
            className={styles.modalInput}
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
          >
            <option value="text">Text</option>
            <option value="date">Date</option>
            <option value="signature">Signature</option>
          </select>
        </div>
        <div className={styles.modalActions}>
          {onDelete && (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={onDelete}
              style={{ marginRight: "auto" }}
            >
              Delete
            </button>
          )}
          <button type="button" className={styles.smallButton} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => label.trim() && onSave(label.trim(), fieldType)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
