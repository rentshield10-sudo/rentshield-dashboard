"use client";

import styles from "./LeaseTemplateTab.module.css";

export interface FieldRow {
  id: number;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  field_type: "text" | "date" | "signature";
}

export default function FieldBox({
  field,
  mode,
  value,
  onClick,
  onDelete,
}: {
  field: FieldRow;
  mode: "design" | "fill";
  value?: string;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const isSignature = field.field_type === "signature";

  return (
    <div
      className={mode === "design" ? styles.fieldBoxDesign : styles.fieldBoxFill}
      style={{
        left: `${field.x}%`,
        top: `${field.y}%`,
        width: `${field.width}%`,
        height: `${field.height}%`,
      }}
      onClick={onClick}
      title={field.label}
    >
      <span
        className={`${styles.fieldBoxLabel} ${isSignature && value ? styles.signatureValue : ""}`}
      >
        {value || field.label}
      </span>
      {mode === "design" && onDelete && (
        <button
          type="button"
          className={styles.fieldBoxDelete}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
