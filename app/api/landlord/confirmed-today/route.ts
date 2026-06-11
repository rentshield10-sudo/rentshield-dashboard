import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const APP_TIME_ZONE = "America/New_York";

type StatusAction = "attended" | "cancelled" | "rescheduled" | "no_show";

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("Missing Supabase server environment variables.");
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
        },
    });
}

function isAuthorized(request: NextRequest) {
    const expectedToken = process.env.LANDLORD_PAGE_TOKEN;

    if (!expectedToken) {
        return false;
    }

    const urlToken = request.nextUrl.searchParams.get("token");
    const headerToken = request.headers.get("x-landlord-token");

    return urlToken === expectedToken || headerToken === expectedToken;
}

function getDateKeyInTimeZone(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const get = (type: string) => parts.find((part) => part.type === type)?.value;

    return `${get("year")}-${get("month")}-${get("day")}`;
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
    }).formatToParts(date);

    const tzName = parts.find((part) => part.type === "timeZoneName")?.value || "";
    const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);

    if (!match) return 0;

    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);

    return sign * (hours * 60 + minutes);
}

function newYorkLocalToUtcIso(dateKey: string, timeValue: string) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const [hour, minute] = timeValue.split(":").map(Number);

    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offsetMinutes = getTimeZoneOffsetMinutes(
        APP_TIME_ZONE,
        new Date(localAsUtc)
    );

    return new Date(localAsUtc - offsetMinutes * 60000).toISOString();
}

function getStatusUpdate(action: StatusAction) {
    if (action === "attended") {
        return {
            appointment_status: "completed",
            attendance_status: "attended",
            pipeline_stage: "attended",
        };
    }

    if (action === "cancelled") {
        return {
            appointment_status: "cancelled",
            attendance_status: "cancelled",
            pipeline_stage: "cancelled",
        };
    }

    if (action === "rescheduled") {
        return {
            appointment_status: "rescheduled",
            attendance_status: "rescheduled",
            pipeline_stage: "rescheduled",
        };
    }

    return {
        appointment_status: "no_show",
        attendance_status: "no_show",
        pipeline_stage: "no_show",
    };
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json(
                { error: "Unauthorized landlord page access." },
                { status: 401 }
            );
        }

        const supabase = getSupabaseAdmin();

        const dateParam = request.nextUrl.searchParams.get("date");

        const dateKey =
            dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
                ? dateParam
                : getDateKeyInTimeZone(new Date(), APP_TIME_ZONE);

        const startIso = newYorkLocalToUtcIso(dateKey, "00:00");

        const endDate = new Date(startIso);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        const endIso = endDate.toISOString();

        const { data, error } = await supabase
            .from("dashboard_showing_appointments")
            .select(
                "id, schedule_id, lead_id, lead_name, phone, apt_address, showing_at, appointment_status, confirmation_status, attendance_status, confirmed_at, notes"
            )
            .gte("showing_at", startIso)
            .lt("showing_at", endIso)
            .or("confirmation_status.eq.confirmed,appointment_status.eq.confirmed")
            .order("apt_address", { ascending: true })
            .order("showing_at", { ascending: true })
            .order("lead_name", { ascending: true });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            dateKey,
            startIso,
            endIso,
            appointments: data || [],
        });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unexpected server error.",
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json(
                { error: "Unauthorized landlord page access." },
                { status: 401 }
            );
        }

        const body = await request.json();

        const appointmentId = Number(body.appointmentId);
        const action = String(body.action || "") as StatusAction;

        if (!appointmentId) {
            return NextResponse.json(
                { error: "Missing appointment ID." },
                { status: 400 }
            );
        }

        if (!["attended", "cancelled", "rescheduled", "no_show"].includes(action)) {
            return NextResponse.json(
                { error: "Invalid status action." },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();

        const { data: appointment, error: readError } = await supabase
            .from("dashboard_showing_appointments")
            .select("id, lead_id, lead_name, phone, apt_address, showing_at")
            .eq("id", appointmentId)
            .single();

        if (readError || !appointment) {
            return NextResponse.json(
                { error: readError?.message || "Appointment not found." },
                { status: 404 }
            );
        }

        const update = getStatusUpdate(action);

        const { error: appointmentError } = await supabase
            .from("dashboard_showing_appointments")
            .update({
                appointment_status: update.appointment_status,
                attendance_status: update.attendance_status,
                updated_at: new Date().toISOString(),
            })
            .eq("id", appointmentId);

        if (appointmentError) {
            return NextResponse.json(
                { error: appointmentError.message },
                { status: 500 }
            );
        }

        if (appointment.lead_id) {
            const { error: leadError } = await supabase
                .from("dashboard_leads")
                .update({
                    appointment_status: update.appointment_status,
                    attendance_status: update.attendance_status,
                    pipeline_stage: update.pipeline_stage,
                    last_pipeline_update_at: new Date().toISOString(),
                })
                .eq("lead_id", appointment.lead_id);

            if (leadError) {
                return NextResponse.json(
                    { error: leadError.message },
                    { status: 500 }
                );
            }
        }

        return NextResponse.json({
            ok: true,
            appointmentId,
            action,
            appointment_status: update.appointment_status,
            attendance_status: update.attendance_status,
            pipeline_stage: update.pipeline_stage,
        });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unexpected server error.",
            },
            { status: 500 }
        );
    }
}