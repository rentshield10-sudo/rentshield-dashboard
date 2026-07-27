"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import styles from "./MessagesTab.module.css";

type AutomationStatus =
    | "idle"
    | "fetching"
    | "new_message"
    | "new_message_received"
    | "matching_lead"
    | "choosing_template"
    | "template_selected"
    | "queued"
    | "sending"
    | "updating_pipeline"
    | "pipeline_updated"
    | "human_review"
    | "webhook_ignored"
    | "webhook_duplicate"
    | "confirmation_inbox_message_not_processed_by_requirements_flow"
    | "non_primary_inbox_message_ignored"
    | "error";

type DecisionLog = {
    id: number;
    created_at?: string;
    intent?: string | null;
    decision?: string | null;
    reply_text?: string | null;
    needs_human?: boolean | null;
    human_reason?: string | null;
    should_send?: boolean | null;
    sent?: boolean | null;
    error?: string | null;
    model_used?: string | null;
    prompt_version?: string | null;
};

type HumanEscalation = {
    id: number;
    created_at?: string;
    updated_at?: string;
    phone?: string | null;
    reason?: string | null;
    priority?: string | null;
    status?: string | null;
    human_notes?: string | null;
    resolved_at?: string | null;
};

type MonitorState = {
    id: string;
    polling_enabled: boolean;
    interval_minutes: number;
    status: AutomationStatus;
    last_checked_at?: string | null;
    updated_at?: string;
};

type DecisionPayload = {
    phone?: string | null;
    inboundText?: string | null;
    templateKey?: string | null;
    messagePreview?: string | null;
    lead?: {
        lead_id?: string | null;
        lead_name?: string | null;
        phone?: string | null;
        apt_address?: string | null;
        current_status?: string | null;
        conversation_stage?: string | null;
        pipeline_status?: string | null;
    } | null;
    reason?: string | null;
    nextStep?: string | null;
    webhook?: {
        eventType?: string | null;
        externalMessageId?: string | null;
        externalConversationId?: string | null;
        phoneNumberId?: string | null;
        createdAt?: string | null;
    } | null;
    quoSenderTemplateResponse?: Record<string, unknown> | null;
    anyClickPayload?: Record<string, unknown> | null;
    anyClickResult?: unknown;
    pipelineUpdate?: unknown;
};

type TemplateQueueItem = {
    id: number;
    created_at?: string;
    phone?: string | null;
    leadName?: string | null;
    apartment?: string | null;
    templateKey?: string | null;
    messagePreview?: string | null;
    status: "pending" | "running" | "completed" | "failed";
    error?: string | null;
    decision: DecisionLog;
    payload: DecisionPayload | null;
};

type HumanReviewLead = {
    lead_id?: string | null;
    lead_name?: string | null;
    phone?: string | null;
    apt_address?: string | null;
    current_status?: string | null;
    conversation_stage?: string | null;
    pipeline_status?: string | null;
};

type HumanReviewDetail = {
    escalation: HumanEscalation;
    lead?: HumanReviewLead | null;
    phone?: string | null;
    aptAddress?: string | null;
    inboundText?: string | null;
    humanNotes?: Record<string, unknown> | null;
};

type ReviewMessage = {
    id: number | string;
    created_at?: string | null;
    phone?: string | null;
    channel?: string | null;
    direction?: string | null;
    message_text?: string | null;
    intent?: string | null;
};

type QuoSenderTemplate = {
    id: string;
    name: string;
    body?: string | null;
};

type ManualSendJob = {
    id: number;
    created_at?: string | null;
    updated_at?: string | null;
    escalation_id?: number | null;
    lead_id?: string | null;
    phone?: string | null;
    apt_address?: string | null;
    template_key?: string | null;
    message_text?: string | null;
    status: "queued" | "sending" | "sent" | "failed";
    error?: string | null;
    sent_at?: string | null;
};

const statusLabels: Record<AutomationStatus, string> = {
    idle: "Idle",
    fetching: "Fetching Messages",
    new_message: "New Message Received",
    new_message_received: "New Message Received",
    matching_lead: "Matching Lead",
    choosing_template: "Choosing Template",
    template_selected: "Template Selected",
    queued: "Queued",
    sending: "Sending",
    updating_pipeline: "Updating Pipeline",
    pipeline_updated: "Pipeline Updated",
    human_review: "Needs Human Review",
    webhook_ignored: "Webhook Ignored",
    webhook_duplicate: "Webhook Duplicate",
    confirmation_inbox_message_not_processed_by_requirements_flow:
        "Confirmation Inbox Message",
    non_primary_inbox_message_ignored: "Non-primary Inbox Ignored",
    error: "Error",
};

function parseHumanNotes(notes?: string | null) {
    if (!notes) return null;

    try {
        return JSON.parse(notes) as {
            source?: string;
            quo_conversation_id?: string | null;
            inbound_text?: string | null;
            message_count?: number | null;
            newest_message_at?: string | null;
            matched_count?: number | null;
            lead_lookup_error?: string | null;
        };
    } catch {
        return null;
    }
}

function parseDecisionPayload(replyText?: string | null): DecisionPayload | null {
    if (!replyText) return null;

    try {
        const parsed = JSON.parse(replyText) as DecisionPayload;

        if (
            parsed &&
            typeof parsed === "object" &&
            ("lead" in parsed ||
                "messagePreview" in parsed ||
                "templateKey" in parsed ||
                "inboundText" in parsed ||
                "webhook" in parsed)
        ) {
            return parsed;
        }

        return null;
    } catch {
        return null;
    }
}

function formatDecisionLabel(value?: string | null) {
    if (!value) return "Decision";

    return value
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function getQueueStatus(decision: DecisionLog): TemplateQueueItem["status"] {
    const decisionName = decision.decision || "";

    if (decision.sent || decisionName === "template_sent") {
        return "completed";
    }

    if (
        decision.error ||
        decisionName === "template_send_failed" ||
        decisionName === "template_sent_but_pipeline_update_failed" ||
        decisionName === "webhook_error"
    ) {
        return "failed";
    }

    if (decisionName === "sending") {
        return "running";
    }

    return "pending";
}

function isTemplateQueueDecision(decision: DecisionLog, payload: DecisionPayload | null) {
    const decisionName = decision.decision || "";

    if (
        decisionName === "template_selected" ||
        decisionName === "template_sent" ||
        decisionName === "template_send_failed" ||
        decisionName === "template_sent_but_pipeline_update_failed"
    ) {
        return true;
    }

    if (decision.should_send && payload?.templateKey) {
        return true;
    }

    return false;
}

function DetailRow({
    label,
    value,
}: {
    label: string;
    value?: string | number | null;
}) {
    if (value === null || value === undefined || value === "") return null;

    return (
        <div className={styles.detailRow}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

export default function MessagesTab() {
    const [status, setStatus] = useState<AutomationStatus>("idle");
    const [pollingEnabled, setPollingEnabled] = useState(false);
    const [intervalMinutes, setIntervalMinutes] = useState(2);
    const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
    const [showDebugInbox, setShowDebugInbox] = useState(false);
    const [humanEscalations, setHumanEscalations] = useState<HumanEscalation[]>(
        []
    );
    const [decisionsLog, setDecisionsLog] = useState<DecisionLog[]>([]);
    const [loadingMonitor, setLoadingMonitor] = useState(true);

    const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
    const [selectedReview, setSelectedReview] = useState<HumanReviewDetail | null>(null);
    const [reviewMessages, setReviewMessages] = useState<ReviewMessage[]>([]);
    const [reviewMessagesCursor, setReviewMessagesCursor] = useState<string | null>(null);
    const [reviewMessagesHasMore, setReviewMessagesHasMore] = useState(false);
    const [templates, setTemplates] = useState<QuoSenderTemplate[]>([]);
    const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null);
    const [composerText, setComposerText] = useState("");
    const [manualQueue, setManualQueue] = useState<ManualSendJob[]>([]);
    const [loadingReview, setLoadingReview] = useState(false);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
    const [renderingTemplate, setRenderingTemplate] = useState(false);
    const [addingToQueue, setAddingToQueue] = useState(false);
    const [queueNotice, setQueueNotice] = useState<string | null>(null);
    const [workstationError, setWorkstationError] = useState<string | null>(null);
    const [updatingReviewStatusIds, setUpdatingReviewStatusIds] = useState<Record<number, boolean>>({});

    const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isRunningRef = useRef(false);

    const currentStatusLabel = statusLabels[status] || status;

    const templateQueue = useMemo<TemplateQueueItem[]>(() => {
        return decisionsLog
            .map((decision) => {
                const payload = parseDecisionPayload(decision.reply_text);

                if (!isTemplateQueueDecision(decision, payload)) return null;

                return {
                    id: decision.id,
                    created_at: decision.created_at,
                    phone: payload?.phone,
                    leadName: payload?.lead?.lead_name,
                    apartment: payload?.lead?.apt_address,
                    templateKey: payload?.templateKey,
                    messagePreview: payload?.messagePreview,
                    status: getQueueStatus(decision),
                    error: decision.error,
                    decision,
                    payload,
                };
            })
            .filter(Boolean) as TemplateQueueItem[];
    }, [decisionsLog]);

    const queueStats = {
        pending: templateQueue.filter((item) => item.status === "pending").length,
        running: templateQueue.filter((item) => item.status === "running").length,
        sent: templateQueue.filter((item) => item.status === "completed").length,
        failed: templateQueue.filter((item) => item.status === "failed").length,
        humanReview: humanEscalations.length,
    };

    const statusDescription = useMemo(() => {
        switch (status) {
            case "idle":
                return pollingEnabled
                    ? "Automation state is idle. Polling is running and waiting for the next check."
                    : "No message is currently being processed.";
            case "fetching":
                return "Checking Quo/OpenPhone for new inbound replies.";
            case "new_message":
            case "new_message_received":
                return "A webhook message was received. Mission Control is ready to process it.";
            case "matching_lead":
                return "Matching the inbound phone number to one eligible dashboard lead.";
            case "choosing_template":
                return "Calling QuoSender to render the selected template by apartment address.";
            case "template_selected":
                return "A template reply was selected and is waiting to be sent.";
            case "queued":
                return "Template reply was added to the sending queue.";
            case "sending":
                return "Sending template reply through AnyClick.";
            case "updating_pipeline":
                return "Send succeeded. Updating the lead pipeline.";
            case "pipeline_updated":
                return "Send succeeded and the lead pipeline was updated.";
            case "human_review":
                return "Automation stopped. This item needs manual review.";
            case "webhook_ignored":
                return "Webhook was received but ignored because it was not an eligible inbound message.";
            case "webhook_duplicate":
                return "Webhook was received but ignored because the message was already processed.";
            case "confirmation_inbox_message_not_processed_by_requirements_flow":
                return "Confirmation inbox message was received, but requirements automation did not process it.";
            case "non_primary_inbox_message_ignored":
                return "Message came from a non-primary inbox and was ignored by this automation.";
            case "error":
                return "An error occurred while processing the message.";
            default:
                return "Automation status updated.";
        }
    }, [status, pollingEnabled]);

    const applyMonitorPayload = (payload: {
        state?: MonitorState;
        decisions?: DecisionLog[];
        decisionsLog?: DecisionLog[];
        humanEscalations?: HumanEscalation[];
    }) => {
        if (payload.state) {
            setStatus(payload.state.status || "idle");
            setPollingEnabled(Boolean(payload.state.polling_enabled));
            setIntervalMinutes(payload.state.interval_minutes || 2);
            setLastCheckedAt(payload.state.last_checked_at || null);
        }

        if (payload.decisionsLog) {
            setDecisionsLog(payload.decisionsLog);
        } else if (payload.decisions) {
            setDecisionsLog(payload.decisions);
        }

        if (payload.humanEscalations) {
            setHumanEscalations(payload.humanEscalations);
        }
    };

    const fetchMonitor = async () => {
        try {
            const res = await fetch("/api/messages-automation/monitor", {
                cache: "no-store",
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                console.error("Failed to load monitor:", json);
                return;
            }

            applyMonitorPayload(json);
        } catch (error) {
            console.error("Failed to load monitor:", error);
        } finally {
            setLoadingMonitor(false);
        }
    };

    const updateMonitorSettings = async (payload: {
        pollingEnabled?: boolean;
        intervalMinutes?: number;
        status?: AutomationStatus;
    }) => {
        try {
            const res = await fetch("/api/messages-automation/monitor", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                console.error("Failed to update monitor settings:", json);
                return;
            }

            applyMonitorPayload({ state: json.state });
        } catch (error) {
            console.error("Failed to update monitor settings:", error);
        }
    };

    const clearMonitor = async () => {
        try {
            const res = await fetch("/api/messages-automation/monitor", {
                method: "DELETE",
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                console.error("Failed to clear monitor:", json);
                return;
            }

            applyMonitorPayload(json);
        } catch (error) {
            console.error("Failed to clear monitor:", error);
        }
    };

    const runNow = async (ignoreCheckpoint = false) => {
        if (isRunningRef.current) return;

        isRunningRef.current = true;
        setStatus("fetching");

        try {
            const endpoint = ignoreCheckpoint
                ? "/api/messages-automation/run-now?ignoreCheckpoint=1"
                : "/api/messages-automation/run-now";

            const res = await fetch(endpoint, {
                method: "POST",
            });

            const json = await res.json();

            console.log("Automation run result:", json);

            if (!res.ok || !json.ok) {
                setStatus("error");
                await fetchMonitor();
                return;
            }

            applyMonitorPayload(json);
        } catch (error) {
            console.error(error);
            setStatus("error");
            await fetchMonitor();
        } finally {
            isRunningRef.current = false;
        }
    };

    const selectedAptAddress =
        selectedReview?.aptAddress || selectedReview?.lead?.apt_address || null;

    const selectedPhone =
        selectedReview?.phone ||
        selectedReview?.lead?.phone ||
        selectedReview?.escalation?.phone ||
        null;

    function getTemplateKey(template: QuoSenderTemplate) {
        return template.name || template.id;
    }

    function getReviewDateValue(item: HumanEscalation) {
        const notes = parseHumanNotes(item.human_notes);
        return item.created_at || notes?.newest_message_at || item.updated_at || null;
    }

    function getReviewDateKey(item: HumanEscalation) {
        const value = getReviewDateValue(item);
        if (!value) return "No date";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "No date";

        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function getReviewDateLabel(item: HumanEscalation) {
        const value = getReviewDateValue(item);
        if (!value) return "No date";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "No date";

        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        const sameDay = (a: Date, b: Date) =>
            a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate();

        if (sameDay(date, today)) return "Today";
        if (sameDay(date, yesterday)) return "Yesterday";

        return date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
        });
    }

    function getReviewQueueStatus(item: HumanEscalation) {
        const relatedJob = manualQueue.find((job) => job.escalation_id === item.id);

        if (relatedJob?.status === "queued") {
            return {
                label: "Added to queue",
                className: styles.reviewHubStatusQueued,
                reviewed: false,
            };
        }

        if (relatedJob?.status === "sending") {
            return {
                label: "Sending",
                className: styles.reviewHubStatusSending,
                reviewed: false,
            };
        }

        if (relatedJob?.status === "sent") {
            return {
                label: "Message sent",
                className: styles.reviewHubStatusDone,
                reviewed: true,
            };
        }

        if (relatedJob?.status === "failed") {
            return {
                label: "Failed",
                className: styles.reviewHubStatusFailed,
                reviewed: false,
            };
        }

        if (item.status === "resolved" || item.resolved_at) {
            return {
                label: "Done",
                className: styles.reviewHubStatusDone,
                reviewed: true,
            };
        }

        return {
            label: "Not reviewed",
            className: styles.reviewHubStatusOpen,
            reviewed: false,
        };
    }

    const setReviewStatus = async (
        item: HumanEscalation,
        nextStatus: "open" | "resolved"
    ) => {
        const now = new Date().toISOString();
        const nextResolvedAt = nextStatus === "resolved" ? now : null;

        setUpdatingReviewStatusIds((current) => ({
            ...current,
            [item.id]: true,
        }));

        // Optimistic update so the left pane changes immediately and the row stays visible.
        setHumanEscalations((current) =>
            current.map((row) =>
                row.id === item.id
                    ? {
                        ...row,
                        status: nextStatus,
                        resolved_at: nextResolvedAt,
                        updated_at: now,
                    }
                    : row
            )
        );

        setSelectedReview((current) => {
            if (!current || current.escalation.id !== item.id) return current;

            return {
                ...current,
                escalation: {
                    ...current.escalation,
                    status: nextStatus,
                    resolved_at: nextResolvedAt,
                    updated_at: now,
                },
            };
        });

        try {
            const res = await fetch(`/api/messages-automation/human-review/${item.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: nextStatus }),
            });

            const responseText = await res.text();
            let json: any = null;

            try {
                json = responseText ? JSON.parse(responseText) : null;
            } catch {
                json = null;
            }

            if (!res.ok || !json?.ok) {
                throw new Error(
                    json?.error ||
                    responseText ||
                    `Failed to update review status. HTTP ${res.status}`
                );
            }

            if (json.escalation) {
                setHumanEscalations((current) =>
                    current.map((row) =>
                        row.id === item.id ? { ...row, ...json.escalation } : row
                    )
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Use warn so Next dev overlay does not cover the page for expected API failures.
            console.warn("Failed to update review status:", message);
            setWorkstationError(message);
            // Put the row back if the API failed.
            await fetchMonitor();
        } finally {
            setUpdatingReviewStatusIds((current) => {
                const next = { ...current };
                delete next[item.id];
                return next;
            });
        }
    };

    const fetchTemplates = async () => {
        setLoadingTemplates(true);

        try {
            const res = await fetch("/api/messages-automation/templates", {
                cache: "no-store",
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                throw new Error(json.error || "Failed to load templates");
            }

            setTemplates(json.templates || []);
        } catch (error) {
            console.error("Failed to load templates:", error);
            setWorkstationError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingTemplates(false);
        }
    };

    const fetchManualQueue = async () => {
        try {
            const res = await fetch("/api/messages-automation/human-review/send-queue", {
                cache: "no-store",
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                throw new Error(json.error || "Failed to load manual queue");
            }

            setManualQueue(json.jobs || []);
        } catch (error) {
            console.error("Failed to load manual queue:", error);
        }
    };

    const fetchReviewMessages = async (phone: string, reset = true) => {
        if (reset) {
            setLoadingMessages(true);
            setReviewMessages([]);
            setReviewMessagesCursor(null);
            setReviewMessagesHasMore(false);
        } else {
            setLoadingOlderMessages(true);
        }

        try {
            const cursorParam =
                !reset && reviewMessagesCursor
                    ? `&cursor=${encodeURIComponent(reviewMessagesCursor)}`
                    : "";

            const res = await fetch(
                `/api/messages-automation/human-review/messages?phone=${encodeURIComponent(
                    phone
                )}&limit=5${cursorParam}`,
                { cache: "no-store" }
            );

            const json = await res.json();

            if (!res.ok || !json.ok) {
                throw new Error(json.error || "Failed to load messages");
            }

            const incoming = (json.messages || []) as ReviewMessage[];
            const chatOrder = incoming.slice().reverse();

            if (reset) {
                setReviewMessages(chatOrder);
            } else {
                setReviewMessages((current) => [...chatOrder, ...current]);
            }

            setReviewMessagesCursor(json.nextCursor || null);
            setReviewMessagesHasMore(Boolean(json.hasMore));
        } catch (error) {
            console.error("Failed to load review messages:", error);
            setWorkstationError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingMessages(false);
            setLoadingOlderMessages(false);
        }
    };

    const openHumanReview = async (item: HumanEscalation) => {
        setSelectedReviewId(item.id);
        setSelectedReview(null);
        setReviewMessages([]);
        setComposerText("");
        setSelectedTemplateKey(null);
        setWorkstationError(null);
        setQueueNotice(null);
        setLoadingReview(true);

        try {
            const res = await fetch(`/api/messages-automation/human-review/${item.id}`, {
                cache: "no-store",
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                throw new Error(json.error || "Failed to load Human Review detail");
            }

            const detail = json as HumanReviewDetail;
            setSelectedReview(detail);

            const phone =
                detail.phone || detail.lead?.phone || detail.escalation?.phone || item.phone;

            if (phone) {
                await fetchReviewMessages(phone, true);
            }

            await fetchManualQueue();
        } catch (error) {
            console.error("Failed to open Human Review:", error);
            setWorkstationError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingReview(false);
        }
    };

    const loadOlderReviewMessages = async () => {
        if (!selectedPhone || !reviewMessagesHasMore || loadingOlderMessages) return;
        await fetchReviewMessages(selectedPhone, false);
    };

    const renderTemplate = async (template: QuoSenderTemplate) => {
        if (!selectedAptAddress) {
            setWorkstationError("No apartment address found for this Human Review item.");
            return;
        }

        const templateKey = getTemplateKey(template);

        setRenderingTemplate(true);
        setSelectedTemplateKey(templateKey);
        setWorkstationError(null);
        setQueueNotice(null);

        try {
            const res = await fetch("/api/messages-automation/human-review/render-template", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    aptAddress: selectedAptAddress,
                    templateKey,
                }),
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                throw new Error(json.error || "Failed to render template");
            }

            setComposerText(json.message || "");
        } catch (error) {
            console.error("Failed to render template:", error);
            setWorkstationError(error instanceof Error ? error.message : String(error));
        } finally {
            setRenderingTemplate(false);
        }
    };

    const processNextQueueJob = async () => {
        try {
            await fetch(
                "/api/messages-automation/human-review/send-queue/process-next",
                { method: "POST" }
            );

            await fetchManualQueue();
            // Keep the selected review visible in the left pane so its status can show
            // "Message sent" instead of disappearing immediately after the escalation resolves.
        } catch (error) {
            console.error("Failed to process next queue job:", error);
            await fetchManualQueue();
        }
    };

    const addManualSendToQueue = async () => {
        if (!selectedReview) return;

        if (!selectedPhone) {
            setWorkstationError("No phone number found for this Human Review item.");
            return;
        }

        if (!composerText.trim()) {
            setWorkstationError("Message is empty.");
            return;
        }

        setAddingToQueue(true);
        setWorkstationError(null);
        setQueueNotice(null);

        try {
            const res = await fetch("/api/messages-automation/human-review/send-queue", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    escalationId: selectedReview.escalation.id,
                    leadId: selectedReview.lead?.lead_id || null,
                    phone: selectedPhone,
                    aptAddress: selectedAptAddress,
                    templateKey: selectedTemplateKey,
                    message: composerText,
                }),
            });

            const json = await res.json();

            if (!res.ok || !json.ok) {
                throw new Error(json.error || "Failed to add message to queue");
            }

            setQueueNotice("Added to queue");
            setComposerText("");
            await fetchManualQueue();

            setTimeout(() => {
                processNextQueueJob();
            }, 500);
        } catch (error) {
            console.error("Failed to add manual send to queue:", error);
            setWorkstationError(error instanceof Error ? error.message : String(error));
        } finally {
            setAddingToQueue(false);
        }
    };

    useEffect(() => {
        fetchMonitor();
    }, []);

    useEffect(() => {
        fetchTemplates();
        fetchManualQueue();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!pollingEnabled) {
            if (pollingTimerRef.current) {
                clearInterval(pollingTimerRef.current);
                pollingTimerRef.current = null;
            }
            return;
        }

        runNow();

        pollingTimerRef.current = setInterval(() => {
            runNow();
        }, Math.max(intervalMinutes, 1) * 60 * 1000);

        return () => {
            if (pollingTimerRef.current) {
                clearInterval(pollingTimerRef.current);
                pollingTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pollingEnabled, intervalMinutes]);

    return (
        <section className={styles.messagesPage}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>Messages</p>
                    <h1>Automation Monitor</h1>
                    <p className={styles.subtitle}>
                        Watch inbound replies, auto-send jobs, human review, and lead
                        pipeline updates.
                    </p>
                </div>

                <div className={styles.headerActions}>
                    <a
                        className={styles.secondaryButton}
                        href="http://localhost:3000"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Open QuoSender Templates
                    </a>

                    <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={clearMonitor}
                    >
                        Clear Monitor
                    </button>

                    <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={fetchMonitor}
                    >
                        Refresh Monitor
                    </button>

                    <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => runNow(true)}
                    >
                        Rescan Latest
                    </button>

                    <button
                        className={styles.primaryButton}
                        type="button"
                        onClick={() => runNow(false)}
                    >
                        Run Now
                    </button>
                </div>
            </header>

            <div className={styles.grid}>
                <section className={styles.card}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2>Automation Status</h2>
                            <p>{loadingMonitor ? "Loading monitor state..." : statusDescription}</p>
                        </div>
                        <span className={`${styles.statusPill} ${styles[status]}`}>
                            {currentStatusLabel}
                        </span>
                    </div>

                    <div className={styles.monitorBody}>
                        <div className={styles.monitorRow}>
                            <span>Automation state</span>
                            <strong>{currentStatusLabel}</strong>
                        </div>

                        <div className={styles.monitorRow}>
                            <span>Polling</span>
                            <strong>{pollingEnabled ? "Running" : "Paused"}</strong>
                        </div>

                        <div className={styles.monitorRow}>
                            <span>Next check interval</span>
                            <label className={styles.intervalControl}>
                                <input
                                    type="number"
                                    min={1}
                                    value={intervalMinutes}
                                    onChange={(event) => {
                                        const nextValue = Number(event.target.value);
                                        setIntervalMinutes(nextValue);
                                        updateMonitorSettings({ intervalMinutes: nextValue });
                                    }}
                                />
                                min
                            </label>
                        </div>

                        <div className={styles.monitorRow}>
                            <span>Last checked</span>
                            <strong>
                                {lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : "Never"}
                            </strong>
                        </div>

                        <div className={styles.buttonRow}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => updateMonitorSettings({ pollingEnabled: true })}
                            >
                                Start Polling
                            </button>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => updateMonitorSettings({ pollingEnabled: false })}
                            >
                                Pause
                            </button>
                        </div>
                    </div>
                </section>

                <section className={styles.card}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2>Queue Summary</h2>
                            <p>AnyClick send queue and failure monitor.</p>
                        </div>
                    </div>

                    <div className={styles.statsGrid}>
                        <div>
                            <span>Pending</span>
                            <strong>{queueStats.pending}</strong>
                        </div>
                        <div>
                            <span>Running</span>
                            <strong>{queueStats.running}</strong>
                        </div>
                        <div>
                            <span>Sent</span>
                            <strong>{queueStats.sent}</strong>
                        </div>
                        <div>
                            <span>Failed</span>
                            <strong>{queueStats.failed}</strong>
                        </div>
                        <div>
                            <span>Human Review</span>
                            <strong>{queueStats.humanReview}</strong>
                        </div>
                    </div>
                </section>

                <section className={`${styles.card} ${styles.wideCard}`}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2>Template Send Queue</h2>
                            <p>
                                Auto-send jobs created from eligible inbound replies. Autosend is
                                handled by the webhook; this window shows pending, sent, and failed
                                template jobs.
                            </p>
                        </div>

                        <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={fetchMonitor}
                        >
                            Refresh Queue
                        </button>
                    </div>

                    {templateQueue.length === 0 ? (
                        <div className={styles.emptyState}>
                            <strong>No template jobs</strong>
                            <span>
                                Eligible replies will appear here after template selection or send.
                            </span>
                        </div>
                    ) : (
                        <div className={styles.jobQueue}>
                            {templateQueue.map((job) => (
                                <article
                                    key={job.id}
                                    className={`${styles.jobItem} ${styles[job.status]}`}
                                >
                                    <div className={styles.jobTop}>
                                        <div>
                                            <strong>
                                                {job.leadName || job.phone || "Unknown lead"}
                                            </strong>
                                            <span>
                                                {job.created_at
                                                    ? new Date(job.created_at).toLocaleString()
                                                    : "Just now"}
                                            </span>
                                        </div>

                                        <span className={styles.jobStatus}>{job.status}</span>
                                    </div>

                                    <div className={styles.jobMeta}>
                                        {job.phone && <span>{job.phone}</span>}
                                        {job.apartment && <span>{job.apartment}</span>}
                                        {job.templateKey && <span>{job.templateKey}</span>}
                                    </div>

                                    {job.messagePreview && (
                                        <pre className={styles.jobPreview}>
                                            {job.messagePreview}
                                        </pre>
                                    )}

                                    {job.error && (
                                        <p className={styles.errorText}>Error: {job.error}</p>
                                    )}

                                    <div className={styles.jobActions}>
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => {
                                                const element = document.getElementById(
                                                    `decision-${job.id}`
                                                );
                                                element?.scrollIntoView({
                                                    behavior: "smooth",
                                                    block: "center",
                                                });
                                            }}
                                        >
                                            View Details
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>

                <section className={`${styles.card} ${styles.wideCard}`}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2>Processing Timeline</h2>
                            <p>
                                Stored in <strong>public.ai_decisions</strong>. Shows recent
                                automation decisions.
                            </p>
                        </div>
                    </div>

                    <div className={styles.timeline}>
                        {decisionsLog.length === 0 ? (
                            <article className={styles.timelineItem}>
                                <div className={styles.timelineDot} />
                                <div>
                                    <div className={styles.timelineTop}>
                                        <strong>Automation monitor ready</strong>
                                        <span>Just now</span>
                                    </div>
                                    <p>Waiting for the next inbound Quo/OpenPhone message.</p>
                                </div>
                            </article>
                        ) : (
                            decisionsLog.map((item) => {
                                const payload = parseDecisionPayload(item.reply_text);

                                return (
                                    <article
                                        key={item.id}
                                        id={`decision-${item.id}`}
                                        className={styles.timelineItem}
                                    >
                                        <div className={styles.timelineDot} />
                                        <div>
                                            <div className={styles.timelineTop}>
                                                <strong>
                                                    {formatDecisionLabel(item.decision || item.intent)}
                                                </strong>
                                                <span>
                                                    {item.created_at
                                                        ? new Date(item.created_at).toLocaleString()
                                                        : "Just now"}
                                                </span>
                                            </div>

                                            {payload ? (
                                                <div className={styles.decisionDetails}>
                                                    <div className={styles.detailSection}>
                                                        <h3>Inbound Reply</h3>
                                                        <DetailRow label="Phone" value={payload.phone} />
                                                        <DetailRow
                                                            label="Message"
                                                            value={payload.inboundText}
                                                        />
                                                    </div>

                                                    {payload.webhook && (
                                                        <div className={styles.detailSection}>
                                                            <h3>Webhook</h3>
                                                            <DetailRow
                                                                label="Event"
                                                                value={payload.webhook.eventType}
                                                            />
                                                            <DetailRow
                                                                label="Message ID"
                                                                value={payload.webhook.externalMessageId}
                                                            />
                                                            <DetailRow
                                                                label="Conversation"
                                                                value={payload.webhook.externalConversationId}
                                                            />
                                                            <DetailRow
                                                                label="Phone ID"
                                                                value={payload.webhook.phoneNumberId}
                                                            />
                                                            <DetailRow
                                                                label="Created"
                                                                value={payload.webhook.createdAt}
                                                            />
                                                        </div>
                                                    )}

                                                    {payload.lead && (
                                                        <div className={styles.detailSection}>
                                                            <h3>Matched Lead</h3>
                                                            <DetailRow
                                                                label="Name"
                                                                value={payload.lead.lead_name}
                                                            />
                                                            <DetailRow
                                                                label="Phone"
                                                                value={payload.lead.phone}
                                                            />
                                                            <DetailRow
                                                                label="Apartment"
                                                                value={payload.lead.apt_address}
                                                            />
                                                            <DetailRow
                                                                label="Lead ID"
                                                                value={payload.lead.lead_id}
                                                            />
                                                            <DetailRow
                                                                label="Status"
                                                                value={payload.lead.current_status}
                                                            />
                                                            <DetailRow
                                                                label="Stage"
                                                                value={payload.lead.conversation_stage}
                                                            />
                                                            <DetailRow
                                                                label="Pipeline"
                                                                value={payload.lead.pipeline_status}
                                                            />
                                                        </div>
                                                    )}

                                                    {payload.templateKey && (
                                                        <div className={styles.detailSection}>
                                                            <h3>Template</h3>
                                                            <DetailRow
                                                                label="Name"
                                                                value={payload.templateKey}
                                                            />
                                                            <DetailRow label="Source" value="QuoSender" />
                                                            <DetailRow
                                                                label="Rendered using"
                                                                value={payload.lead?.apt_address}
                                                            />
                                                        </div>
                                                    )}

                                                    {payload.messagePreview && (
                                                        <div className={styles.detailSection}>
                                                            <h3>Message Preview</h3>
                                                            <pre className={styles.previewBox}>
                                                                {payload.messagePreview}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {payload.quoSenderTemplateResponse && (
                                                        <div className={styles.detailSection}>
                                                            <h3>QuoSender Render Response</h3>
                                                            <pre className={styles.previewBox}>
                                                                {JSON.stringify(
                                                                    payload.quoSenderTemplateResponse,
                                                                    null,
                                                                    2
                                                                )}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {payload.anyClickPayload && (
                                                        <div className={styles.detailSection}>
                                                            <h3>AnyClick Payload</h3>
                                                            <pre className={styles.previewBox}>
                                                                {JSON.stringify(
                                                                    payload.anyClickPayload,
                                                                    null,
                                                                    2
                                                                )}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {payload.anyClickResult !== undefined &&
                                                        payload.anyClickResult !== null && (
                                                            <div className={styles.detailSection}>
                                                                <h3>AnyClick Result</h3>
                                                                <pre className={styles.previewBox}>
                                                                    {typeof payload.anyClickResult === "string"
                                                                        ? payload.anyClickResult
                                                                        : JSON.stringify(
                                                                            payload.anyClickResult,
                                                                            null,
                                                                            2
                                                                        )}
                                                                </pre>
                                                            </div>
                                                        )}

                                                    {payload.pipelineUpdate !== undefined &&
                                                        payload.pipelineUpdate !== null && (
                                                            <div className={styles.detailSection}>
                                                                <h3>Pipeline Update</h3>
                                                                <pre className={styles.previewBox}>
                                                                    {JSON.stringify(
                                                                        payload.pipelineUpdate,
                                                                        null,
                                                                        2
                                                                    )}
                                                                </pre>
                                                            </div>
                                                        )}

                                                    <div className={styles.detailSection}>
                                                        <h3>Next Step</h3>

                                                        {payload.reason && (
                                                            <p className={styles.errorText}>
                                                                Reason: {payload.reason}
                                                            </p>
                                                        )}

                                                        <p className={styles.mutedText}>
                                                            {item.sent
                                                                ? "Template reply was sent through AnyClick and logged."
                                                                : payload.nextStep ||
                                                                (item.needs_human
                                                                    ? "Human Review"
                                                                    : "No send action selected")}
                                                        </p>

                                                        {item.error && (
                                                            <p className={styles.errorText}>
                                                                Error: {item.error}
                                                            </p>
                                                        )}

                                                        {item.sent && (
                                                            <div className={styles.successBox}>
                                                                Sent successfully. Lead pipeline should now be
                                                                updated if this was the requirements template.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <p>
                                                        {item.human_reason ||
                                                            item.error ||
                                                            item.reply_text ||
                                                            item.intent ||
                                                            "Automation decision logged."}
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    </article>
                                );
                            })
                        )}
                    </div>
                </section>

                <section className={`${styles.card} ${styles.wideCard} ${styles.reviewHubCard}`}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2>Human Review Workstation</h2>
                            <p>
                                Select a review on the left, use the matching apartment templates,
                                review the recent messages, then add the reply to the send queue.
                            </p>
                        </div>

                        <div className={styles.headerActions}>
                            {selectedReview && selectedPhone && (
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => fetchReviewMessages(selectedPhone, true)}
                                >
                                    Refresh Messages
                                </button>
                            )}
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={fetchMonitor}
                            >
                                Refresh Human Review
                            </button>
                        </div>
                    </div>

                    <div className={styles.reviewHubLayout}>
                        <aside className={styles.reviewHubListPanel}>
                            <div className={styles.reviewHubPanelTitle}>
                                <strong>Review Items</strong>
                                <span>{humanEscalations.length}</span>
                            </div>

                            {humanEscalations.length === 0 ? (
                                <div className={styles.reviewHubEmpty}>
                                    <strong>No review items</strong>
                                    <span>Escalations will appear here.</span>
                                </div>
                            ) : (
                                <div className={styles.reviewHubList}>
                                    {humanEscalations.map((item, index) => {
                                        const notes = parseHumanNotes(item.human_notes);
                                        const previewText =
                                            notes?.inbound_text ||
                                            notes?.lead_lookup_error ||
                                            item.reason ||
                                            "Open to review";
                                        const statusInfo = getReviewQueueStatus(item);
                                        const currentDateKey = getReviewDateKey(item);
                                        const previousDateKey =
                                            index > 0 ? getReviewDateKey(humanEscalations[index - 1]) : null;
                                        const showDateSeparator = index === 0 || currentDateKey !== previousDateKey;

                                        return (
                                            <Fragment key={item.id}>
                                                {showDateSeparator && (
                                                    <div className={styles.reviewHubDateSeparator}>
                                                        {getReviewDateLabel(item)}
                                                    </div>
                                                )}

                                                <article
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`${styles.reviewHubItem} ${selectedReviewId === item.id
                                                            ? styles.reviewHubItemActive
                                                            : ""
                                                        } ${statusInfo.reviewed ? styles.reviewHubItemDone : ""}`}
                                                    onClick={() => openHumanReview(item)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            openHumanReview(item);
                                                        }
                                                    }}
                                                >
                                                    <span className={styles.reviewHubItemTop}>
                                                        <span className={styles.reviewHubPhone}>
                                                            {item.phone || "Unknown phone"}
                                                        </span>
                                                        <span
                                                            className={`${styles.reviewHubStatusPill} ${statusInfo.className}`}
                                                        >
                                                            {statusInfo.label}
                                                        </span>
                                                    </span>

                                                    <span className={styles.reviewHubReason}>
                                                        {item.reason || "automation:needs_human_review"}
                                                    </span>
                                                    <span className={styles.reviewHubPreview}>
                                                        {previewText}
                                                    </span>

                                                    <span className={styles.reviewHubItemBottom}>
                                                        {notes?.newest_message_at ? (
                                                            <span className={styles.reviewHubTime}>
                                                                {new Date(notes.newest_message_at).toLocaleTimeString([], {
                                                                    hour: "numeric",
                                                                    minute: "2-digit",
                                                                })}
                                                            </span>
                                                        ) : (
                                                            <span />
                                                        )}

                                                        <button
                                                            type="button"
                                                            className={`${styles.reviewHubStatusButton} ${statusInfo.reviewed
                                                                    ? styles.reviewHubStatusButtonReopen
                                                                    : styles.reviewHubStatusButtonDone
                                                                }`}
                                                            disabled={Boolean(updatingReviewStatusIds[item.id])}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                setReviewStatus(
                                                                    item,
                                                                    statusInfo.reviewed ? "open" : "resolved"
                                                                );
                                                            }}
                                                        >
                                                            {updatingReviewStatusIds[item.id]
                                                                ? "Saving..."
                                                                : statusInfo.reviewed
                                                                    ? "Reopen"
                                                                    : "Done"}
                                                        </button>
                                                    </span>
                                                </article>
                                            </Fragment>
                                        );
                                    })}
                                </div>
                            )}
                        </aside>

                        <aside className={styles.reviewHubTemplatesPanel}>
                            <div className={styles.reviewHubPanelTitle}>
                                <strong>
                                    {selectedAptAddress
                                        ? `Templates for ${selectedAptAddress}`
                                        : "Templates"}
                                </strong>
                                <button
                                    type="button"
                                    className={styles.textButton}
                                    onClick={fetchTemplates}
                                    disabled={loadingTemplates}
                                >
                                    {loadingTemplates ? "Loading..." : "Reload"}
                                </button>
                            </div>

                            {!selectedReview && !loadingReview ? (
                                <div className={styles.reviewHubEmpty}>
                                    <strong>Select a review</strong>
                                    <span>Templates load after the apartment is matched.</span>
                                </div>
                            ) : loadingReview ? (
                                <div className={styles.reviewHubEmpty}>
                                    <strong>Loading...</strong>
                                    <span>Finding the matching apartment.</span>
                                </div>
                            ) : !selectedAptAddress ? (
                                <div className={styles.reviewHubEmpty}>
                                    <strong>No apartment matched</strong>
                                    <span>Check the lead phone/address before rendering.</span>
                                </div>
                            ) : templates.length === 0 ? (
                                <div className={styles.reviewHubEmpty}>
                                    <strong>{loadingTemplates ? "Loading templates..." : "No templates"}</strong>
                                    <span>QuoSender templates will appear here.</span>
                                </div>
                            ) : (
                                <div className={styles.reviewHubTemplateList}>
                                    {templates.map((template) => {
                                        const templateKey = getTemplateKey(template);
                                        const isActive = selectedTemplateKey === templateKey;

                                        return (
                                            <button
                                                key={template.id}
                                                type="button"
                                                className={`${styles.quosenderTemplateButton} ${isActive ? styles.quosenderTemplateButtonActive : ""
                                                    }`}
                                                onClick={() => renderTemplate(template)}
                                                disabled={!selectedAptAddress || renderingTemplate}
                                            >
                                                <strong>{template.name}</strong>
                                                {template.body && <span>{template.body}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </aside>

                        <section className={styles.reviewHubChatPanel}>
                            {!selectedReview && !loadingReview ? (
                                <div className={styles.reviewHubChatEmpty}>
                                    <strong>No review selected</strong>
                                    <span>Choose a Human Review item from the left column.</span>
                                </div>
                            ) : loadingReview ? (
                                <div className={styles.reviewHubChatEmpty}>
                                    <strong>Loading review...</strong>
                                    <span>Loading phone, apartment, and recent messages.</span>
                                </div>
                            ) : (
                                <>
                                    <div className={styles.reviewHubChatHeader}>
                                        <div>
                                            <strong>{selectedPhone || "Unknown phone"}</strong>
                                            <span>{selectedAptAddress || "No apartment matched"}</span>
                                        </div>
                                        {selectedReview?.lead?.lead_name && (
                                            <span className={styles.leadPill}>
                                                {selectedReview.lead.lead_name}
                                            </span>
                                        )}
                                    </div>

                                    {selectedReview?.inboundText && (
                                        <div className={styles.selectedInboundText}>
                                            <span>Inbound reply</span>
                                            <p>{selectedReview.inboundText}</p>
                                        </div>
                                    )}

                                    <div className={styles.reviewHubThreadHeader}>
                                        <strong>Recent messages</strong>
                                        {reviewMessagesHasMore && (
                                            <button
                                                type="button"
                                                className={styles.textButton}
                                                onClick={loadOlderReviewMessages}
                                                disabled={loadingOlderMessages}
                                            >
                                                {loadingOlderMessages ? "Loading..." : "Load older"}
                                            </button>
                                        )}
                                    </div>

                                    <div
                                        className={styles.reviewHubThread}
                                        onScroll={(event) => {
                                            if (
                                                event.currentTarget.scrollTop < 20 &&
                                                reviewMessagesHasMore &&
                                                !loadingOlderMessages
                                            ) {
                                                loadOlderReviewMessages();
                                            }
                                        }}
                                    >
                                        {loadingMessages ? (
                                            <div className={styles.threadEmpty}>Loading messages...</div>
                                        ) : reviewMessages.length === 0 ? (
                                            <div className={styles.threadEmpty}>No message history found.</div>
                                        ) : (
                                            reviewMessages.map((message) => {
                                                const isOutbound = message.direction === "outbound";

                                                return (
                                                    <article
                                                        key={message.id}
                                                        className={`${styles.reviewChatRow} ${isOutbound
                                                                ? styles.reviewChatOutbound
                                                                : styles.reviewChatInbound
                                                            }`}
                                                    >
                                                        <div className={styles.reviewChatBubble}>
                                                            <p>{message.message_text || "No message text"}</p>
                                                            <span>
                                                                {message.created_at
                                                                    ? new Date(message.created_at).toLocaleString()
                                                                    : ""}
                                                            </span>
                                                        </div>
                                                    </article>
                                                );
                                            })
                                        )}
                                    </div>

                                    <div className={styles.reviewHubComposerRow}>
                                        <textarea
                                            className={styles.reviewHubComposer}
                                            value={composerText}
                                            onChange={(event) => setComposerText(event.target.value)}
                                            placeholder="Type a manual reply or click a template..."
                                        />
                                        <button
                                            type="button"
                                            className={styles.reviewHubSendButton}
                                            onClick={addManualSendToQueue}
                                            disabled={!selectedPhone || !composerText.trim() || addingToQueue}
                                            title="Add to Send Queue"
                                        >
                                            {addingToQueue ? "..." : "➤"}
                                        </button>
                                    </div>

                                    <div className={styles.reviewHubComposerActions}>
                                        <button
                                            type="button"
                                            className={styles.textButton}
                                            onClick={() => setComposerText("")}
                                            disabled={!composerText.trim() || addingToQueue}
                                        >
                                            Clear composer
                                        </button>
                                        {queueNotice && (
                                            <span className={styles.inlineSuccess}>{queueNotice}</span>
                                        )}
                                        {workstationError && (
                                            <span className={styles.inlineError}>{workstationError}</span>
                                        )}
                                    </div>
                                </>
                            )}
                        </section>
                    </div>
                </section>

                <section className={`${styles.card} ${styles.wideCard}`}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2>Manual Send Queue</h2>
                            <p>Human Review replies added from the workstation.</p>
                        </div>

                        <div className={styles.headerActions}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={fetchManualQueue}
                            >
                                Refresh Queue
                            </button>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={processNextQueueJob}
                            >
                                Process Next
                            </button>
                        </div>
                    </div>

                    {manualQueue.length === 0 ? (
                        <div className={styles.emptyState}>
                            <strong>No manual send jobs</strong>
                            <span>Queued Human Review replies will appear here.</span>
                        </div>
                    ) : (
                        <div className={styles.manualQueueCompactList}>
                            {manualQueue.map((job) => (
                                <article
                                    key={job.id}
                                    className={`${styles.manualQueueCompactItem} ${styles[job.status]}`}
                                >
                                    <div className={styles.jobTop}>
                                        <div>
                                            <strong>{job.phone || "Unknown phone"}</strong>
                                            <span>
                                                {job.created_at
                                                    ? new Date(job.created_at).toLocaleString()
                                                    : "Just now"}
                                            </span>
                                        </div>
                                        <span className={styles.jobStatus}>
                                            {job.status === "queued" ? "Added to queue" : job.status}
                                        </span>
                                    </div>

                                    <div className={styles.jobMeta}>
                                        {job.apt_address && <span>{job.apt_address}</span>}
                                        {job.template_key && <span>{job.template_key}</span>}
                                    </div>

                                    {job.message_text && (
                                        <pre className={styles.jobPreview}>{job.message_text}</pre>
                                    )}

                                    {job.error && (
                                        <p className={styles.errorText}>Error: {job.error}</p>
                                    )}
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <section className={styles.debugSection}>
                <button
                    type="button"
                    className={styles.debugToggle}
                    onClick={() => setShowDebugInbox((value) => !value)}
                >
                    {showDebugInbox ? "Hide" : "Show"} Raw Quo Inbox Debug View
                </button>

                {showDebugInbox && (
                    <div className={styles.debugBox}>
                        <p>
                            Keep the old Quo inbox here temporarily while testing fetches.
                            Once the automation monitor is stable, this can be removed.
                        </p>
                    </div>
                )}
            </section>
        </section>
    );
}