"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LeaseTemplateTab.module.css";
import FieldBox, { type FieldRow } from "./FieldBox";
import FieldEditorModal, { type FieldType } from "./FieldEditorModal";
import FillValueModal, { type Suggestion } from "./FillValueModal";

type Mode = "design" | "fill";

type DragRect = { startX: number; startY: number; currentX: number; currentY: number };

const MIN_DRAG_PX = 6;

interface SigningRequestSummary {
  id: number;
  tenant_name: string | null;
  tenant_email: string;
  document_id: string;
  status: string;
  created_at: string;
}

export default function LeaseTemplateTab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [error, setError] = useState("");
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [mode, setMode] = useState<Mode>("design");

  const [fields, setFields] = useState<FieldRow[]>([]);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const [editingField, setEditingField] = useState<FieldRow | null>(null);
  const [pendingNewField, setPendingNewField] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [draftId, setDraftId] = useState<number | null>(null);
  const [filledValues, setFilledValues] = useState<Record<number, string>>({});
  const [fillModalField, setFillModalField] = useState<FieldRow | null>(null);
  const [fillSuggestions, setFillSuggestions] = useState<Suggestion[]>([]);
  const [fillLoading, setFillLoading] = useState(false);

  const [signingRequests, setSigningRequests] = useState<SigningRequestSummary[]>([]);
  const [tenantName, setTenantName] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [creatingSigningRequest, setCreatingSigningRequest] = useState(false);
  const [signingLinkResult, setSigningLinkResult] = useState<string | null>(null);
  const [signingLinkEmailSent, setSigningLinkEmailSent] = useState(false);
  const [signingError, setSigningError] = useState("");

  // ── Render the template PDF ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjs.getDocument("/lease-template.pdf").promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (!cancelled) setPageSize({ width: viewport.width, height: viewport.height });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the lease template PDF.");
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load existing field definitions ──────────────────────────────────
  useEffect(() => {
    fetch("/api/lease-template/fields")
      .then((res) => res.json())
      .then((json: { ok: boolean; fields?: FieldRow[] }) => {
        if (json.ok && json.fields) setFields(json.fields);
      })
      .catch(() => {
        /* field list is non-critical to page load; leave empty on failure */
      });
  }, []);

  // ── Create a draft + load its filled values once entering Fill mode ──
  useEffect(() => {
    if (mode !== "fill" || draftId !== null) return;
    fetch("/api/lease-template/drafts", { method: "POST", body: "{}" })
      .then((res) => res.json())
      .then((json: { ok: boolean; draft?: { id: number } }) => {
        if (json.ok && json.draft) {
          setDraftId(json.draft.id);
          return fetch(`/api/lease-template/drafts/${json.draft.id}/values`);
        }
        return null;
      })
      .then((res) => res?.json())
      .then((json: { ok: boolean; values?: { field_id: number; value: string }[] } | undefined) => {
        if (json?.ok && json.values) {
          const map: Record<number, string> = {};
          for (const v of json.values) map[v.field_id] = v.value;
          setFilledValues(map);
        }
      })
      .catch(() => {
        /* fill mode still usable without persisted values loaded */
      });
  }, [mode, draftId]);

  // ── Design mode: drag-to-create ──────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent) {
    if (mode !== "design") return;
    if (e.target !== canvasRef.current && e.target !== containerRef.current) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    setDragRect({ startX, startY, currentX: startX, currentY: startY });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRect) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragRect({
      ...dragRect,
      currentX: e.clientX - rect.left,
      currentY: e.clientY - rect.top,
    });
  }

  function handleMouseUp() {
    if (!dragRect || !pageSize) {
      setDragRect(null);
      return;
    }
    const left = Math.min(dragRect.startX, dragRect.currentX);
    const top = Math.min(dragRect.startY, dragRect.currentY);
    const width = Math.abs(dragRect.currentX - dragRect.startX);
    const height = Math.abs(dragRect.currentY - dragRect.startY);
    setDragRect(null);

    if (width < MIN_DRAG_PX || height < MIN_DRAG_PX) return;

    setPendingNewField({
      x: (left / pageSize.width) * 100,
      y: (top / pageSize.height) * 100,
      width: (width / pageSize.width) * 100,
      height: (height / pageSize.height) * 100,
    });
  }

  async function saveNewField(label: string, fieldType: FieldType) {
    if (!pendingNewField) return;
    try {
      const res = await fetch("/api/lease-template/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pendingNewField, pageNumber: 1, label, fieldType }),
      });
      const json: { ok: boolean; field?: FieldRow } = await res.json();
      if (json.ok && json.field) {
        setFields((prev) => [...prev, json.field as FieldRow]);
      }
    } finally {
      setPendingNewField(null);
    }
  }

  async function saveEditedField(label: string, fieldType: FieldType) {
    if (!editingField) return;
    const id = editingField.id;
    try {
      const res = await fetch(`/api/lease-template/fields/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, fieldType }),
      });
      const json: { ok: boolean; field?: FieldRow } = await res.json();
      if (json.ok && json.field) {
        setFields((prev) => prev.map((f) => (f.id === id ? (json.field as FieldRow) : f)));
      }
    } finally {
      setEditingField(null);
    }
  }

  async function deleteField(id: number) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setEditingField(null);
    await fetch(`/api/lease-template/fields/${id}`, { method: "DELETE" });
  }

  // ── Fill mode: click a box, show suggestions, save a value ───────────
  async function openFillModal(field: FieldRow) {
    setFillModalField(field);
    setFillLoading(true);
    setFillSuggestions([]);
    try {
      const res = await fetch(
        `/api/lease-template/fill-suggestions?label=${encodeURIComponent(field.label)}`,
      );
      const json: { ok: boolean; suggestions?: Suggestion[] } = await res.json();
      if (json.ok && json.suggestions) setFillSuggestions(json.suggestions);
    } finally {
      setFillLoading(false);
    }
  }

  async function selectFillValue(value: string) {
    const field = fillModalField;
    setFillModalField(null);
    if (!field || !value.trim()) return;

    setFilledValues((prev) => ({ ...prev, [field.id]: value }));

    if (draftId !== null) {
      await fetch(`/api/lease-template/drafts/${draftId}/values`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldId: field.id, value }),
      });
    }

    await fetch("/api/lease-template/remembered-values", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: field.label, value }),
    });
  }

  // ── Signing requests: create + list + revoke ──────────────────────────
  async function loadSigningRequests() {
    const res = await fetch("/api/lease-signing/requests");
    const json: { ok: boolean; requests?: SigningRequestSummary[] } = await res.json();
    if (json.ok && json.requests) setSigningRequests(json.requests);
  }

  useEffect(() => {
    if (mode === "fill") loadSigningRequests();
  }, [mode]);

  async function createSigningRequest() {
    if (!draftId || !tenantEmail.trim()) return;
    setCreatingSigningRequest(true);
    setSigningError("");
    setSigningLinkResult(null);
    try {
      const res = await fetch("/api/lease-signing/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          tenantName: tenantName.trim() || undefined,
          tenantEmail: tenantEmail.trim(),
        }),
      });
      const json: { ok: boolean; error?: string; signingUrl?: string; emailSent?: boolean } =
        await res.json();
      if (!json.ok) {
        setSigningError(json.error || "Could not create signing request.");
        return;
      }
      setSigningLinkResult(json.signingUrl ?? null);
      setSigningLinkEmailSent(!!json.emailSent);
      await loadSigningRequests();
    } finally {
      setCreatingSigningRequest(false);
    }
  }

  async function revokeSigningRequest(id: number) {
    await fetch(`/api/lease-signing/requests/${id}/revoke`, { method: "POST" });
    await loadSigningRequests();
  }

  async function downloadCompletedPdf(id: number) {
    const res = await fetch(`/api/lease-signing/requests/${id}/completed-pdf`);
    const json: { ok: boolean; url?: string; error?: string } = await res.json();
    if (json.ok && json.url) {
      window.open(json.url, "_blank", "noopener,noreferrer");
    } else {
      alert(json.error || "Could not load the completed document.");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Lease Template</h1>
        <div className={styles.modeToggle}>
          <button
            type="button"
            className={mode === "design" ? styles.primaryButton : styles.smallButton}
            onClick={() => setMode("design")}
          >
            Design
          </button>
          <button
            type="button"
            className={mode === "fill" ? styles.primaryButton : styles.smallButton}
            onClick={() => setMode("fill")}
          >
            Fill
          </button>
        </div>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div
        className={styles.pageContainer}
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <canvas ref={canvasRef} className={styles.canvas} />

        {fields
          .filter((f) => f.page_number === 1)
          .map((field) => (
            <FieldBox
              key={field.id}
              field={field}
              mode={mode}
              value={filledValues[field.id]}
              onClick={() =>
                mode === "design" ? setEditingField(field) : openFillModal(field)
              }
              onDelete={mode === "design" ? () => deleteField(field.id) : undefined}
            />
          ))}

        {dragRect && (
          <div
            className={styles.dragRect}
            style={{
              left: Math.min(dragRect.startX, dragRect.currentX),
              top: Math.min(dragRect.startY, dragRect.currentY),
              width: Math.abs(dragRect.currentX - dragRect.startX),
              height: Math.abs(dragRect.currentY - dragRect.startY),
            }}
          />
        )}
      </div>

      {mode === "fill" && (
        <div className={styles.signingPanel}>
          <h2 className={styles.signingPanelTitle}>Send for Signing</h2>
          <div className={styles.signingForm}>
            <input
              className={styles.modalInput}
              placeholder="Tenant name (optional)"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
            />
            <input
              className={styles.modalInput}
              placeholder="Tenant email"
              value={tenantEmail}
              onChange={(e) => setTenantEmail(e.target.value)}
            />
            <button
              type="button"
              className={styles.primaryButton}
              disabled={creatingSigningRequest || !tenantEmail.trim() || !draftId}
              onClick={createSigningRequest}
            >
              {creatingSigningRequest ? "Creating…" : "Create Signing Link"}
            </button>
          </div>
          {signingError && <p className={styles.errorBanner}>{signingError}</p>}
          {signingLinkResult && (
            <p className={styles.signingLinkResult}>
              Link created: <code>{signingLinkResult}</code>
              {signingLinkEmailSent
                ? " — emailed to the tenant."
                : " — could not email the tenant (check the domain is verified in Resend); share this link manually for now."}
            </p>
          )}

          {signingRequests.length > 0 && (
            <table className={styles.signingTable}>
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {signingRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.tenant_name || r.tenant_email}</td>
                    <td>{r.status}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>
                      {r.status === "completed" && (
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => downloadCompletedPdf(r.id)}
                        >
                          Download
                        </button>
                      )}
                      {!["completed", "revoked", "expired", "declined"].includes(r.status) && (
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => revokeSigningRequest(r.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {pendingNewField && (
        <FieldEditorModal
          initialLabel=""
          initialFieldType="text"
          onSave={saveNewField}
          onCancel={() => setPendingNewField(null)}
        />
      )}

      {editingField && (
        <FieldEditorModal
          initialLabel={editingField.label}
          initialFieldType={editingField.field_type}
          onSave={saveEditedField}
          onCancel={() => setEditingField(null)}
          onDelete={() => deleteField(editingField.id)}
        />
      )}

      {fillModalField && (
        <FillValueModal
          field={fillModalField}
          currentValue={filledValues[fillModalField.id] ?? ""}
          suggestions={fillSuggestions}
          loading={fillLoading}
          onSelect={selectFillValue}
          onCancel={() => setFillModalField(null)}
        />
      )}
    </div>
  );
}
