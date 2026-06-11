"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./TodayLandlordPage.module.css";

type Appointment = {
    id: number;
    schedule_id: number | null;
    lead_id: string | null;
    lead_name: string | null;
    phone: string | null;
    apt_address: string | null;
    showing_at: string | null;
    appointment_status: string | null;
    confirmation_status: string | null;
    attendance_status: string | null;
    confirmed_at: string | null;
    notes: string | null;
};

type GroupedAppointments = {
    key: string;
    apt_address: string;
    showing_at: string | null;
    appointments: Appointment[];
};

const APP_TIME_ZONE = "America/New_York";

function formatTime(value: string | null) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleTimeString("en-US", {
        timeZone: APP_TIME_ZONE,
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatDateKeyLabel(dateKey: string | null) {
    if (!dateKey) {
        return new Date().toLocaleDateString("en-US", {
            timeZone: APP_TIME_ZONE,
            weekday: "long",
            month: "short",
            day: "numeric",
        });
    }

    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        month: "short",
        day: "numeric",
    });
}

function getStatusLabel(appointment: Appointment) {
    const attendance = String(appointment.attendance_status || "").toLowerCase();
    const status = String(appointment.appointment_status || "").toLowerCase();

    if (attendance === "attended") return "ATTENDED ✅";
    if (attendance === "cancelled") return "CANCELLED ❌";
    if (attendance === "rescheduled") return "RESCHEDULED 🔁";
    if (attendance === "no_show") return "NO SHOW 🚫";

    if (status === "completed") return "COMPLETED ✅";
    if (status === "confirmed") return "CONFIRMED";
    if (status === "booked") return "BOOKED";

    return status ? status.toUpperCase() : "PENDING";
}

function getButtonClass(action: string) {
    if (action === "attended") return styles.attendedButton;
    if (action === "cancelled") return styles.cancelledButton;
    if (action === "rescheduled") return styles.rescheduledButton;
    return styles.noShowButton;
}

function normalizePhone(value: string | null) {
    const digits = String(value || "").replace(/\D/g, "");

    if (digits.length === 11 && digits.startsWith("1")) {
        return digits.slice(1);
    }

    if (digits.length > 10) {
        return digits.slice(-10);
    }

    return digits;
}

function getPhoneHref(phone: string | null, type: "call" | "sms") {
    const normalized = normalizePhone(phone);

    if (!normalized) return "#";

    return type === "call" ? `tel:${normalized}` : `sms:${normalized}`;
}

function getActionLabel(action: string) {
    if (action === "attended") return "Attended";
    if (action === "cancelled") return "Cancelled";
    if (action === "rescheduled") return "Rescheduled";
    return "No Show";
}

export default function TodayLandlordPage() {
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [token, setToken] = useState<string | null>(null);
    const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<number | null>(null);
    const [message, setMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    const groupedAppointments = useMemo<GroupedAppointments[]>(() => {
        const map = new Map<string, GroupedAppointments>();

        for (const appointment of appointments) {
            const aptAddress = appointment.apt_address || "No apartment";
            const showingAt = appointment.showing_at || "";
            const key = `${aptAddress}__${showingAt}`;

            const current =
                map.get(key) ||
                ({
                    key,
                    apt_address: aptAddress,
                    showing_at: appointment.showing_at,
                    appointments: [],
                } satisfies GroupedAppointments);

            current.appointments.push(appointment);
            map.set(key, current);
        }

        return Array.from(map.values()).sort((a, b) => {
            const timeA = a.showing_at ? new Date(a.showing_at).getTime() : 0;
            const timeB = b.showing_at ? new Date(b.showing_at).getTime() : 0;

            if (timeA !== timeB) return timeA - timeB;

            return a.apt_address.localeCompare(b.apt_address);
        });
    }, [appointments]);

    async function loadAppointments(currentToken = token) {
        if (!currentToken) {
            setLoading(false);
            setErrorMessage("Missing landlord access token.");
            return;
        }

        setLoading(true);
        setErrorMessage("");
        setMessage("");

        try {
            const params = new URLSearchParams(window.location.search);
            const dateParam = params.get("date") || "";

            const response = await fetch(
                `/api/landlord/confirmed-today?token=${encodeURIComponent(
                    currentToken
                )}${dateParam ? `&date=${encodeURIComponent(dateParam)}` : ""}`,
                {
                    cache: "no-store",
                }
            );

            const responseText = await response.text();

            let payload: any = {};

            try {
                payload = JSON.parse(responseText);
            } catch {
                throw new Error(
                    "API did not return JSON. Check app/api/landlord/confirmed-today/route.ts."
                );
            }

            if (!response.ok) {
                setErrorMessage(payload.error || "Unable to load appointments.");
                setAppointments([]);
                setSelectedDateKey(payload.dateKey || dateParam || null);
                setLoading(false);
                return;
            }

            setAppointments(payload.appointments || []);
            setSelectedDateKey(payload.dateKey || dateParam || null);
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Unable to load appointments."
            );
            setAppointments([]);
        }

        setLoading(false);
    }

    async function updateStatus(appointment: Appointment, action: string) {
        if (!token) {
            setErrorMessage("Missing landlord access token.");
            return;
        }

        const label = getActionLabel(action);

        const confirmed = window.confirm(
            `Mark ${appointment.lead_name || "this lead"} as ${label}?`
        );

        if (!confirmed) return;

        setSavingId(appointment.id);
        setMessage("");
        setErrorMessage("");

        try {
            const params = new URLSearchParams(window.location.search);
            const dateParam = params.get("date") || "";

            const response = await fetch(
                `/api/landlord/confirmed-today?token=${encodeURIComponent(
                    token
                )}${dateParam ? `&date=${encodeURIComponent(dateParam)}` : ""}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        appointmentId: appointment.id,
                        action,
                    }),
                }
            );

            const responseText = await response.text();

            let payload: any = {};

            try {
                payload = JSON.parse(responseText);
            } catch {
                throw new Error(
                    "API did not return JSON. Check app/api/landlord/confirmed-today/route.ts."
                );
            }

            if (!response.ok) {
                setErrorMessage(payload.error || "Unable to update status.");
                setSavingId(null);
                return;
            }

            setMessage(`${appointment.lead_name || "Lead"} updated to ${label}.`);

            await loadAppointments(token);
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "Unable to update status."
            );
        }

        setSavingId(null);
    }

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get("token") || "";
        const dateParam = params.get("date") || "";

        setToken(urlToken);
        setSelectedDateKey(dateParam || null);
        loadAppointments(urlToken);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <div>
                    <div className={styles.kicker}>Mission Control</div>
                    <h1>Confirmed Today</h1>
                    <p>{formatDateKeyLabel(selectedDateKey)}</p>
                </div>

                <button
                    className={styles.refreshButton}
                    type="button"
                    onClick={() => loadAppointments()}
                    disabled={loading}
                >
                    {loading ? "Loading..." : "Refresh"}
                </button>
            </header>

            {message ? <div className={styles.successBox}>{message}</div> : null}
            {errorMessage ? <div className={styles.errorBox}>{errorMessage}</div> : null}

            {loading ? (
                <div className={styles.emptyBox}>Loading confirmed showings...</div>
            ) : null}

            {!loading && !groupedAppointments.length && !errorMessage ? (
                <div className={styles.emptyBox}>No confirmed showings today.</div>
            ) : null}

            <section className={styles.groupList}>
                {groupedAppointments.map((group) => (
                    <div className={styles.groupCard} key={group.key}>
                        <div className={styles.groupHead}>
                            <div>
                                <h2>{group.apt_address}</h2>
                                <p>{formatTime(group.showing_at)}</p>
                            </div>

                            <span>{group.appointments.length}</span>
                        </div>

                        <div className={styles.leadList}>
                            {group.appointments.map((appointment) => (
                                <div className={styles.leadRow} key={appointment.id}>
                                    <div className={styles.leadMain}>
                                        <div className={styles.leadName}>
                                            {appointment.lead_name || "Unnamed Lead"}
                                        </div>

                                        <div className={styles.leadPhone}>
                                            {appointment.phone || "No phone"}
                                        </div>

                                        <div className={styles.statusBadge}>
                                            {getStatusLabel(appointment)}
                                        </div>
                                    </div>

                                    <div className={styles.leadControls}>
                                        <div className={styles.quickLinks}>
                                            <a href={getPhoneHref(appointment.phone, "call")}>
                                                Call
                                            </a>
                                            <a href={getPhoneHref(appointment.phone, "sms")}>
                                                SMS
                                            </a>
                                        </div>

                                        <div className={styles.buttonGrid}>
                                            {[
                                                ["attended", "Attended"],
                                                ["cancelled", "Cancel"],
                                                ["rescheduled", "Resched"],
                                                ["no_show", "No Show"],
                                            ].map(([action, label]) => (
                                                <button
                                                    key={action}
                                                    className={`${styles.statusButton} ${getButtonClass(
                                                        action
                                                    )}`}
                                                    type="button"
                                                    disabled={savingId === appointment.id}
                                                    onClick={() => updateStatus(appointment, action)}
                                                >
                                                    {savingId === appointment.id
                                                        ? "Saving..."
                                                        : label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </section>
        </main>
    );
}