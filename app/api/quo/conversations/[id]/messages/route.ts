import { NextRequest, NextResponse } from "next/server";
import { listQuoMessages } from "../../../../../../lib/quo";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        await context.params;

        const searchParams = request.nextUrl.searchParams;

        const phoneNumberId = searchParams.get("phoneNumberId") || "";
        const participants = searchParams.getAll("participants");
        const limit = Number(searchParams.get("limit") || "30");
        const cursor = searchParams.get("cursor") || undefined;

        if (!phoneNumberId) {
            return NextResponse.json(
                { error: "phoneNumberId is required" },
                { status: 400 }
            );
        }

        if (!participants.length) {
            return NextResponse.json(
                { error: "At least one participant is required" },
                { status: 400 }
            );
        }

        const page = await listQuoMessages({
            phoneNumberId,
            participants,
            limit,
            cursor,
        });

        return NextResponse.json({
            data: page.data || [],
            cursor: page.nextPageToken || page.nextCursor || null,
            hasMore: Boolean(page.nextPageToken || page.nextCursor || page.hasNextPage),
        });
    } catch (error) {
        console.error("GET /api/quo/conversations/[id]/messages error:", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to fetch Quo messages",
            },
            { status: 500 }
        );
    }
}