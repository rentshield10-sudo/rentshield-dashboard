"use client";

import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./LeaseTemplateTab.module.css";
import { extractVariableNames } from "@/lib/template-vars";
import PdfPreviewModal from "@/components/pdf-preview/PdfPreviewModal";

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
  // True until staff directly edits this row's name in the Send for
  // Signing panel -- while true, the name keeps mirroring live from the
  // landlordName/tenant-name-box fields above (see
  // syncParticipantRowsFromVariables) instead of only filling once while
  // still blank, which would otherwise freeze at whatever partial value
  // existed after the very first keystroke typed above.
  autoLinkedName: boolean;
}

const DEFAULT_PARTICIPANT_ROWS: ParticipantFormRow[] = [
  { role: "Tenant", name: "", email: "", autoLinkedName: true },
  { role: "Landlord", name: "", email: "", autoLinkedName: true },
  {
    role: "Witness - Property Management",
    name: "Moises Mari",
    email: "almopropertiesllc@gmail.com",
    autoLinkedName: false,
  },
];

// Kept in sync with lib/template-vars.ts's VARIABLE_PATTERN -- allows
// dot-namespaced names (e.g. {{Appliance.type.1}}).
const VARIABLE_TOKEN_PATTERN = /\{\{([\w.]+)\}\}/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

interface TemplateBackdropProps {
  html: string;
  onFocus: (e: React.FocusEvent<HTMLDivElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onInput: (e: React.FormEvent<HTMLDivElement>) => void;
}

// Isolated + memoized so it only re-renders when `html` itself changes.
// Without this, ANY state change in the parent (e.g. highlightedVariable,
// updated purely to ring-highlight the matching right-pane input) causes
// React to recreate the `{ __html }` object passed to
// dangerouslySetInnerHTML and reset .innerHTML on this div regardless of
// whether the string value actually changed -- destroying whichever token
// span currently has focus mid-edit and kicking focus back to <body>
// (confirmed live via a MutationObserver: 51 nodes replaced immediately
// after a focus event, even though the html string itself never changed).
const TemplateBackdrop = memo(
  forwardRef<HTMLDivElement, TemplateBackdropProps>(function TemplateBackdrop(
    { html, onFocus, onBlur, onKeyDown, onInput },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={styles.templateTextareaBackdrop}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onInput={onInput}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }),
);

interface LeaseTemplateTabProps {
  initialDraftId?: number | null;
  // Reports unsaved-wording-edits state up to the dashboard shell, which
  // uses it to confirm before switching away to another tab. Full page
  // refresh/close is instead handled directly below via `beforeunload`.
  onDirtyChange?: (dirty: boolean) => void;
}

export default function LeaseTemplateTab({ initialDraftId = null, onDirtyChange }: LeaseTemplateTabProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const variableInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const [template, setTemplate] = useState<Template | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Snapshot of the template as last confirmed saved (on load and after a
  // successful "Save Template") -- compared against live `template` state
  // to know whether there are unsaved wording edits to warn about before
  // the user navigates away. Only meaningful in the master editor: in
  // apartment mode the body/name inputs are read-only, so this never
  // diverges there.
  const savedTemplateRef = useRef<{ name: string; body: string } | null>(null);
  function applyServerTemplate(t: Template) {
    setTemplate(t);
    savedTemplateRef.current = { name: t.name, body: t.body };
  }
  const isDirty = !!(
    template &&
    savedTemplateRef.current &&
    (template.name !== savedTemplateRef.current.name || template.body !== savedTemplateRef.current.body)
  );

  const [draftId, setDraftId] = useState<number | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [highlightedVariable, setHighlightedVariable] = useState<string | null>(null);
  const [apartmentInfo, setApartmentInfo] = useState<{ id: number; address: string; unit: string } | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  // tenantNames stays a single {{variable}} in the template (one clean
  // comma-joined string substituted into "the Lessee: {{tenantNames}}"),
  // but is edited here as separate add/remove-able boxes instead of one
  // comma-typed field -- this local array is the source of truth for the
  // boxes; variableValues.tenantNames is kept in sync as their join.
  const [tenantNameBoxes, setTenantNameBoxes] = useState<string[]>([""]);
  const [savingPdfStatus, setSavingPdfStatus] = useState(false);

  // Mirror "current" values for the stable (useCallback([])) backdrop
  // handlers below, so they never go stale despite never being recreated.
  // Synced via an effect rather than during render, per this project's
  // react-hooks/refs lint rule (no ref mutation in the render body).
  const variableValuesRef = useRef(variableValues);
  useEffect(() => {
    variableValuesRef.current = variableValues;
  }, [variableValues]);
  const setVariableValueRef = useRef<(name: string, value: string) => void>(() => {});
  useEffect(() => {
    setVariableValueRef.current = setVariableValue;
  });

  const [signingRequests, setSigningRequests] = useState<SigningRequestSummary[]>([]);
  const [participantRows, setParticipantRows] = useState<ParticipantFormRow[]>(DEFAULT_PARTICIPANT_ROWS);
  const [creatingSigningRequest, setCreatingSigningRequest] = useState(false);
  const [signingResult, setSigningResult] = useState<
    { role: string; email: string; signingUrl: string; emailSent: boolean }[] | null
  >(null);
  const [signingError, setSigningError] = useState("");

  // Warn on a full page refresh/close while there are unsaved wording
  // edits -- browsers ignore any custom message here and show their own
  // generic confirmation text.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Same signal, reported to the dashboard shell so it can confirm before
  // switching to a different sidebar tab (an in-app navigation that
  // beforeunload can't see).
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  // Clears the parent's flag once this tab unmounts (e.g. after the user
  // confirms leaving) so a stale "dirty" state can't block later switches
  // once this editor instance is gone. Deliberately separate from the
  // effect above -- an unmount-only cleanup, not one that reruns on every
  // isDirty change.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    return () => onDirtyChangeRef.current?.(false);
  }, []);

  // ── Load the template ─────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/lease-template/template")
      .then((res) => res.json())
      .then((json: { ok: boolean; error?: string; template?: Template }) => {
        if (!json.ok || !json.template) {
          setLoadError(json.error || "Could not load the lease template.");
          return;
        }
        applyServerTemplate(json.template);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Unexpected error."));
  }, []);

  // ── Load an existing draft's values, or create a fresh one, once ────
  useEffect(() => {
    const draftPromise = initialDraftId
      ? Promise.resolve({ ok: true, draft: { id: initialDraftId } })
      : fetch("/api/lease-template/drafts", { method: "POST", body: "{}" }).then((res) => res.json());

    draftPromise
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
          const boxes = map.tenantNames
            ? map.tenantNames.split(",").map((n) => n.trim()).filter(Boolean)
            : [];
          if (boxes.length > 0) setTenantNameBoxes(boxes);
          syncParticipantRowsFromVariables(map.landlordName ?? "", boxes);
        }
      })
      .catch(() => {
        /* variable filling still usable without persisted values loaded */
      });
  }, [initialDraftId]);

  // Auto-fills the "Send for Signing" participant names from what's
  // already been typed above (landlordName, the tenant name boxes -- which
  // themselves came from Rentvine's data when the draft was created) so
  // staff don't have to retype names that are already on the page. Only
  // fills blank name fields and adds a Tenant row per extra tenant name --
  // never overwrites a name staff already typed in this panel. Called
  // directly from the actions that change landlordName/tenant boxes
  // (setVariableValue, syncTenantNameBoxes, and the initial draft-values
  // load) rather than derived via an effect.
  function syncParticipantRowsFromVariables(landlordName: string, tenantNames: string[]) {
    setParticipantRows((prev) => {
      const rows = [...prev];

      const landlordIdx = rows.findIndex((r) => r.role === "Landlord");
      if (landlordIdx !== -1 && rows[landlordIdx].autoLinkedName) {
        rows[landlordIdx] = { ...rows[landlordIdx], name: landlordName.trim() };
      }

      // Deliberately NOT filtering out blank boxes before mapping by index
      // -- tenantRowIndexes below is built from ALL existing Tenant rows
      // (blank or not), so a filtered array would misalign the two lists
      // whenever an earlier box is still blank (e.g. box 1 empty, box 2
      // just filled in): the filtered array's index 0 would land on
      // tenantRowIndexes[0] -- box 1's row -- silently overwriting it
      // instead of creating box 2's own row.
      const tenantRowIndexes = rows.reduce<number[]>((acc, r, i) => {
        if (r.role === "Tenant") acc.push(i);
        return acc;
      }, []);

      tenantNames.forEach((rawName, i) => {
        const tenantName = rawName.trim();
        const rowIdx = tenantRowIndexes[i];
        if (rowIdx !== undefined) {
          if (rows[rowIdx].autoLinkedName) {
            rows[rowIdx] = { ...rows[rowIdx], name: tenantName };
          }
        } else {
          // Insert right after the last existing Tenant row (or at the
          // front if there isn't one yet) so extra tenants stay ahead of
          // Landlord/Witness rows -- matches the tenant1..N, landlord,
          // witness signing order shown here and enforced server-side.
          const lastTenantIdx = tenantRowIndexes[tenantRowIndexes.length - 1] ?? -1;
          rows.splice(lastTenantIdx + 1, 0, { role: "Tenant", name: tenantName, email: "", autoLinkedName: true });
          tenantRowIndexes.push(lastTenantIdx + 1);
        }
      });

      return rows;
    });
  }

  // Looks up whether this draft is tied to a specific apartment (opened via
  // Generate/Edit PDF from the Rentvine tab) vs. the standalone
  // master-template editor -- drives the header text and whether the
  // surrounding template wording is locked to editing just this unit.
  useEffect(() => {
    if (draftId === null) return;
    fetch(`/api/lease-template/drafts/${draftId}`)
      .then((res) => res.json())
      .then((json: { ok: boolean; draft?: { apartment: { id: number; address: string; unit: string } | null } }) => {
        if (json.ok && json.draft) setApartmentInfo(json.draft.apartment);
      })
      .catch(() => {
        /* header just falls back to the generic title */
      });
  }, [draftId]);

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

  // highlightedVariable is deliberately NOT a dependency here (see the
  // useEffect below instead): if it were, focusing a left-pane token would
  // immediately regenerate this whole innerHTML and destroy the very
  // (now-focused) span, kicking focus back to <body> -- confirmed live,
  // this was the actual root cause of clicks silently not working.
  const highlightedTemplateHtml = useMemo(() => {
    if (!template) return "";
    const pattern = new RegExp(VARIABLE_TOKEN_PATTERN);
    let html = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(template.body)) !== null) {
      html += escapeHtml(template.body.slice(lastIndex, match.index));
      const name = match[1];
      const value = variableValues[name];
      const filled = Boolean(value);
      const tokenClass = filled ? styles.variableTokenFilled : styles.variableToken;
      const displayText = filled ? value! : match[0];
      html += `<span class="${tokenClass}" data-varname="${escapeAttr(name)}" title="${escapeAttr(name)}" contenteditable="true" spellcheck="false">${escapeHtml(displayText)}</span>`;
      lastIndex = match.index + match[0].length;
    }
    html += escapeHtml(template.body.slice(lastIndex));
    return html;
  }, [template, variableValues]);

  // Applies the "active" ring to whichever left-pane token(s) match
  // highlightedVariable via direct DOM class toggling instead of baking it
  // into highlightedTemplateHtml -- classList.add/remove doesn't replace
  // any DOM nodes, so it can't steal focus from a token being edited the
  // way regenerating the innerHTML would. Re-runs after legitimate content
  // regenerations too (e.g. once an edit commits on blur) so the ring
  // stays correctly applied to the fresh nodes.
  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    backdrop.querySelectorAll<HTMLElement>("[data-varname]").forEach((span) => {
      span.classList.toggle(styles.variableTokenActive, span.dataset.varname === highlightedVariable);
    });
  }, [highlightedVariable, highlightedTemplateHtml]);

  // Tracks whether highlightedVariable's current value came from focusing
  // a left-pane token or a right-pane input, for the recovery effect below.
  const lastFocusSourceRef = useRef<"left" | "right" | null>(null);

  // Recovery for a narrower race than the one above: clicking DIRECTLY from
  // one left-pane token into another commits the first token's value
  // (legitimately changing highlightedTemplateHtml) in the same browser
  // event that focuses the second token. Since TemplateBackdrop's memo only
  // guards against *unrelated* re-renders, this particular regen is real
  // and still replaces every span -- including the one that had just
  // received focus a moment earlier, before it had a chance to "stick".
  // Once the regen settles, if focus was actually lost (fell to <body>)
  // and the left pane was the source, re-apply it to the freshly
  // recreated node for that variable.
  useEffect(() => {
    if (!highlightedVariable || lastFocusSourceRef.current !== "left") return;
    if (document.activeElement !== document.body) return;
    const span = backdropRef.current?.querySelector<HTMLElement>(
      `[data-varname="${CSS.escape(highlightedVariable)}"]`,
    );
    if (!span) return;
    span.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(span);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [highlightedVariable, highlightedTemplateHtml]);

  // Wrapped in useCallback with an empty dep array so TemplateBackdrop's
  // memo() never sees these props change -- they read "current" values via
  // the refs below instead of closing over state directly, avoiding stale
  // closures while keeping the function identity permanently stable.
  const handleBackdropFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const tokenEl = (e.target as HTMLElement).closest<HTMLElement>("[data-varname]");
    if (!tokenEl?.dataset.varname) return;
    lastFocusSourceRef.current = "left";
    setHighlightedVariable(tokenEl.dataset.varname);
    variableInputRefs.current.get(tokenEl.dataset.varname)?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Select the token's whole current text on focus, matching the
    // right-pane inputs' .select() -- otherwise a click lands mid-text
    // (like any text field) and typing inserts instead of replacing.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(tokenEl);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [setHighlightedVariable]);

  // Live-mirrors each keystroke into the matching right-pane input's DOM
  // value directly (bypassing React state) so it visibly keeps up while
  // typing, without ever touching variableValues -- doing that would
  // recompute highlightedTemplateHtml and regenerate the backdrop on every
  // keystroke, destroying the very span being typed into (see
  // handleBackdropBlur below for why the real commit is deferred to blur
  // instead). Since the input is React-controlled, this mirrored value
  // gets overwritten on the next unrelated re-render of this component --
  // harmless, since the real commit on blur will have landed the true
  // value in variableValues by then anyway.
  const handleBackdropInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const tokenEl = (e.target as HTMLElement).closest<HTMLElement>("[data-varname]");
    const name = tokenEl?.dataset.varname;
    if (!name) return;
    const input = variableInputRefs.current.get(name);
    if (input) input.value = tokenEl.textContent ?? "";
  }, []);

  // Commits the token's edited text back into variableValues (which also
  // persists it and updates the matching right-pane input) once the user
  // finishes editing it -- not on every keystroke, since that would replace
  // the whole backdrop's innerHTML (see highlightedTemplateHtml) mid-type
  // and destroy the very element being edited.
  const handleBackdropBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const tokenEl = (e.target as HTMLElement).closest<HTMLElement>("[data-varname]");
    const name = tokenEl?.dataset.varname;
    if (!name) return;
    // Values are single-line substitutions -- collapse any line breaks a
    // multi-line paste could have introduced into the contenteditable span.
    const value = (tokenEl.textContent ?? "").replace(/\s+/g, " ").trim();
    // Deferred to a macrotask: committing synchronously here would
    // regenerate the backdrop (variableValues change) within the same
    // browser task as this blur -- i.e. BEFORE the browser's native
    // focus-follows-click has focused whatever the user actually clicked
    // on. That destroys the click's real target out from under it, so its
    // own focus event never even fires (confirmed live: clicking directly
    // from one token into another produced zero FOCUSIN for the second
    // token). Deferring lets that focus transition complete first; the
    // regen still happens right after, but by then highlightedVariable
    // already correctly names the newly-focused token, so the recovery
    // effect above can re-apply focus to it once the regen settles.
    setTimeout(() => setVariableValueRef.current(name, value), 0);
    setHighlightedVariable((prev) => (prev === name ? null : prev));
  }, [setHighlightedVariable]);

  const handleBackdropKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const tokenEl = (e.target as HTMLElement).closest<HTMLElement>("[data-varname]");
    if (!tokenEl?.dataset.varname) return;
    if (e.key === "Enter") {
      e.preventDefault();
      tokenEl.blur();
    } else if (e.key === "Escape") {
      const name = tokenEl.dataset.varname;
      tokenEl.textContent = variableValuesRef.current[name] || `{{${name}}}`;
      tokenEl.blur();
    }
  }, []);

  function handleTextareaScroll() {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }

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
      applyServerTemplate(json.template);
      setSaveMessage("Saved.");
    } finally {
      setSaving(false);
    }
  }

  // Per-apartment "Save": never touches the shared template wording (see
  // saveTemplate above, used only in the standalone master-template
  // editor) -- just flushes whatever variable is actively being edited
  // (its real commit is normally deferred to a macrotask on blur, see
  // handleBackdropBlur) and marks this unit's PDF-created milestone.
  async function saveApartmentDraft() {
    if (!apartmentInfo) return;
    setSavingPdfStatus(true);
    setSaveMessage("");
    try {
      const active = document.activeElement as HTMLElement | null;
      const activeName = active?.dataset.varname;
      if (activeName) {
        const value = (active.textContent ?? "").replace(/\s+/g, " ").trim();
        await setVariableValue(activeName, value);
      }
      const res = await fetch(`/api/rentvine/apartment-details/${apartmentInfo.id}/mark-pdf-created`, {
        method: "POST",
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        setSaveMessage(json.error || "Could not save.");
        return;
      }
      setSaveMessage("Saved.");
    } finally {
      setSavingPdfStatus(false);
    }
  }

  function viewPdf() {
    if (draftId === null) return;
    setPdfPreviewUrl(`/api/lease-template/drafts/${draftId}/preview-pdf`);
  }

  async function setVariableValue(name: string, value: string) {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
    if (name === "landlordName") syncParticipantRowsFromVariables(value, tenantNameBoxes);
    if (draftId === null) return;
    await fetch(`/api/lease-template/drafts/${draftId}/values`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variableName: name, value }),
    });
  }

  function syncTenantNameBoxes(boxes: string[]) {
    setTenantNameBoxes(boxes);
    setVariableValue(
      "tenantNames",
      boxes.map((b) => b.trim()).filter(Boolean).join(", "),
    );
    syncParticipantRowsFromVariables(variableValues.landlordName ?? "", boxes);
  }

  function updateTenantNameBox(index: number, value: string) {
    const next = [...tenantNameBoxes];
    next[index] = value;
    syncTenantNameBoxes(next);
  }

  function addTenantNameBox() {
    syncTenantNameBoxes([...tenantNameBoxes, ""]);
  }

  function removeTenantNameBox(index: number) {
    const next = tenantNameBoxes.filter((_, i) => i !== index);
    syncTenantNameBoxes(next.length > 0 ? next : [""]);
  }

  function updateParticipantRow(index: number, patch: Partial<ParticipantFormRow>) {
    setParticipantRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        // Editing the name directly detaches this row from the
        // landlordName/tenant-box auto-fill for good -- otherwise the next
        // keystroke typed above would immediately overwrite what staff
        // just typed here.
        const detach = "name" in patch ? { autoLinkedName: false } : {};
        return { ...row, ...patch, ...detach };
      }),
    );
  }

  function addParticipantRow() {
    setParticipantRows((prev) => [...prev, { role: "", name: "", email: "", autoLinkedName: false }]);
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
        <h1>
          {apartmentInfo
            ? `Editing ${apartmentInfo.address}${apartmentInfo.unit ? ` ${apartmentInfo.unit}` : ""}`
            : "Lease Template"}
        </h1>
        {draftId !== null && <span className={styles.sessionId}>Session #{draftId}</span>}
      </div>

      <div className={styles.editorLayout}>
        <div className={styles.editorPane}>
          <input
            className={styles.templateNameInput}
            value={template.name}
            onChange={(e) => setTemplate({ ...template, name: e.target.value })}
            readOnly={!!apartmentInfo}
            title={apartmentInfo ? "Template name can only be changed in the master template editor" : undefined}
          />

          {!apartmentInfo && (
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
          )}

          <div className={styles.templateTextareaWrap}>
            <TemplateBackdrop
              ref={backdropRef}
              html={highlightedTemplateHtml}
              onFocus={handleBackdropFocus}
              onBlur={handleBackdropBlur}
              onKeyDown={handleBackdropKeyDown}
              onInput={handleBackdropInput}
            />
            <textarea
              ref={textareaRef}
              className={styles.templateTextarea}
              value={template.body}
              onChange={(e) => setTemplate({ ...template, body: e.target.value })}
              onScroll={handleTextareaScroll}
              spellCheck={false}
              readOnly={!!apartmentInfo}
              title={
                apartmentInfo
                  ? "The surrounding wording is shared across every apartment and can only be edited in the master template editor -- the {{variables}} above stay editable"
                  : undefined
              }
            />
          </div>

          <div className={styles.editorActions}>
            {apartmentInfo ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={saveApartmentDraft}
                disabled={savingPdfStatus}
              >
                {savingPdfStatus ? "Saving…" : "Save"}
              </button>
            ) : (
              <button type="button" className={styles.primaryButton} onClick={saveTemplate} disabled={saving}>
                {saving ? "Saving…" : "Save Template"}
              </button>
            )}
            <button type="button" className={styles.smallButton} onClick={viewPdf} disabled={draftId === null}>
              View PDF
            </button>
            {saveMessage && <span className={styles.saveMessage}>{saveMessage}</span>}
          </div>
        </div>

        <div className={styles.previewPane}>
          <h2 className={styles.sectionTitle}>Variables</h2>
          <div className={styles.variableForm}>
            {variableNames.length === 0 && (
              <p className={styles.muted}>No {"{{variables}}"} found in the template yet.</p>
            )}
            {variableNames.map((name) => (
              <div key={name} className={styles.variableRow}>
                <label className={styles.variableLabel}>
                  <span>{name}</span>
                  <span className={styles.variableLabelToken}>{`{{${name}}}`}</span>
                </label>
                {name === "tenantNames" ? (
                  <div className={styles.tenantNameBoxes}>
                    {tenantNameBoxes.map((box, i) => (
                      <div key={i} className={styles.tenantNameBoxRow}>
                        <input
                          ref={
                            i === 0
                              ? (el) => {
                                  if (el) variableInputRefs.current.set(name, el);
                                  else variableInputRefs.current.delete(name);
                                }
                              : undefined
                          }
                          className={
                            highlightedVariable === name
                              ? `${styles.modalInput} ${styles.inputHighlighted}`
                              : styles.modalInput
                          }
                          placeholder={`Tenant ${i + 1} name`}
                          value={box}
                          onChange={(e) => updateTenantNameBox(i, e.target.value)}
                          onFocus={() => {
                            lastFocusSourceRef.current = "right";
                            setHighlightedVariable(name);
                          }}
                          onBlur={() => setHighlightedVariable((prev) => (prev === name ? null : prev))}
                        />
                        <button
                          type="button"
                          className={styles.tenantNameRemoveButton}
                          onClick={() => removeTenantNameBox(i)}
                          disabled={tenantNameBoxes.length <= 1}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button type="button" className={styles.smallButton} onClick={addTenantNameBox}>
                      + Add Tenant
                    </button>
                  </div>
                ) : (
                  <input
                    ref={(el) => {
                      if (el) variableInputRefs.current.set(name, el);
                      else variableInputRefs.current.delete(name);
                    }}
                    className={
                      highlightedVariable === name
                        ? `${styles.modalInput} ${styles.inputHighlighted}`
                        : styles.modalInput
                    }
                    value={variableValues[name] ?? ""}
                    onChange={(e) => setVariableValue(name, e.target.value)}
                    onFocus={() => {
                      lastFocusSourceRef.current = "right";
                      setHighlightedVariable(name);
                    }}
                    onBlur={() => setHighlightedVariable((prev) => (prev === name ? null : prev))}
                  />
                )}
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

      {pdfPreviewUrl && (
        <PdfPreviewModal url={pdfPreviewUrl} title="Lease Preview" onClose={() => setPdfPreviewUrl(null)} />
      )}
    </div>
  );
}
