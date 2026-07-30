"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./LeaseTemplateTab.module.css";
import { extractVariableNames, substituteVariables } from "@/lib/template-vars";

interface Template {
  id: number | null;
  name: string;
  body: string;
}

interface ParticipantSummary {
  id: number;
  role: string;
  name: string | null;
  email: string;
  status: string;
}

interface SigningRequestSummary {
  id: number;
  document_id: string;
  status: string;
  created_at: string;
  participants: ParticipantSummary[];
}

interface ParticipantFormRow {
  role: string;
  name: string;
  email: string;
}

const DEFAULT_PARTICIPANT_ROWS: ParticipantFormRow[] = [
  { role: "Landlord", name: "", email: "" },
  { role: "Tenant", name: "", email: "" },
  { role: "Witness - Property Management", name: "", email: "" },
];

export default function LeaseTemplateTab() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [template, setTemplate] = useState<Template | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [draftId, setDraftId] = useState<number | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const [signingRequests, setSigningRequests] = useState<SigningRequestSummary[]>([]);
  const [participantRows, setParticipantRows] = useState<ParticipantFormRow[]>(DEFAULT_PARTICIPANT_ROWS);
  const [creatingSigningRequest, setCreatingSigningRequest] = useState(false);
  const [signingResult, setSigningResult] = useState<
    { role: string; email: string; signingUrl: string; emailSent: boolean }[] | null
  >(null);
  const [signingError, setSigningError] = useState("");

  // ── Load the template ─────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/lease-template/template")
      .then((res) => res.json())
      .then((json: { ok: boolean; error?: string; template?: Template }) => {
        if (!json.ok || !json.template) {
          setLoadError(json.error || "Could not load the lease template.");
          return;
        }
        setTemplate(json.template);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Unexpected error."));
  }, []);

  // ── Create a draft + load its variable values, once ─────────────────
  useEffect(() => {
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
      .then((json: { ok: boolean; values?: { variable_name: string; value: string }[] } | undefined) => {
        if (json?.ok && json.values) {
          const map: Record<string, string> = {};
          for (const v of json.values) map[v.variable_name] = v.value;
          setVariableValues(map);
        }
      })
      .catch(() => {
        /* variable filling still usable without persisted values loaded */
      });
  }, []);

  function loadSigningRequests() {
    fetch("/api/lease-signing/requests")
      .then((res) => res.json())
      .then((json: { ok: boolean; requests?: SigningRequestSummary[] }) => {
        if (json.ok && json.requests) setSigningRequests(json.requests);
      });
  }

  useEffect(() => {
    loadSigningRequests();
  }, []);

  const variableNames = useMemo(
    () => (template ? extractVariableNames(template.body) : []),
    [template],
  );

  const previewText = useMemo(
    () => (template ? substituteVariables(template.body, variableValues) : ""),
    [template, variableValues],
  );

  function insertVariable(name: string) {
    if (!template) return;
    const textarea = textareaRef.current;
    const token = `{{${name}}}`;
    if (!textarea) {
      setTemplate({ ...template, body: template.body + token });
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newBody = template.body.slice(0, start) + token + template.body.slice(end);
    setTemplate({ ...template, body: newBody });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function saveTemplate() {
    if (!template) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/lease-template/template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, name: template.name, body: template.body }),
      });
      const json: { ok: boolean; error?: string; template?: Template } = await res.json();
      if (!json.ok || !json.template) {
        setSaveMessage(json.error || "Could not save template.");
        return;
      }
      setTemplate(json.template);
      setSaveMessage("Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function setVariableValue(name: string, value: string) {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
    if (draftId === null) return;
    await fetch(`/api/lease-template/drafts/${draftId}/values`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variableName: name, value }),
    });
  }

  function updateParticipantRow(index: number, patch: Partial<ParticipantFormRow>) {
    setParticipantRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addParticipantRow() {
    setParticipantRows((prev) => [...prev, { role: "", name: "", email: "" }]);
  }

  function removeParticipantRow(index: number) {
    setParticipantRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function createSigningRequest() {
    const validRows = participantRows.filter((r) => r.role.trim() && r.email.trim());
    if (!draftId || validRows.length === 0) return;
    setCreatingSigningRequest(true);
    setSigningError("");
    setSigningResult(null);
    try {
      const res = await fetch("/api/lease-signing/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          participants: validRows.map((r) => ({
            role: r.role.trim(),
            name: r.name.trim() || undefined,
            email: r.email.trim(),
          })),
        }),
      });
      const json: {
        ok: boolean;
        error?: string;
        participants?: { role: string; email: string; signingUrl: string; emailSent: boolean }[];
      } = await res.json();
      if (!json.ok) {
        setSigningError(json.error || "Could not create signing request.");
        return;
      }
      setSigningResult(json.participants ?? []);
      loadSigningRequests();
    } finally {
      setCreatingSigningRequest(false);
    }
  }

  async function revokeSigningRequest(id: number) {
    await fetch(`/api/lease-signing/requests/${id}/revoke`, { method: "POST" });
    loadSigningRequests();
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

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBanner}>{loadError}</div>
      </div>
    );
  }

  if (!template) {
    return <div className={styles.page}>Loading…</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Lease Template</h1>
      </div>

      <div className={styles.editorLayout}>
        <div className={styles.editorPane}>
          <input
            className={styles.templateNameInput}
            value={template.name}
            onChange={(e) => setTemplate({ ...template, name: e.target.value })}
          />

          <div className={styles.variablePills}>
            {["tenantName", "address", "city", "state", "leaseStart", "leaseEnd", "rentAmount"].map(
              (name) => (
                <button
                  key={name}
                  type="button"
                  className={styles.variablePill}
                  onClick={() => insertVariable(name)}
                >
                  {`{{${name}}}`}
                </button>
              ),
            )}
          </div>

          <textarea
            ref={textareaRef}
            className={styles.templateTextarea}
            value={template.body}
            onChange={(e) => setTemplate({ ...template, body: e.target.value })}
            rows={20}
          />

          <div className={styles.editorActions}>
            <button type="button" className={styles.primaryButton} onClick={saveTemplate} disabled={saving}>
              {saving ? "Saving…" : "Save Template"}
            </button>
            {saveMessage && <span className={styles.saveMessage}>{saveMessage}</span>}
          </div>
        </div>

        <div className={styles.previewPane}>
          <h2 className={styles.sectionTitle}>Live Preview</h2>
          <div className={styles.previewBox}>{previewText}</div>

          <h2 className={styles.sectionTitle}>Variables</h2>
          <div className={styles.variableForm}>
            {variableNames.length === 0 && (
              <p className={styles.muted}>No {"{{variables}}"} found in the template yet.</p>
            )}
            {variableNames.map((name) => (
              <div key={name} className={styles.variableRow}>
                <label className={styles.variableLabel}>{name}</label>
                <input
                  className={styles.modalInput}
                  value={variableValues[name] ?? ""}
                  onChange={(e) => setVariableValue(name, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.signingPanel}>
        <h2 className={styles.signingPanelTitle}>Send for Signing</h2>
        <div className={styles.participantRows}>
          {participantRows.map((row, i) => (
            <div key={i} className={styles.participantRow}>
              <input
                className={styles.modalInput}
                placeholder="Role (e.g. Landlord)"
                value={row.role}
                onChange={(e) => updateParticipantRow(i, { role: e.target.value })}
              />
              <input
                className={styles.modalInput}
                placeholder="Name (optional)"
                value={row.name}
                onChange={(e) => updateParticipantRow(i, { name: e.target.value })}
              />
              <input
                className={styles.modalInput}
                placeholder="Email"
                value={row.email}
                onChange={(e) => updateParticipantRow(i, { email: e.target.value })}
              />
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => removeParticipantRow(i)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className={styles.signingForm}>
          <button type="button" className={styles.smallButton} onClick={addParticipantRow}>
            + Add Participant
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={
              creatingSigningRequest ||
              !draftId ||
              participantRows.filter((r) => r.role.trim() && r.email.trim()).length === 0
            }
            onClick={createSigningRequest}
          >
            {creatingSigningRequest ? "Creating…" : "Create Signing Envelope"}
          </button>
        </div>
        {signingError && <p className={styles.errorBanner}>{signingError}</p>}
        {signingResult && (
          <div className={styles.signingLinkResult}>
            {signingResult.map((p, i) => (
              <p key={i}>
                <b>{p.role}</b> ({p.email}): <code>{p.signingUrl}</code>
                {p.emailSent ? " — emailed." : " — could not email; share manually."}
              </p>
            ))}
          </div>
        )}

        {signingRequests.length > 0 && (
          <table className={styles.signingTable}>
            <thead>
              <tr>
                <th>Document</th>
                <th>Participants</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {signingRequests.map((r) => (
                <tr key={r.id}>
                  <td>{r.document_id.slice(0, 8)}… ({r.status})</td>
                  <td>
                    {r.participants.map((p) => (
                      <div key={p.id}>
                        {p.role}: {p.name || p.email} — {p.status}
                      </div>
                    ))}
                  </td>
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
    </div>
  );
}
