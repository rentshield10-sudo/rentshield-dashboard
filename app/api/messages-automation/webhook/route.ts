import { NextResponse } from "next/server";
import {
    getRenderedTemplateText,
    renderQuoSenderTemplateByAddress,
} from "@/lib/quosender";
import { supabaseServer } from "@/lib/supabase-server";

const STATE_ID = "main";
const PROMPT_VERSION = "message_automation_v1";
const REQUIREMENTS_TEMPLATE_KEY = "02_requirements_request_v1";

const ANYCLICK_BASE_URL =
    process.env.ANYCLICK_BASE_URL || "http://127.0.0.1:3001";

const ANYCLICK_TEMPLATE_SEND_FLOW_ID =
    process.env.ANYCLICK_TEMPLATE_SEND_FLOW_ID ||
    "flow_1776996361867_nxr811";

type JsonRecord = Record<string, unknown>;

type AutomationAction =
    | "send_requirements"
    | "template_sent"
    | "template_send_failed"
    | "pipeline_update_failed"
    | "human_review"
    | "webhook_ignored"
    | "webhook_duplicate"
    | "error";

type MatchedLead = {
    matched_count: number | string;
    lead_id?: string | null;
    lead_name?: string | null;
    phone?: string | null;
    apt_address?: string | null;
    pipeline_status?: string | null;
    current_status?: string | null;
    conversation_stage?: string | null;
    last_outbound_sms?: string | null;
    last_outbound_at?: string | null;
    stop_automation?: string | null;
    needs_human_review?: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePhone(phone?: string | null) {
    const raw = String(phone || "").trim();

    if (!raw) return null;
    if (raw.startsWith("+")) return raw;

    const digits = raw.replace(/\D/g, "");

    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

    return raw;
}

function findFirstStringDeep(
    value: unknown,
    keys: string[],
    depth = 0
): string | null {
    if (depth > 6) return null;

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findFirstStringDeep(item, keys, depth + 1);
            if (found) return found;
        }

        return null;
    }

    if (!isRecord(value)) return null;

    for (const key of keys) {
        const directValue = value[key];

        if (
            typeof directValue === "string" ||
            typeof directValue === "number"
        ) {
            const text = String(directValue).trim();
            if (text) return text;
        }
    }

    for (const nestedValue of Object.values(value)) {
        const found = findFirstStringDeep(nestedValue, keys, depth + 1);
        if (found) return found;
    }

    return null;
}

function findNestedRecord(value: unknown, keys: string[], depth = 0): JsonRecord | null {
    if (depth > 6) return null;

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findNestedRecord(item, keys, depth + 1);
            if (found) return found;
        }

        return null;
    }

    if (!isRecord(value)) return null;

    for (const key of keys) {
        const directValue = value[key];

        if (isRecord(directValue)) {
            return directValue;
        }
    }

    for (const nestedValue of Object.values(value)) {
        const found = findNestedRecord(nestedValue, keys, depth + 1);
        if (found) return found;
    }

    return null;
}

async function ensureState() {
    const { data: existing, error: readError } = await supabaseServer
        .from("message_automation_state")
        .select("*")
        .eq("id", STATE_ID)
        .maybeSingle();

    if (readError) throw readError;

    if (existing) return existing;

    const { data, error } = await supabaseServer
        .from("message_automation_state")
        .insert({
            id: STATE_ID,
            polling_enabled: false,
            interval_minutes: 2,
            status: "idle",
        })
        .select("*")
        .single();

    if (error) throw error;

    return data;
}

async function updateState(status: string) {
    await ensureState();

    const { error } = await supabaseServer
        .from("message_automation_state")
        .update({
            status,
            updated_at: new Date().toISOString(),
        })
        .eq("id", STATE_ID);

    if (error) throw error;
}

async function logDecision(params: {
    action: AutomationAction;
    decision?: string;
    phone?: string | null;
    inboundText?: string | null;
    replyText?: unknown;
    needsHuman?: boolean;
    humanReason?: string | null;
    shouldSend?: boolean;
    sent?: boolean;
    error?: string | null;
}) {
    const { error } = await supabaseServer.from("ai_decisions").insert({
        intent: "intro_reply_requirements",
        decision: params.decision || params.action,
        reply_text:
            typeof params.replyText === "string"
                ? params.replyText
                : JSON.stringify(params.replyText || null),
        needs_human: Boolean(params.needsHuman),
        human_reason: params.humanReason || null,
        should_send: Boolean(params.shouldSend),
        sent: Boolean(params.sent),
        error: params.error || null,
        model_used: "rule_based",
        prompt_version: PROMPT_VERSION,
    });

    if (error) throw error;
}

async function createHumanEscalation(params: {
    phone?: string | null;
    reason: string;
    humanNotes?: unknown;
}) {
    const reason = `automation:${params.reason}`;
    const phone = params.phone || null;

    const { data: existing, error: existingError } = await supabaseServer
        .from("human_escalations")
        .select("id")
        .eq("status", "open")
        .eq("phone", phone)
        .eq("reason", reason)
        .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
        const { error } = await supabaseServer
            .from("human_escalations")
            .update({
                updated_at: new Date().toISOString(),
                human_notes: JSON.stringify(params.humanNotes || null, null, 2),
            })
            .eq("id", existing.id);

        if (error) throw error;

        return existing.id;
    }

    const { data, error } = await supabaseServer
        .from("human_escalations")
        .insert({
            phone,
            reason,
            priority: "normal",
            status: "open",
            human_notes: JSON.stringify(params.humanNotes || null, null, 2),
        })
        .select("id")
        .single();

    if (error) throw error;

    return data.id;
}

async function lookupEligibleLead(phone?: string | null) {
    if (!phone) {
        return {
            matchedCount: 0,
            lead: null as MatchedLead | null,
            error: "missing_phone",
        };
    }

    const { data, error } = await supabaseServer.rpc(
        "find_single_contacted_lead_for_auto_reply",
        {
            p_phone: phone,
        }
    );

    if (error) {
        return {
            matchedCount: 0,
            lead: null as MatchedLead | null,
            error: error.message,
        };
    }

    const row = (data?.[0] || null) as MatchedLead | null;
    const matchedCount = Number(row?.matched_count || 0);

    return {
        matchedCount,
        lead: matchedCount === 1 ? row : null,
        error: null,
    };
}

function normalizeReplyText(value: string) {
    return value
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isPositiveReply(text: string) {
    const normalized = normalizeReplyText(text);

    const negativeSignals = [
        "stop",
        "unsubscribe",
        "wrong number",
        "not interested",
        "no longer interested",
        "already found",
        "too expensive",
        "scam",
        "who is this",
    ];

    if (negativeSignals.some((signal) => normalized.includes(signal))) {
        return false;
    }

    const positiveSignals = [
        "yes",
        "yeah",
        "yep",
        "ok",
        "okay",
        "sure",
        "interested",
        "available",
        "schedule",
        "showing",
        "tour",
        "see",
        "coming",
        "there",
        "today",
        "tomorrow",
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];

    if (positiveSignals.some((signal) => normalized.includes(signal))) {
        return true;
    }

    const appointmentQuestionSignals = [
        "what time",
        "wat time",
        "time",
        "appointment",
        "appoitment",
        "apoimen",
        "apointment",
        "appoint",
        "appt",
        "apt time",
        "tha apoimen",
    ];

    return appointmentQuestionSignals.some((signal) =>
        normalized.includes(signal)
    );
}

function extractWebhookMessage(payload: unknown) {
    const messageRecord =
        findNestedRecord(payload, ["message", "msg"]) ||
        findNestedRecord(payload, ["data"]) ||
        (isRecord(payload) ? payload : {});

    const eventType =
        findFirstStringDeep(payload, [
            "type",
            "event",
            "eventType",
            "event_type",
            "name",
        ]) || "unknown";

    const messageId = findFirstStringDeep(messageRecord, [
        "id",
        "messageId",
        "message_id",
        "externalMessageId",
        "external_message_id",
    ]);

    const conversationId = findFirstStringDeep(messageRecord, [
        "conversationId",
        "conversation_id",
        "externalConversationId",
        "external_conversation_id",
    ]);

    const phoneNumberId = findFirstStringDeep(messageRecord, [
        "phoneNumberId",
        "phone_number_id",
    ]);

    const direction = findFirstStringDeep(messageRecord, [
        "direction",
        "messageDirection",
    ]);

    const body = findFirstStringDeep(messageRecord, [
        "body",
        "text",
        "content",
        "message",
        "messageText",
        "message_text",
    ]);

    const fromNumber = findFirstStringDeep(messageRecord, [
        "from",
        "fromNumber",
        "from_number",
        "source",
        "sourceNumber",
        "contactPhoneNumber",
        "contact_phone_number",
    ]);

    const toNumber = findFirstStringDeep(messageRecord, [
        "to",
        "toNumber",
        "to_number",
        "destination",
        "destinationNumber",
    ]);

    const createdAt =
        findFirstStringDeep(messageRecord, [
            "createdAt",
            "created_at",
            "sentAt",
            "sent_at",
            "timestamp",
            "occurredAt",
            "occurred_at",
            "date",
        ]) || new Date().toISOString();

    const normalizedDirection = String(direction || "").toLowerCase();
    const normalizedEventType = String(eventType || "").toLowerCase();

    const isInbound =
        normalizedEventType.includes("message.received") ||
        normalizedEventType.includes("message_received") ||
        normalizedEventType.includes("received") ||
        normalizedDirection === "inbound" ||
        normalizedDirection === "incoming" ||
        normalizedDirection === "received";

    const phone = normalizePhone(fromNumber);

    return {
        eventType,
        messageId,
        conversationId,
        phoneNumberId,
        direction: isInbound ? "inbound" : normalizedDirection || "unknown",
        isInbound,
        body,
        fromNumber: normalizePhone(fromNumber),
        toNumber: normalizePhone(toNumber),
        phone,
        createdAt,
    };
}

function buildPreviewPayload(params: {
    extracted: ReturnType<typeof extractWebhookMessage>;
    lead?: MatchedLead | null;
    messagePreview?: string | null;
    reason: string;
    nextStep: string;
    quoSenderTemplateResponse?: unknown;
    anyClickResult?: unknown;
    anyClickPayload?: unknown;
    pipelineUpdate?: unknown;
}) {
    return {
        phone: params.extracted.phone,
        inboundText: params.extracted.body,
        templateKey: REQUIREMENTS_TEMPLATE_KEY,
        messagePreview: params.messagePreview || null,
        lead: params.lead
            ? {
                lead_id: params.lead.lead_id || null,
                lead_name: params.lead.lead_name || null,
                phone: params.lead.phone || null,
                apt_address: params.lead.apt_address || null,
                current_status: params.lead.current_status || null,
                conversation_stage: params.lead.conversation_stage || null,
                pipeline_status: params.lead.pipeline_status || null,
            }
            : null,
        reason: params.reason,
        nextStep: params.nextStep,
        webhook: {
            eventType: params.extracted.eventType,
            externalMessageId: params.extracted.messageId,
            externalConversationId: params.extracted.conversationId,
            phoneNumberId: params.extracted.phoneNumberId,
            createdAt: params.extracted.createdAt,
        },
        quoSenderTemplateResponse: params.quoSenderTemplateResponse || null,
        anyClickPayload: params.anyClickPayload || null,
        anyClickResult: params.anyClickResult || null,
        pipelineUpdate: params.pipelineUpdate || null,
    };
}

async function saveInboundMessage(extracted: ReturnType<typeof extractWebhookMessage>) {
    if (!extracted.messageId || !extracted.phone || !extracted.body) {
        return {
            saved: false,
            duplicate: false,
            messageRowId: null as number | null,
            reason: "missing_required_fields",
        };
    }

    const { data: existingMessage, error: existingError } = await supabaseServer
        .from("messages")
        .select("id, processed, intent")
        .eq("external_message_id", extracted.messageId)
        .maybeSingle();

    if (existingError) throw existingError;

    if (existingMessage) {
        return {
            saved: false,
            duplicate: true,
            messageRowId: existingMessage.id as number,
            reason: "duplicate_message",
        };
    }

    const { data: insertedMessage, error: insertError } = await supabaseServer
        .from("messages")
        .insert({
            phone: extracted.phone,
            channel: "quo",
            direction: "inbound",
            message_text: extracted.body,
            external_message_id: extracted.messageId,
            external_conversation_id: extracted.conversationId,
            processed: false,
            intent: "webhook_received",
        })
        .select("id")
        .single();

    if (insertError) throw insertError;

    return {
        saved: true,
        duplicate: false,
        messageRowId: insertedMessage.id as number,
        reason: "saved",
    };
}

async function markInboundProcessed(params: {
    messageRowId?: number | null;
    messageId?: string | null;
    intent: string;
}) {
    if (params.messageRowId) {
        const { error } = await supabaseServer
            .from("messages")
            .update({
                processed: true,
                intent: params.intent,
            })
            .eq("id", params.messageRowId);

        if (error) throw error;

        return;
    }

    if (params.messageId) {
        const { error } = await supabaseServer
            .from("messages")
            .update({
                processed: true,
                intent: params.intent,
            })
            .eq("external_message_id", params.messageId);

        if (error) throw error;
    }
}

async function sendThroughAnyClick(params: {
    phone: string;
    message: string;
}) {
    const anyClickPayload = {
        inputs: {
            parameters: params.phone,
            message: params.message,
            phone: params.phone,
        },
    };

    const response = await fetch(
        `${ANYCLICK_BASE_URL}/flows/${ANYCLICK_TEMPLATE_SEND_FLOW_ID}/run`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify(anyClickPayload),
        }
    );

    const responseText = await response.text();
    let anyClickResult: unknown = responseText;

    try {
        anyClickResult = JSON.parse(responseText);
    } catch {
        // Keep raw text.
    }

    if (!response.ok) {
        throw new Error(
            typeof anyClickResult === "string"
                ? anyClickResult
                : JSON.stringify(anyClickResult)
        );
    }

    return {
        anyClickPayload,
        anyClickResult,
    };
}

export async function GET() {
    return NextResponse.json({
        ok: true,
        message: "Mission Control Quo webhook route is live",
        expectedMethod: "POST",
        expectedEvent: "message.received",
    });
}

export async function POST(request: Request) {
    let payload: unknown = null;

    try {
        payload = await request.json();
    } catch {
        payload = null;
    }

    console.log("Quo/OpenPhone webhook received:");
    console.log(JSON.stringify(payload, null, 2));

    try {
        const extracted = extractWebhookMessage(payload);
        const primaryInboxId = process.env.QUO_PRIMARY_INBOX_ID || "";
        const confirmationInboxId = process.env.QUO_CONFIRMATION_INBOX_ID || "";

        const isPrimaryInbox =
            primaryInboxId && extracted.phoneNumberId === primaryInboxId;

        const isConfirmationInbox =
            confirmationInboxId && extracted.phoneNumberId === confirmationInboxId;

        if (!isPrimaryInbox) {
            const reason = isConfirmationInbox
                ? "confirmation_inbox_message_not_processed_by_requirements_flow"
                : "non_primary_inbox_message_ignored";

            await updateState("webhook_ignored");

            await logDecision({
                action: "webhook_ignored",
                decision: reason,
                sent: false,
                replyText: {
                    reason,
                    extracted,
                    rawPayload: payload,
                },
            });

            return NextResponse.json({
                ok: true,
                ignored: true,
                reason,
                extracted,
            });
        }

        if (!extracted.isInbound) {
            await updateState("webhook_ignored");

            await logDecision({
                action: "webhook_ignored",
                decision: "webhook_ignored",
                sent: false,
                replyText: {
                    reason: "Webhook received but was not an inbound message.",
                    extracted,
                    rawPayload: payload,
                },
            });

            return NextResponse.json({
                ok: true,
                ignored: true,
                reason: "not_inbound_message",
                extracted,
            });
        }

        const savedMessage = await saveInboundMessage(extracted);

        if (savedMessage.duplicate) {
            await updateState("webhook_duplicate");

            await logDecision({
                action: "webhook_duplicate",
                decision: "webhook_duplicate_message",
                sent: false,
                replyText: {
                    reason: "Webhook message already exists in public.messages.",
                    extracted,
                    messageRowId: savedMessage.messageRowId,
                },
            });

            return NextResponse.json({
                ok: true,
                duplicate: true,
                extracted,
                messageRowId: savedMessage.messageRowId,
            });
        }

        if (!extracted.messageId || !extracted.phone || !extracted.body) {
            const reason = "webhook_payload_missing_required_fields";

            await updateState("human_review");

            const previewPayload = buildPreviewPayload({
                extracted,
                reason,
                nextStep: "Human Review",
            });

            await createHumanEscalation({
                phone: extracted.phone,
                reason,
                humanNotes: {
                    extracted,
                    rawPayload: payload,
                },
            });

            await logDecision({
                action: "human_review",
                decision: "human_review",
                needsHuman: true,
                humanReason: reason,
                sent: false,
                replyText: previewPayload,
            });

            return NextResponse.json({
                ok: true,
                received: true,
                saved: false,
                needsHuman: true,
                reason,
                extracted,
            });
        }

        if (!isPositiveReply(extracted.body)) {
            const reason = "lead_reply_not_clearly_positive";

            await updateState("human_review");

            const previewPayload = buildPreviewPayload({
                extracted,
                reason,
                nextStep: "Human Review",
            });

            await createHumanEscalation({
                phone: extracted.phone,
                reason,
                humanNotes: previewPayload,
            });

            await logDecision({
                action: "human_review",
                decision: "human_review",
                needsHuman: true,
                humanReason: reason,
                sent: false,
                replyText: previewPayload,
            });

            await markInboundProcessed({
                messageRowId: savedMessage.messageRowId,
                messageId: extracted.messageId,
                intent: "human_review",
            });

            return NextResponse.json({
                ok: true,
                received: true,
                saved: savedMessage.saved,
                needsHuman: true,
                reason,
                extracted,
            });
        }

        await updateState("matching_lead");

        const lookup = await lookupEligibleLead(extracted.phone);

        if (lookup.error) {
            const reason = `lead_lookup_failed:${lookup.error}`;

            await updateState("human_review");

            const previewPayload = buildPreviewPayload({
                extracted,
                reason,
                nextStep: "Human Review",
            });

            await createHumanEscalation({
                phone: extracted.phone,
                reason,
                humanNotes: {
                    ...previewPayload,
                    matchedCount: lookup.matchedCount,
                },
            });

            await logDecision({
                action: "human_review",
                decision: "human_review",
                needsHuman: true,
                humanReason: reason,
                sent: false,
                replyText: previewPayload,
                error: lookup.error,
            });

            await markInboundProcessed({
                messageRowId: savedMessage.messageRowId,
                messageId: extracted.messageId,
                intent: "human_review",
            });

            return NextResponse.json({
                ok: true,
                received: true,
                saved: savedMessage.saved,
                needsHuman: true,
                reason,
                extracted,
            });
        }

        if (lookup.matchedCount !== 1 || !lookup.lead) {
            const reason =
                lookup.matchedCount > 1
                    ? "multiple_matching_eligible_leads"
                    : "no_matching_eligible_lead";

            await updateState("human_review");

            const previewPayload = buildPreviewPayload({
                extracted,
                reason,
                nextStep: "Human Review",
            });

            await createHumanEscalation({
                phone: extracted.phone,
                reason,
                humanNotes: {
                    ...previewPayload,
                    matchedCount: lookup.matchedCount,
                },
            });

            await logDecision({
                action: "human_review",
                decision: "human_review",
                needsHuman: true,
                humanReason: reason,
                sent: false,
                replyText: previewPayload,
            });

            await markInboundProcessed({
                messageRowId: savedMessage.messageRowId,
                messageId: extracted.messageId,
                intent: "human_review",
            });

            return NextResponse.json({
                ok: true,
                received: true,
                saved: savedMessage.saved,
                needsHuman: true,
                reason,
                matchedCount: lookup.matchedCount,
                extracted,
            });
        }

        if (!lookup.lead.apt_address) {
            const reason = "matched_lead_missing_apt_address";

            await updateState("human_review");

            const previewPayload = buildPreviewPayload({
                extracted,
                lead: lookup.lead,
                reason,
                nextStep: "Human Review",
            });

            await createHumanEscalation({
                phone: extracted.phone,
                reason,
                humanNotes: previewPayload,
            });

            await logDecision({
                action: "human_review",
                decision: "human_review",
                needsHuman: true,
                humanReason: reason,
                sent: false,
                replyText: previewPayload,
            });

            await markInboundProcessed({
                messageRowId: savedMessage.messageRowId,
                messageId: extracted.messageId,
                intent: "human_review",
            });

            return NextResponse.json({
                ok: true,
                received: true,
                saved: savedMessage.saved,
                needsHuman: true,
                reason,
                extracted,
            });
        }

        await updateState("choosing_template");

        try {
            const renderedTemplate = await renderQuoSenderTemplateByAddress({
                aptAddress: lookup.lead.apt_address,
                templateKey: REQUIREMENTS_TEMPLATE_KEY,
            });

            const messagePreview = getRenderedTemplateText(renderedTemplate);

            if (!messagePreview) {
                const reason = "template_render_empty";

                await updateState("human_review");

                const previewPayload = buildPreviewPayload({
                    extracted,
                    lead: lookup.lead,
                    reason,
                    nextStep: "Human Review",
                    quoSenderTemplateResponse: renderedTemplate,
                });

                await createHumanEscalation({
                    phone: extracted.phone,
                    reason,
                    humanNotes: previewPayload,
                });

                await logDecision({
                    action: "human_review",
                    decision: "human_review",
                    needsHuman: true,
                    humanReason: reason,
                    sent: false,
                    replyText: previewPayload,
                });

                await markInboundProcessed({
                    messageRowId: savedMessage.messageRowId,
                    messageId: extracted.messageId,
                    intent: "human_review",
                });

                return NextResponse.json({
                    ok: true,
                    received: true,
                    saved: savedMessage.saved,
                    needsHuman: true,
                    reason,
                    extracted,
                });
            }

            await updateState("sending");

            const sendPhone = normalizePhone(lookup.lead.phone) || extracted.phone;

            const { anyClickPayload, anyClickResult } = await sendThroughAnyClick({
                phone: sendPhone,
                message: messagePreview,
            });

            await updateState("updating_pipeline");

            const { data: pipelineUpdate, error: pipelineError } =
                await supabaseServer.rpc("mark_lead_requirements_sent", {
                    p_lead_id: lookup.lead.lead_id,
                    p_inbound_sms: extracted.body,
                    p_outbound_sms: messagePreview,
                });

            if (pipelineError) {
                const reason = "pipeline_update_failed_after_template_sent";

                await updateState("error");

                const previewPayload = buildPreviewPayload({
                    extracted,
                    lead: lookup.lead,
                    messagePreview,
                    reason,
                    nextStep: "Template sent through AnyClick, but pipeline update failed.",
                    quoSenderTemplateResponse: renderedTemplate,
                    anyClickPayload,
                    anyClickResult,
                });

                await createHumanEscalation({
                    phone: extracted.phone,
                    reason,
                    humanNotes: {
                        ...previewPayload,
                        pipelineError: pipelineError.message,
                    },
                });

                await logDecision({
                    action: "pipeline_update_failed",
                    decision: "template_sent_but_pipeline_update_failed",
                    needsHuman: true,
                    humanReason: reason,
                    shouldSend: true,
                    sent: true,
                    replyText: previewPayload,
                    error: pipelineError.message,
                });

                await markInboundProcessed({
                    messageRowId: savedMessage.messageRowId,
                    messageId: extracted.messageId,
                    intent: "requirements_sent_pipeline_update_failed",
                });

                return NextResponse.json(
                    {
                        ok: false,
                        received: true,
                        saved: savedMessage.saved,
                        sent: true,
                        pipelineUpdated: false,
                        reason,
                        pipelineError: pipelineError.message,
                        extracted,
                    },
                    { status: 500 }
                );
            }

            await updateState("pipeline_updated");

            const previewPayload = buildPreviewPayload({
                extracted,
                lead: lookup.lead,
                messagePreview,
                reason: "webhook_positive_reply_template_sent",
                nextStep: "Template sent through AnyClick and pipeline updated.",
                quoSenderTemplateResponse: renderedTemplate,
                anyClickPayload,
                anyClickResult,
                pipelineUpdate,
            });

            await logDecision({
                action: "template_sent",
                decision: "template_sent",
                phone: extracted.phone,
                inboundText: extracted.body,
                shouldSend: true,
                sent: true,
                replyText: previewPayload,
            });

            await markInboundProcessed({
                messageRowId: savedMessage.messageRowId,
                messageId: extracted.messageId,
                intent: "requirements_sent",
            });

            return NextResponse.json({
                ok: true,
                received: true,
                saved: savedMessage.saved,
                action: "template_sent",
                sent: true,
                pipelineUpdated: true,
                messageRowId: savedMessage.messageRowId,
                preview: previewPayload,
            });
        } catch (templateOrSendError) {
            const reason = "template_render_or_anyclick_send_failed";

            await updateState("human_review");

            const errorMessage =
                templateOrSendError instanceof Error
                    ? templateOrSendError.message
                    : String(templateOrSendError);

            const previewPayload = buildPreviewPayload({
                extracted,
                lead: lookup.lead,
                reason,
                nextStep: "Human Review",
            });

            await createHumanEscalation({
                phone: extracted.phone,
                reason,
                humanNotes: {
                    ...previewPayload,
                    error: errorMessage,
                },
            });

            await logDecision({
                action: "template_send_failed",
                decision: "template_send_failed",
                needsHuman: true,
                humanReason: reason,
                shouldSend: true,
                sent: false,
                replyText: previewPayload,
                error: errorMessage,
            });

            await markInboundProcessed({
                messageRowId: savedMessage.messageRowId,
                messageId: extracted.messageId,
                intent: "send_failed_human_review",
            });

            return NextResponse.json(
                {
                    ok: false,
                    received: true,
                    saved: savedMessage.saved,
                    needsHuman: true,
                    reason,
                    error: errorMessage,
                    extracted,
                },
                { status: 502 }
            );
        }
    } catch (error) {
        console.error("messages-automation/webhook error:", error);

        try {
            await updateState("error");

            await logDecision({
                action: "error",
                decision: "webhook_error",
                needsHuman: true,
                humanReason: "webhook_error",
                sent: false,
                error: error instanceof Error ? error.message : String(error),
                replyText: {
                    rawPayload: payload,
                },
            });
        } catch {
            // Ignore secondary logging error.
        }

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}