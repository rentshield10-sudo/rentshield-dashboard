import { NextResponse } from "next/server";

const QUO_API_BASE_URL =
    process.env.QUO_API_BASE_URL || "https://api.quo.com";

const QUO_API_KEY = process.env.QUO_API_KEY || "";
const QUO_PRIMARY_INBOX_ID = process.env.QUO_PRIMARY_INBOX_ID || "";

function normalizePhone(phone?: string | null) {
    const raw = String(phone || "").trim();

    if (!raw) return null;
    if (raw.startsWith("+")) return raw;

    const digits = raw.replace(/\D/g, "");

    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

    return raw;
}

function getMessageText(message: any) {
    return String(
        message.text ||
        message.body ||
        message.content ||
        message.message ||
        ""
    ).trim();
}

function normalizeDirection(direction?: string | null) {
    const value = String(direction || "").toLowerCase();

    if (
        value === "incoming" ||
        value === "inbound" ||
        value === "received"
    ) {
        return "inbound";
    }

    if (
        value === "outgoing" ||
        value === "outbound" ||
        value === "sent"
    ) {
        return "outbound";
    }

    return value || "unknown";
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        const phone = normalizePhone(searchParams.get("phone"));
        const cursor = searchParams.get("cursor");
        const limit = Math.min(Number(searchParams.get("limit") || 5), 25);

        if (!QUO_API_KEY) {
            return NextResponse.json(
                { ok: false, error: "Missing QUO_API_KEY" },
                { status: 500 }
            );
        }

        if (!QUO_PRIMARY_INBOX_ID) {
            return NextResponse.json(
                { ok: false, error: "Missing QUO_PRIMARY_INBOX_ID" },
                { status: 500 }
            );
        }

        if (!phone) {
            return NextResponse.json(
                { ok: false, error: "phone is required" },
                { status: 400 }
            );
        }

        const quoUrl = new URL(`${QUO_API_BASE_URL}/v1/messages`);

        quoUrl.searchParams.set("phoneNumberId", QUO_PRIMARY_INBOX_ID);
        quoUrl.searchParams.append("participants", phone);
        quoUrl.searchParams.set("maxResults", String(limit));

        // The dashboard uses cursor as the oldest loaded created_at.
        // For lazy loading, fetch messages before that timestamp.
        if (cursor) {
            quoUrl.searchParams.set("createdBefore", cursor);
        }

        const response = await fetch(quoUrl.toString(), {
            method: "GET",
            headers: {
                Authorization: QUO_API_KEY,
                Accept: "application/json",
            },
            cache: "no-store",
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        payload?.error ||
                        payload?.message ||
                        `Quo API returned ${response.status}`,
                    details: payload,
                },
                { status: response.status }
            );
        }

        const rawMessages = Array.isArray(payload?.data) ? payload.data : [];

        const messages = rawMessages
            .map((message: any) => {
                const direction = normalizeDirection(message.direction);
                const createdAt =
                    message.createdAt ||
                    message.created_at ||
                    message.sentAt ||
                    message.updatedAt ||
                    null;

                return {
                    id: message.id,
                    created_at: createdAt,
                    phone,
                    channel: "quo_live",
                    direction,
                    message_text: getMessageText(message),
                    external_message_id: message.id,
                    external_conversation_id: message.conversationId || null,
                    intent: "live_quo_api",
                    processed: true,
                    raw: message,
                };
            })
            .filter((message: any) => message.message_text)
            .sort((a: any, b: any) => {
                return (
                    new Date(b.created_at || 0).getTime() -
                    new Date(a.created_at || 0).getTime()
                );
            });

        const oldestLoaded = messages[messages.length - 1]?.created_at || null;

        return NextResponse.json({
            ok: true,
            source: "quo_live_api",
            messages,
            hasMore: Boolean(payload?.nextPageToken || messages.length >= limit),
            nextCursor: oldestLoaded,
            nextPageToken: payload?.nextPageToken || null,
            rawCount: rawMessages.length,
        });
    } catch (error) {
        console.error("GET live Quo messages error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}