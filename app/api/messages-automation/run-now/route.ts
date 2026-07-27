import { NextResponse } from "next/server";
import {
    getRenderedTemplateText,
    renderQuoSenderTemplateByAddress,
} from "@/lib/quosender";
import {
    listQuoConversations,
    listQuoMessages,
    type QuoConversation,
    type QuoMessage,
} from "@/lib/quo";
import { supabaseServer } from "@/lib/supabase-server";

const STATE_ID = "main";
const PROMPT_VERSION = "message_automation_v1";
const REQUIREMENTS_TEMPLATE_KEY = "02_requirements_request_v1";

type AutomationAction =
    | "no_new_messages"
    | "wait_for_reply"
    | "send_requirements"
    | "human_review"
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

type Decision = {
    action: AutomationAction;
    reason: string;
    phone?: string;
    conversationId?: string;
    inboundText?: string;
    messageCount?: number;
    newestMessageAt?: string | null;
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
    quoSenderTemplateResponse?: unknown;
};

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

async function updateState(payload: Record<string, unknown>) {
    const { error } = await supabaseServer
        .from("message_automation_state")
        .update({
            ...payload,
            updated_at: new Date().toISOString(),
        })
        .eq("id", STATE_ID);

    if (error) throw error;
}

async function logDecision(params: {
    action: AutomationAction;
    reason: string;
    phone?: string;
    inboundText?: string;
    replyText?: string | null;
    error?: string;
}) {
    const decisionText =
        params.action === "send_requirements"
            ? "template_selected"
            : params.action;

    const { error } = await supabaseServer.from("ai_decisions").insert({
        intent: "intro_reply_requirements",
        decision: decisionText,
        reply_text: params.replyText || params.inboundText || null,
        needs_human: params.action === "human_review",
        human_reason: params.action === "human_review" ? params.reason : null,
        should_send: params.action === "send_requirements",
        sent: false,
        error: params.error || null,
        model_used: "rule_based",
        prompt_version: PROMPT_VERSION,
    });

    if (error) throw error;
}

async function createHumanEscalation(
    decision: Decision,
    extraNotes?: Record<string, unknown>
) {
    const reason = `automation:${decision.reason}`;
    const phone = decision.phone || null;

    const notesPayload = {
        source: "messages_automation",
        quo_conversation_id: decision.conversationId || null,
        inbound_text: decision.inboundText || null,
        message_count: decision.messageCount || null,
        newest_message_at: decision.newestMessageAt || null,
        ...extraNotes,
    };

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
                human_notes: JSON.stringify(notesPayload, null, 2),
            })
            .eq("id", existing.id);

        if (error) throw error;

        return;
    }

    const { error } = await supabaseServer.from("human_escalations").insert({
        phone,
        reason,
        priority: "normal",
        status: "open",
        human_notes: JSON.stringify(notesPayload, null, 2),
    });

    if (error) throw error;
}

async function lookupEligibleLead(phone?: string) {
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

function buildDecisionPayload(params: {
    decision: Decision;
    lead?: MatchedLead | null;
    templateKey?: string | null;
    messagePreview?: string | null;
    reason?: string | null;
    nextStep?: string | null;
    quoSenderTemplateResponse?: unknown;
}): DecisionPayload {
    return {
        phone: params.decision.phone || null,
        inboundText: params.decision.inboundText || null,
        templateKey: params.templateKey || null,
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
        reason: params.reason || params.decision.reason || null,
        nextStep: params.nextStep || null,
        quoSenderTemplateResponse: params.quoSenderTemplateResponse,
    };
}

function getMessageText(message: QuoMessage) {
    return message.body || message.text || "";
}

function getMessageTime(message: QuoMessage) {
    return message.createdAt || message.sentAt || message.failedAt || "";
}

function getMessageTimestamp(message: QuoMessage) {
    const raw = getMessageTime(message);
    const time = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
}

function isInboundMessage(message: QuoMessage) {
    const direction = String(message.direction || "").toLowerCase();

    return (
        direction === "inbound" ||
        direction === "incoming" ||
        direction === "received"
    );
}

function isOutboundMessage(message: QuoMessage) {
    const direction = String(message.direction || "").toLowerCase();

    return (
        direction === "outbound" ||
        direction === "outgoing" ||
        direction === "sent"
    );
}

function isOurIntroMessage(message: QuoMessage) {
    const text = getMessageText(message).toLowerCase();

    return (
        isOutboundMessage(message) &&
        text.includes("my name is moses") &&
        text.includes("you requested information") &&
        text.includes("schedule a showing")
    );
}

function isPositiveReply(text: string) {
    const normalized = text.toLowerCase();

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
        "interested",
        "available",
        "schedule",
        "showing",
        "tour",
        "see",
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

    return positiveSignals.some((signal) => normalized.includes(signal));
}

function getConversationPhone(conversation: QuoConversation) {
    const raw = conversation.participants?.[0] || "";
    const digits = raw.replace(/\D/g, "");

    if (raw.startsWith("+")) return raw;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

    return raw;
}

function decideConversation(params: {
    conversation: QuoConversation;
    messages: QuoMessage[];
    previousLastCheckedAt: string | null;
}): Decision {
    const { conversation, messages, previousLastCheckedAt } = params;

    const ordered = messages
        .filter((message) => getMessageText(message).trim().length > 0)
        .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

    if (ordered.length === 0) {
        return {
            action: "no_new_messages",
            reason: "conversation_has_no_messages",
            conversationId: conversation.id,
            phone: getConversationPhone(conversation),
            messageCount: 0,
            newestMessageAt: null,
        };
    }

    const newestMessage = ordered[ordered.length - 1];
    const newestMessageAt = getMessageTime(newestMessage);

    const checkpointTime = previousLastCheckedAt
        ? new Date(previousLastCheckedAt).getTime()
        : 0;

    const newMessages = ordered.filter(
        (message) => getMessageTimestamp(message) > checkpointTime
    );

    if (newMessages.length === 0) {
        return {
            action: "no_new_messages",
            reason: "no_messages_newer_than_checkpoint",
            conversationId: conversation.id,
            phone: getConversationPhone(conversation),
            messageCount: ordered.length,
            newestMessageAt,
        };
    }

    if (ordered.length === 1 && isOurIntroMessage(ordered[0])) {
        return {
            action: "wait_for_reply",
            reason: "only_intro_message_found",
            conversationId: conversation.id,
            phone: getConversationPhone(conversation),
            messageCount: ordered.length,
            newestMessageAt,
        };
    }

    if (
        ordered.length === 2 &&
        isOurIntroMessage(ordered[0]) &&
        isInboundMessage(ordered[1])
    ) {
        const inboundText = getMessageText(ordered[1]);

        if (!isPositiveReply(inboundText)) {
            return {
                action: "human_review",
                reason: "lead_reply_not_clearly_positive",
                conversationId: conversation.id,
                phone: getConversationPhone(conversation),
                inboundText,
                messageCount: ordered.length,
                newestMessageAt,
            };
        }

        return {
            action: "send_requirements",
            reason: "clean_intro_plus_positive_reply",
            conversationId: conversation.id,
            phone: getConversationPhone(conversation),
            inboundText,
            messageCount: ordered.length,
            newestMessageAt,
        };
    }

    return {
        action: "human_review",
        reason: "conversation_has_more_than_clean_intro_reply",
        conversationId: conversation.id,
        phone: getConversationPhone(conversation),
        messageCount: ordered.length,
        newestMessageAt,
    };
}

export async function POST(request: Request) {
    try {
        const url = new URL(request.url);
        const ignoreCheckpoint = url.searchParams.get("ignoreCheckpoint") === "1";

        const state = await ensureState();

        const previousLastCheckedAt = ignoreCheckpoint
            ? null
            : (state.last_checked_at as string | null);

        await updateState({ status: "fetching" });

        const primaryInboxId = process.env.QUO_PRIMARY_INBOX_ID || "";
        const conversationsPage = await listQuoConversations({ limit: 100 });

        const conversations = primaryInboxId
            ? (conversationsPage.data || []).filter(
                (conversation) => conversation.phoneNumberId === primaryInboxId
            )
            : conversationsPage.data || [];

        const decisions: Decision[] = [];
        let newestSeenAt: string | null = previousLastCheckedAt;

        for (const conversation of conversations) {
            const phoneNumberId = conversation.phoneNumberId;
            const participants = conversation.participants || [];

            if (!phoneNumberId || participants.length === 0) {
                decisions.push({
                    action: "human_review",
                    reason: "conversation_missing_phoneNumberId_or_participants",
                    conversationId: conversation.id,
                    phone: getConversationPhone(conversation),
                });
                continue;
            }

            const messagesPage = await listQuoMessages({
                phoneNumberId,
                participants,
                limit: 10,
            });

            const decision = decideConversation({
                conversation,
                messages: messagesPage.data || [],
                previousLastCheckedAt,
            });

            decisions.push(decision);

            if (decision.newestMessageAt) {
                const currentNewest = newestSeenAt
                    ? new Date(newestSeenAt).getTime()
                    : 0;
                const decisionNewest = new Date(decision.newestMessageAt).getTime();

                if (decisionNewest > currentNewest) {
                    newestSeenAt = decision.newestMessageAt;
                }
            }
        }

        if (newestSeenAt) {
            await updateState({
                last_checked_at: newestSeenAt,
            });
        }

        const actionable =
            decisions.find((d) => d.action === "send_requirements") ||
            decisions.find((d) => d.action === "human_review") ||
            decisions.find((d) => d.action === "wait_for_reply") ||
            decisions[0] || {
                action: "no_new_messages",
                reason: "no_conversations_checked",
            };

        if (actionable.action === "send_requirements") {
            await updateState({ status: "matching_lead" });

            const lookup = await lookupEligibleLead(actionable.phone);

            if (lookup.error) {
                const failedDecision: Decision = {
                    ...actionable,
                    action: "human_review",
                    reason: `lead_lookup_failed:${lookup.error}`,
                };

                const payload = buildDecisionPayload({
                    decision: failedDecision,
                    reason: failedDecision.reason,
                    nextStep: "Human Review",
                });

                await updateState({ status: "human_review" });
                await createHumanEscalation(failedDecision, {
                    lead_lookup_error: lookup.error,
                    matched_count: lookup.matchedCount,
                });

                await logDecision({
                    action: "human_review",
                    reason: failedDecision.reason,
                    phone: failedDecision.phone,
                    inboundText: failedDecision.inboundText,
                    replyText: JSON.stringify(payload),
                });
            } else if (lookup.matchedCount !== 1 || !lookup.lead) {
                const failedDecision: Decision = {
                    ...actionable,
                    action: "human_review",
                    reason:
                        lookup.matchedCount > 1
                            ? "multiple_matching_eligible_leads"
                            : "no_matching_eligible_lead",
                };

                const payload = buildDecisionPayload({
                    decision: failedDecision,
                    reason: failedDecision.reason,
                    nextStep: "Human Review",
                });

                await updateState({ status: "human_review" });
                await createHumanEscalation(failedDecision, {
                    matched_count: lookup.matchedCount,
                });

                await logDecision({
                    action: "human_review",
                    reason: failedDecision.reason,
                    phone: failedDecision.phone,
                    inboundText: failedDecision.inboundText,
                    replyText: JSON.stringify(payload),
                });
            } else if (!lookup.lead.apt_address) {
                const failedDecision: Decision = {
                    ...actionable,
                    action: "human_review",
                    reason: "matched_lead_missing_apt_address",
                };

                const payload = buildDecisionPayload({
                    decision: failedDecision,
                    lead: lookup.lead,
                    reason: failedDecision.reason,
                    nextStep: "Human Review",
                });

                await updateState({ status: "human_review" });
                await createHumanEscalation(failedDecision, {
                    lead: lookup.lead,
                });

                await logDecision({
                    action: "human_review",
                    reason: failedDecision.reason,
                    phone: failedDecision.phone,
                    inboundText: failedDecision.inboundText,
                    replyText: JSON.stringify(payload),
                });
            } else {
                await updateState({ status: "choosing_template" });

                try {
                    const renderedTemplate = await renderQuoSenderTemplateByAddress({
                        aptAddress: lookup.lead.apt_address,
                        templateKey: REQUIREMENTS_TEMPLATE_KEY,
                    });

                    const messagePreview = getRenderedTemplateText(renderedTemplate);

                    if (!messagePreview) {
                        const failedDecision: Decision = {
                            ...actionable,
                            action: "human_review",
                            reason: "template_render_empty",
                        };

                        const payload = buildDecisionPayload({
                            decision: failedDecision,
                            lead: lookup.lead,
                            templateKey: REQUIREMENTS_TEMPLATE_KEY,
                            reason: failedDecision.reason,
                            nextStep: "Human Review",
                            quoSenderTemplateResponse: renderedTemplate,
                        });

                        await updateState({ status: "human_review" });
                        await createHumanEscalation(failedDecision, {
                            lead: lookup.lead,
                            template_key: REQUIREMENTS_TEMPLATE_KEY,
                            template_response: renderedTemplate,
                        });

                        await logDecision({
                            action: "human_review",
                            reason: failedDecision.reason,
                            phone: failedDecision.phone,
                            inboundText: failedDecision.inboundText,
                            replyText: JSON.stringify(payload),
                        });
                    } else {
                        const payload = buildDecisionPayload({
                            decision: actionable,
                            lead: lookup.lead,
                            templateKey: REQUIREMENTS_TEMPLATE_KEY,
                            messagePreview,
                            reason: actionable.reason,
                            nextStep: "Ready to send through Web Auto",
                            quoSenderTemplateResponse: renderedTemplate,
                        });

                        await updateState({ status: "template_selected" });

                        await logDecision({
                            action: "send_requirements",
                            reason: actionable.reason,
                            phone: actionable.phone,
                            inboundText: actionable.inboundText,
                            replyText: JSON.stringify(payload),
                        });
                    }
                } catch (templateError) {
                    const failedDecision: Decision = {
                        ...actionable,
                        action: "human_review",
                        reason: "template_render_failed",
                    };

                    const payload = buildDecisionPayload({
                        decision: failedDecision,
                        lead: lookup.lead,
                        templateKey: REQUIREMENTS_TEMPLATE_KEY,
                        reason: failedDecision.reason,
                        nextStep: "Human Review",
                    });

                    await updateState({ status: "human_review" });
                    await createHumanEscalation(failedDecision, {
                        lead: lookup.lead,
                        template_key: REQUIREMENTS_TEMPLATE_KEY,
                        template_error:
                            templateError instanceof Error
                                ? templateError.message
                                : String(templateError),
                    });

                    await logDecision({
                        action: "human_review",
                        reason: failedDecision.reason,
                        phone: failedDecision.phone,
                        inboundText: failedDecision.inboundText,
                        replyText: JSON.stringify(payload),
                        error:
                            templateError instanceof Error
                                ? templateError.message
                                : String(templateError),
                    });
                }
            }
        } else if (actionable.action === "human_review") {
            await updateState({ status: "human_review" });

            await createHumanEscalation(actionable);

            await logDecision({
                action: "human_review",
                reason: actionable.reason,
                phone: actionable.phone,
                inboundText: actionable.inboundText,
            });
        } else if (actionable.action === "wait_for_reply") {
            await updateState({ status: "idle" });

            await logDecision({
                action: "wait_for_reply",
                reason: actionable.reason,
                phone: actionable.phone,
            });
        } else {
            await updateState({ status: "idle" });

            await logDecision({
                action: "no_new_messages",
                reason: "No messages newer than the last checkpoint were found.",
            });
        }

        const refreshedState = await ensureState();

        const { data: decisionsLog } = await supabaseServer
            .from("ai_decisions")
            .select(
                "id, created_at, intent, decision, reply_text, needs_human, human_reason, should_send, sent, error, model_used, prompt_version"
            )
            .eq("prompt_version", PROMPT_VERSION)
            .order("created_at", { ascending: false })
            .limit(50);

        const { data: humanEscalations } = await supabaseServer
            .from("human_escalations")
            .select(
                "id, created_at, updated_at, phone, reason, priority, status, human_notes, resolved_at"
            )
            .eq("status", "open")
            .ilike("reason", "automation:%")
            .order("created_at", { ascending: false })
            .limit(50);

        return NextResponse.json({
            ok: true,
            previousLastCheckedAt,
            lastCheckedAt: newestSeenAt,
            action: actionable.action,
            decision: actionable,
            decisions,
            state: refreshedState,
            decisionsLog: decisionsLog || [],
            humanEscalations: humanEscalations || [],
        });
    } catch (error) {
        console.error("messages-automation/run-now error:", error);

        try {
            await updateState({ status: "error" });

            await logDecision({
                action: "error",
                reason: "Automation check failed",
                error: error instanceof Error ? error.message : String(error),
            });
        } catch {
            // Ignore secondary logging error.
        }

        return NextResponse.json(
            {
                ok: false,
                action: "error",
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}