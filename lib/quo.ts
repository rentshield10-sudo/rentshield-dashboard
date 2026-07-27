export interface QuoConversation {
    id: string;
    contactId?: string;
    channel?: string;
    lastMessageSnippet?: string;
    lastActivityAt?: string;
    createdAt: string;
    updatedAt?: string;
    name?: string | null;
    participants?: string[];
    phoneNumberId?: string;
}

export interface QuoMessage {
    id: string;
    conversationId?: string;
    direction?: string;
    body?: string;
    text?: string;
    status?: string;
    fromNumber?: string;
    toNumber?: string;
    from?: string;
    to?: string;
    createdAt?: string;
    sentAt?: string;
    failedAt?: string;
    errorMessage?: string;
}

export interface QuoPaginated<T> {
    data: T[];
    hasNextPage?: boolean;
    nextCursor?: string;
    nextPageToken?: string | null;
    totalItems?: number;
}

const quoBaseUrl = process.env.QUO_BASE_URL || "https://api.openphone.com";
const quoApiKey = process.env.QUO_API_KEY || "";

function normalizeParticipantPhone(phone: string) {
    const trimmed = String(phone || "").trim();

    if (trimmed.startsWith("+")) {
        return trimmed;
    }

    const digits = trimmed.replace(/\D/g, "");

    if (digits.length === 10) {
        return `+1${digits}`;
    }

    if (digits.length === 11 && digits.startsWith("1")) {
        return `+${digits}`;
    }

    return trimmed;
}

async function fetchQuo<T>(endpoint: string): Promise<T> {
    const url = `${quoBaseUrl}${endpoint}`;

    if (!quoApiKey) {
        throw new Error("Missing QUO_API_KEY");
    }

    const response = await fetch(url, {
        headers: {
            Authorization: quoApiKey,
            "Content-Type": "application/json",
        },
        cache: "no-store",
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `Quo upstream error ${response.status}: ${response.statusText} ${body}`
        );
    }

    return response.json() as Promise<T>;
}

export async function listQuoConversations(params?: {
    limit?: number;
    cursor?: string;
}) {
    const query = new URLSearchParams();

    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.cursor) query.set("pageToken", params.cursor);

    return fetchQuo<QuoPaginated<QuoConversation>>(
        `/v1/conversations?${query.toString()}`
    );
}

export async function listQuoMessages(params: {
    phoneNumberId: string;
    participants: string[];
    limit?: number;
    cursor?: string;
}) {
    const query = new URLSearchParams();

    query.set("phoneNumberId", params.phoneNumberId);

    for (const participant of params.participants) {
        const normalizedParticipant = normalizeParticipantPhone(participant);

        if (normalizedParticipant) {
            query.append("participants", normalizedParticipant);
        }
    }

    if (params.limit) query.set("limit", String(params.limit));
    if (params.cursor) query.set("pageToken", params.cursor);

    return fetchQuo<QuoPaginated<QuoMessage>>(
        `/v1/messages?${query.toString()}`
    );
}

export function getQuoMessageText(message: QuoMessage) {
    return message.body || message.text || "";
}

export function getQuoMessageTime(message: QuoMessage) {
    return message.createdAt || message.sentAt || message.failedAt || "";
}

export function isQuoInboundMessage(message: QuoMessage) {
    const direction = String(message.direction || "").toLowerCase();

    return (
        direction === "inbound" ||
        direction === "incoming" ||
        direction === "received"
    );
}

export function isQuoOutboundMessage(message: QuoMessage) {
    const direction = String(message.direction || "").toLowerCase();

    return (
        direction === "outbound" ||
        direction === "outgoing" ||
        direction === "sent"
    );
}