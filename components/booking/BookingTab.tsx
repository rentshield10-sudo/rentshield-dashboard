"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import ScheduleTemplatesModal from "./ScheduleTemplatesModal";
import styles from "./BookingTab.module.css";

type BookingTabProps = {
    activeDateKey: string;
    availableApartments: string[];
};

type ShowingSchedule = {
    id: number;
    apt_address: string;
    showing_at: string;
    showing_label: string | null;
    schedule_status: string;
    max_slots: number;
    notes: string | null;
};

type ShowingAppointment = {
    id: number;
    schedule_id: number | null;
    lead_id: string | null;
    lead_name: string | null;
    phone: string | null;
    apt_address: string | null;
    showing_at: string | null;
    appointment_status: string;
    confirmation_status: string;
    attendance_status: string;
    confirmed_at: string | null;
    notes: string | null;
};

type LeadSearchResult = {
    lead_id: string | null;
    lead_name: string | null;
    phone: string | null;
    apt_address: string | null;
    current_status: string | null;
    conversation_stage: string | null;
};

const monthWeekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const commonTimes = [
    { label: "9:00 AM", value: "09:00" },
    { label: "10:00 AM", value: "10:00" },
    { label: "11:00 AM", value: "11:00" },
    { label: "12:00 PM", value: "12:00" },
    { label: "1:00 PM", value: "13:00" },
    { label: "2:00 PM", value: "14:00" },
    { label: "3:00 PM", value: "15:00" },
    { label: "4:00 PM", value: "16:00" },
    { label: "5:00 PM", value: "17:00" },
    { label: "6:00 PM", value: "18:00" },
    { label: "6:45 PM", value: "18:45" },
    { label: "7:00 PM", value: "19:00" },
    { label: "7:30 PM", value: "19:30" },
];

const appointmentStatusOptions = [
    "booked",
    "confirmed",
    "cancelled",
    "completed",
    "rescheduled",
    "no_show",
];

const confirmationStatusOptions = [
    "pending_confirmation",
    "confirmation_sent",
    "confirmed",
];

const attendanceStatusOptions = [
    "pending",
    "attended",
    "cancelled",
    "rescheduled",
    "no_show",
];

const APP_TIME_ZONE = "America/New_York";

function pad2(value: number) {
    return String(value).padStart(2, "0");
}

function utcDateFromKey(dateKey: string) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function dateKeyFromUtcDate(date: Date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
        date.getUTCDate()
    )}`;
}

function addDaysToDateKey(dateKey: string, days: number) {
    const date = utcDateFromKey(dateKey);
    date.setUTCDate(date.getUTCDate() + days);

    return dateKeyFromUtcDate(date);
}

function isAppointmentConfirmed(appointment: ShowingAppointment) {
    return (
        String(appointment.confirmation_status || "").toLowerCase() ===
        "confirmed" ||
        String(appointment.appointment_status || "").toLowerCase() === "confirmed"
    );
}

function formatMonthLabel(dateKey: string) {
    if (!dateKey) return "";

    return utcDateFromKey(dateKey).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
    });
}

function formatDateKeyShort(dateKey: string) {
    if (!dateKey) return "";

    return utcDateFromKey(dateKey).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
    });
}

function getMonthStartKey(dateKey: string) {
    if (!dateKey) return "";
    return `${dateKey.slice(0, 7)}-01`;
}

function buildMonthCells(activeDateKey: string) {
    const fallbackDateKey = "2026-06-01";
    const safeDateKey = activeDateKey || fallbackDateKey;
    const monthStartKey = getMonthStartKey(safeDateKey);
    const monthStartDate = utcDateFromKey(monthStartKey);

    const monthYear = monthStartDate.getUTCFullYear();
    const monthNumber = monthStartDate.getUTCMonth() + 1;
    const daysInMonth = new Date(
        Date.UTC(monthYear, monthNumber, 0)
    ).getUTCDate();
    const leadingBlanks = monthStartDate.getUTCDay();

    const cells: Array<{
        type: "blank" | "day";
        dayNumber?: number;
        dateKey?: string;
    }> = [];

    for (let i = 0; i < leadingBlanks; i++) {
        cells.push({ type: "blank" });
    }

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
        const date = new Date(Date.UTC(monthYear, monthNumber - 1, dayNumber));
        const dateKey = dateKeyFromUtcDate(date);

        cells.push({
            type: "day",
            dayNumber,
            dateKey,
        });
    }

    return {
        monthLabel: formatMonthLabel(monthStartKey),
        cells,
    };
}

function getDateKeyFromIso(value: string | null) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: APP_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const get = (type: string) => parts.find((part) => part.type === type)?.value;

    return `${get("year")}-${get("month")}-${get("day")}`;
}

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

function formatDateTime(value: string | null) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const datePart = date.toLocaleDateString("en-US", {
        timeZone: APP_TIME_ZONE,
        month: "short",
        day: "numeric",
    });

    return `${datePart} · ${formatTime(value)}`;
}

function normalizePhone(value: string | null) {
    const digitsOnly = String(value || "").replace(/\D/g, "");

    if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
        return digitsOnly.slice(1);
    }

    if (digitsOnly.length > 10) {
        return digitsOnly.slice(-10);
    }

    return digitsOnly;
}

function phonesMatch(a: string | null, b: string | null) {
    const phoneA = normalizePhone(a);
    const phoneB = normalizePhone(b);

    if (!phoneA || !phoneB) return false;

    return phoneA === phoneB;
}

function getPhoneHref(phone: string | null, type: "call" | "sms") {
    const normalized = normalizePhone(phone);

    if (!normalized) return "#";

    return type === "call" ? `tel:${normalized}` : `sms:${normalized}`;
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

function buildShowingLabel(dateKey: string, timeValue: string) {
    const iso = newYorkLocalToUtcIso(dateKey, timeValue);
    const date = new Date(iso);

    const weekday = date.toLocaleDateString("en-US", {
        timeZone: APP_TIME_ZONE,
        weekday: "long",
    });

    return `${weekday} ${formatTime(iso)}`;
}

export default function BookingTab({
    activeDateKey,
    availableApartments,
}: BookingTabProps) {
    const calendar = buildMonthCells(activeDateKey);

    const [schedules, setSchedules] = useState<ShowingSchedule[]>([]);
    const [appointments, setAppointments] = useState<ShowingAppointment[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");

    const [topScheduleDateKey, setTopScheduleDateKey] = useState(activeDateKey);

    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);

    const [scheduleDateKey, setScheduleDateKey] = useState(activeDateKey);
    const [scheduleTime, setScheduleTime] = useState("18:45");
    const [selectedApartments, setSelectedApartments] = useState<string[]>([]);
    const [scheduleNotes, setScheduleNotes] = useState("");

    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [phoneSearch, setPhoneSearch] = useState("");
    const [leadSearchMessage, setLeadSearchMessage] = useState("");
    const [foundLead, setFoundLead] = useState<LeadSearchResult | null>(null);
    const [selectedScheduleId, setSelectedScheduleId] = useState("");

    const [editingAppointment, setEditingAppointment] =
        useState<ShowingAppointment | null>(null);
    const [editAppointmentStatus, setEditAppointmentStatus] = useState("booked");
    const [editConfirmationStatus, setEditConfirmationStatus] = useState(
        "pending_confirmation"
    );
    const [editAttendanceStatus, setEditAttendanceStatus] = useState("pending");
    const [editAppointmentNotes, setEditAppointmentNotes] = useState("");

    async function loadBookingData() {
        setLoading(true);
        setErrorMessage("");

        const schedulesRequest = supabase
            .from("dashboard_showing_schedules")
            .select(
                "id, apt_address, showing_at, showing_label, schedule_status, max_slots, notes"
            )
            .order("showing_at", { ascending: true });

        const appointmentsRequest = supabase
            .from("dashboard_showing_appointments")
            .select(
                "id, schedule_id, lead_id, lead_name, phone, apt_address, showing_at, appointment_status, confirmation_status, attendance_status, confirmed_at, notes"
            )
            .order("showing_at", { ascending: true });

        const [schedulesResponse, appointmentsResponse] = await Promise.all([
            schedulesRequest,
            appointmentsRequest,
        ]);

        if (schedulesResponse.error) {
            setErrorMessage(schedulesResponse.error.message);
            setSchedules([]);
        } else {
            setSchedules(schedulesResponse.data || []);
        }

        if (appointmentsResponse.error) {
            setErrorMessage(appointmentsResponse.error.message);
            setAppointments([]);
        } else {
            setAppointments(appointmentsResponse.data || []);
        }

        setLoading(false);
    }

    useEffect(() => {
        loadBookingData();
    }, []);

    const schedulesByDay = useMemo(() => {
        const map = new Map<string, ShowingSchedule[]>();

        for (const schedule of schedules) {
            const dateKey = getDateKeyFromIso(schedule.showing_at);
            if (!dateKey) continue;

            const current = map.get(dateKey) || [];
            current.push(schedule);
            map.set(dateKey, current);
        }

        return map;
    }, [schedules]);

    const appointmentsByDay = useMemo(() => {
        const map = new Map<string, ShowingAppointment[]>();

        for (const appointment of appointments) {
            const dateKey = getDateKeyFromIso(appointment.showing_at);
            if (!dateKey) continue;

            const current = map.get(dateKey) || [];
            current.push(appointment);
            map.set(dateKey, current);
        }

        return map;
    }, [appointments]);

    const todaySchedules = useMemo(() => {
        return schedules.filter(
            (schedule) => getDateKeyFromIso(schedule.showing_at) === topScheduleDateKey
        );
    }, [topScheduleDateKey, schedules]);

    const scheduledAppointments = useMemo(() => {
        return appointments
            .filter((appointment) => {
                const showingDateKey = getDateKeyFromIso(appointment.showing_at);

                if (showingDateKey !== topScheduleDateKey) {
                    return false;
                }

                const status = String(appointment.appointment_status || "").toLowerCase();
                const attendance = String(appointment.attendance_status || "").toLowerCase();

                return (
                    !["cancelled", "completed", "no_show"].includes(status) &&
                    !["cancelled", "attended", "no_show"].includes(attendance)
                );
            })
            .slice(0, 15);
    }, [appointments, topScheduleDateKey]);

    const confirmedToday = useMemo(() => {
        return appointments.filter((appointment) => {
            const showingDateKey = getDateKeyFromIso(appointment.showing_at);
            const confirmationStatus = String(
                appointment.confirmation_status || ""
            ).toLowerCase();
            const appointmentStatus = String(
                appointment.appointment_status || ""
            ).toLowerCase();

            return (
                showingDateKey === topScheduleDateKey &&
                (confirmationStatus === "confirmed" || appointmentStatus === "confirmed")
            );
        });
    }, [topScheduleDateKey, appointments]);

    const availableScheduleGroups = useMemo(() => {
        const activeSchedules = schedules
            .filter(
                (schedule) =>
                    String(schedule.schedule_status || "").toLowerCase() !== "cancelled"
            )
            .sort(
                (a, b) =>
                    new Date(a.showing_at).getTime() - new Date(b.showing_at).getTime()
            );

        const map = new Map<string, ShowingSchedule[]>();

        for (const schedule of activeSchedules) {
            const dateKey = getDateKeyFromIso(schedule.showing_at);

            if (!dateKey) continue;

            const current = map.get(dateKey) || [];
            current.push(schedule);
            map.set(dateKey, current);
        }

        return Array.from(map.entries()).map(([dateKey, daySchedules]) => ({
            dateKey,
            schedules: daySchedules,
        }));
    }, [schedules]);

    function openLandlordConfirmedPage() {
        const token = "Threetopmountain123";

        const url = `/landlord/today?token=${encodeURIComponent(
            token
        )}&date=${encodeURIComponent(topScheduleDateKey)}`;

        window.open(url, "_blank");
    }

    function openCreateScheduleModal(dateKey = topScheduleDateKey) {
        setTopScheduleDateKey(dateKey);
        setScheduleDateKey(dateKey);
        setScheduleTime("18:45");
        setSelectedApartments([]);
        setScheduleNotes("");
        setIsScheduleModalOpen(true);
    }

    function closeCreateScheduleModal() {
        setIsScheduleModalOpen(false);
    }

    function toggleApartment(address: string) {
        setSelectedApartments((current) => {
            if (current.includes(address)) {
                return current.filter((item) => item !== address);
            }

            return [...current, address];
        });
    }

    function selectAllApartments() {
        setSelectedApartments(availableApartments);
    }

    function clearApartmentSelection() {
        setSelectedApartments([]);
    }

    async function createSchedules() {
        if (!selectedApartments.length) {
            setErrorMessage("Select at least one apartment.");
            return;
        }

        const rows = selectedApartments.map((address) => {
            const showingAt = newYorkLocalToUtcIso(scheduleDateKey, scheduleTime);
            const showingLabel = buildShowingLabel(scheduleDateKey, scheduleTime);

            return {
                apt_address: address,
                showing_at: showingAt,
                showing_label: showingLabel,
                schedule_status: "available",
                max_slots: 100,
                notes: scheduleNotes || null,
            };
        });

        const { error } = await supabase
            .from("dashboard_showing_schedules")
            .insert(rows);

        if (error) {
            setErrorMessage(error.message);
            return;
        }

        setTopScheduleDateKey(scheduleDateKey);
        closeCreateScheduleModal();
        await loadBookingData();
    }

    async function deleteSchedule(schedule: ShowingSchedule) {
        const relatedAppointments = appointments.filter(
            (appointment) => appointment.schedule_id === schedule.id
        );

        const message = relatedAppointments.length
            ? `Delete this schedule for ${schedule.apt_address} at ${formatTime(
                schedule.showing_at
            )}? This will also remove ${relatedAppointments.length} booked appointment(s) connected to it.`
            : `Delete this schedule for ${schedule.apt_address} at ${formatTime(
                schedule.showing_at
            )}?`;

        const confirmed = window.confirm(message);

        if (!confirmed) return;

        setErrorMessage("");

        const { error } = await supabase
            .from("dashboard_showing_schedules")
            .delete()
            .eq("id", schedule.id);

        if (error) {
            setErrorMessage(error.message);
            return;
        }

        await loadBookingData();
    }

    function openAddBookingModal(scheduleId?: number) {
        setPhoneSearch("");
        setLeadSearchMessage("");
        setFoundLead(null);
        setSelectedScheduleId(scheduleId ? String(scheduleId) : "");
        setIsBookingModalOpen(true);
    }

    function closeAddBookingModal() {
        setIsBookingModalOpen(false);
    }

    async function searchLeadByPhone() {
        const normalizedSearch = normalizePhone(phoneSearch);

        if (!normalizedSearch) {
            setLeadSearchMessage("Enter a phone number.");
            setFoundLead(null);
            return;
        }

        setLeadSearchMessage("Searching...");
        setFoundLead(null);

        const { data, error } = await supabase.rpc(
            "find_or_sync_booking_lead_by_phone",
            {
                p_phone: phoneSearch,
            }
        );

        if (error) {
            setLeadSearchMessage(error.message);
            return;
        }

        const match = data?.[0] || null;

        if (!match) {
            setLeadSearchMessage(
                `No lead found for ${phoneSearch}. Try searching the 10-digit number only.`
            );
            setFoundLead(null);
            return;
        }

        setFoundLead(match);
        setLeadSearchMessage("");
    }

    async function addBookingToSchedule() {
        if (!foundLead) {
            setLeadSearchMessage("Search and select a lead first.");
            return;
        }

        if (!selectedScheduleId) {
            setLeadSearchMessage("Select a schedule.");
            return;
        }

        const schedule = schedules.find(
            (item) => String(item.id) === String(selectedScheduleId)
        );

        if (!schedule) {
            setLeadSearchMessage("Selected schedule was not found.");
            return;
        }

        const { error: insertError } = await supabase
            .from("dashboard_showing_appointments")
            .insert({
                schedule_id: schedule.id,
                lead_id: foundLead.lead_id,
                lead_name: foundLead.lead_name,
                phone: foundLead.phone,
                apt_address: schedule.apt_address,
                showing_at: schedule.showing_at,
                appointment_status: "booked",
                confirmation_status: "pending_confirmation",
                attendance_status: "pending",
                notes: null,
            });

        if (insertError) {
            setLeadSearchMessage(insertError.message);
            return;
        }

        if (foundLead.lead_id) {
            await supabase
                .from("dashboard_leads")
                .update({
                    pipeline_stage: "showing_scheduled",
                    appointment_status: "booked",
                    confirmation_status: "pending_confirmation",
                    attendance_status: "pending",
                    showing_at: schedule.showing_at,
                    last_pipeline_update_at: new Date().toISOString(),
                })
                .eq("lead_id", foundLead.lead_id);
        }

        setTopScheduleDateKey(getDateKeyFromIso(schedule.showing_at));
        closeAddBookingModal();
        await loadBookingData();
    }

    function openEditAppointmentModal(appointment: ShowingAppointment) {
        setEditingAppointment(appointment);
        setEditAppointmentStatus(appointment.appointment_status || "booked");
        setEditConfirmationStatus(
            appointment.confirmation_status || "pending_confirmation"
        );
        setEditAttendanceStatus(appointment.attendance_status || "pending");
        setEditAppointmentNotes(appointment.notes || "");
    }

    function closeEditAppointmentModal() {
        setEditingAppointment(null);
    }

    async function updateAppointmentField(
        appointment: ShowingAppointment,
        field: "appointment_status" | "confirmation_status" | "attendance_status",
        value: string
    ) {
        const updatePayload: Record<string, string> = {
            [field]: value,
            updated_at: new Date().toISOString(),
        };

        if (field === "confirmation_status" && value === "confirmed") {
            updatePayload.confirmed_at = new Date().toISOString();
        }

        const { error } = await supabase
            .from("dashboard_showing_appointments")
            .update(updatePayload)
            .eq("id", appointment.id);

        if (error) {
            setErrorMessage(error.message);
            return;
        }

        if (appointment.lead_id) {
            const leadUpdate: Record<string, string | null> = {
                last_pipeline_update_at: new Date().toISOString(),
            };

            if (field === "appointment_status") {
                leadUpdate.appointment_status = value;
            }

            if (field === "confirmation_status") {
                leadUpdate.confirmation_status = value;
                if (value === "confirmed") {
                    leadUpdate.pipeline_stage = "confirmed";
                }
            }

            if (field === "attendance_status") {
                leadUpdate.attendance_status = value;

                if (value === "attended") leadUpdate.pipeline_stage = "attended";
                if (value === "no_show") leadUpdate.pipeline_stage = "no_show";
                if (value === "cancelled") leadUpdate.pipeline_stage = "cancelled";
                if (value === "rescheduled") leadUpdate.pipeline_stage = "rescheduled";
            }

            await supabase
                .from("dashboard_leads")
                .update(leadUpdate)
                .eq("lead_id", appointment.lead_id);
        }

        await loadBookingData();
    }

    async function saveEditedAppointment() {
        if (!editingAppointment) return;

        const { error } = await supabase
            .from("dashboard_showing_appointments")
            .update({
                appointment_status: editAppointmentStatus,
                confirmation_status: editConfirmationStatus,
                attendance_status: editAttendanceStatus,
                notes: editAppointmentNotes || null,
                confirmed_at:
                    editConfirmationStatus === "confirmed"
                        ? editingAppointment.confirmed_at || new Date().toISOString()
                        : editingAppointment.confirmed_at,
                updated_at: new Date().toISOString(),
            })
            .eq("id", editingAppointment.id);

        if (error) {
            setErrorMessage(error.message);
            return;
        }

        if (editingAppointment.lead_id) {
            const leadUpdate: Record<string, string | null> = {
                appointment_status: editAppointmentStatus,
                confirmation_status: editConfirmationStatus,
                attendance_status: editAttendanceStatus,
                last_pipeline_update_at: new Date().toISOString(),
            };

            if (editConfirmationStatus === "confirmed") {
                leadUpdate.pipeline_stage = "confirmed";
            }

            if (editAttendanceStatus === "attended") {
                leadUpdate.pipeline_stage = "attended";
            }

            if (editAttendanceStatus === "no_show") {
                leadUpdate.pipeline_stage = "no_show";
            }

            if (editAttendanceStatus === "cancelled") {
                leadUpdate.pipeline_stage = "cancelled";
            }

            if (editAttendanceStatus === "rescheduled") {
                leadUpdate.pipeline_stage = "rescheduled";
            }

            await supabase
                .from("dashboard_leads")
                .update(leadUpdate)
                .eq("lead_id", editingAppointment.lead_id);
        }

        closeEditAppointmentModal();
        await loadBookingData();
    }

    async function deleteAppointment(appointment: ShowingAppointment) {
        const confirmed = window.confirm(
            `Delete booking for ${appointment.lead_name || appointment.phone || "this lead"
            }?`
        );

        if (!confirmed) return;

        const { error } = await supabase
            .from("dashboard_showing_appointments")
            .delete()
            .eq("id", appointment.id);

        if (error) {
            setErrorMessage(error.message);
            return;
        }

        if (appointment.lead_id) {
            await supabase
                .from("dashboard_leads")
                .update({
                    pipeline_stage: "showing_requested",
                    appointment_status: null,
                    confirmation_status: null,
                    attendance_status: null,
                    showing_at: null,
                    last_pipeline_update_at: new Date().toISOString(),
                })
                .eq("lead_id", appointment.lead_id);
        }

        await loadBookingData();
    }

    function AppointmentActionRow({
        appointment,
        compact = false,
    }: {
        appointment: ShowingAppointment;
        compact?: boolean;
    }) {
        return (
            <div
                className={
                    compact ? styles.appointmentActionsCompact : styles.appointmentActions
                }
            >
                <select
                    value={appointment.appointment_status || "booked"}
                    onChange={(event) =>
                        updateAppointmentField(
                            appointment,
                            "appointment_status",
                            event.target.value
                        )
                    }
                >
                    {appointmentStatusOptions.map((status) => (
                        <option key={status} value={status}>
                            {status}
                        </option>
                    ))}
                </select>

                <button
                    className={styles.tinyButton}
                    type="button"
                    onClick={() => openEditAppointmentModal(appointment)}
                >
                    Edit
                </button>

                <button
                    className={styles.tinyDangerButton}
                    type="button"
                    onClick={() => deleteAppointment(appointment)}
                >
                    Delete
                </button>
            </div>
        );
    }

    return (
        <>
            {errorMessage ? (
                <div className={styles.errorText}>{errorMessage}</div>
            ) : null}

            <section className={styles.bookingTopGrid}>
                <div className={styles.bookingPanel}>
                    <div className={styles.bookingPanelHead}>
                        <div>
                            <div className={styles.bookingTitle}>
                                Scheduled - {formatDateKeyShort(topScheduleDateKey)}
                            </div>
                            <div className={styles.bookingSubtitle}>
                                Booked leads for selected schedule date
                            </div>
                        </div>

                        <div className={styles.bookingPanelActions}>
                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={() =>
                                    setTopScheduleDateKey(
                                        addDaysToDateKey(topScheduleDateKey, -1)
                                    )
                                }
                            >
                                Previous
                            </button>

                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={() =>
                                    setTopScheduleDateKey(addDaysToDateKey(topScheduleDateKey, 1))
                                }
                            >
                                Next
                            </button>

                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={() => openAddBookingModal()}
                            >
                                Add Booking
                            </button>

                            <div className={styles.bookingCount}>
                                {loading ? "..." : scheduledAppointments.length}
                            </div>
                        </div>
                    </div>

                    {scheduledAppointments.length ? (
                        <div className={styles.bookingMiniList}>
                            {scheduledAppointments.map((appointment) => (
                                <div
                                    className={`${styles.appointmentCard} ${isAppointmentConfirmed(appointment)
                                            ? styles.appointmentCardConfirmed
                                            : ""
                                        }`}
                                    key={appointment.id}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "minmax(0, 1fr) auto",
                                        alignItems: "start",
                                        columnGap: "10px",
                                        padding: "8px 10px",
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div
                                            className={styles.bookingMiniTitle}
                                            style={{
                                                fontSize: "12px",
                                                lineHeight: "1.15",
                                                fontWeight: 950,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {appointment.lead_name || "Unnamed Lead"}
                                        </div>

                                        <div
                                            className={styles.bookingMiniSub}
                                            style={{
                                                marginTop: "3px",
                                                fontSize: "11px",
                                                lineHeight: "1.2",
                                            }}
                                        >
                                            {appointment.apt_address}
                                        </div>

                                        <div
                                            className={styles.bookingMiniSub}
                                            style={{
                                                fontSize: "11px",
                                                lineHeight: "1.2",
                                            }}
                                        >
                                            {formatDateTime(appointment.showing_at)}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "flex-end",
                                            gap: "4px",
                                            flexWrap: "nowrap",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        <select
                                            value={appointment.appointment_status || "booked"}
                                            onChange={(event) =>
                                                updateAppointmentField(
                                                    appointment,
                                                    "appointment_status",
                                                    event.target.value
                                                )
                                            }
                                            style={{
                                                width: "84px",
                                                height: "24px",
                                                fontSize: "10px",
                                                padding: "1px 5px",
                                                borderRadius: "7px",
                                            }}
                                        >
                                            {appointmentStatusOptions.map((status) => (
                                                <option key={status} value={status}>
                                                    {status}
                                                </option>
                                            ))}
                                        </select>

                                        <button
                                            className={styles.tinyButton}
                                            type="button"
                                            onClick={() =>
                                                openEditAppointmentModal(appointment)
                                            }
                                            style={{
                                                height: "24px",
                                                minHeight: "24px",
                                                fontSize: "10px",
                                                padding: "0 7px",
                                                borderRadius: "7px",
                                            }}
                                        >
                                            Edit
                                        </button>

                                        <button
                                            className={styles.tinyDangerButton}
                                            type="button"
                                            onClick={() => deleteAppointment(appointment)}
                                            style={{
                                                height: "24px",
                                                minHeight: "24px",
                                                fontSize: "10px",
                                                padding: "0 7px",
                                                borderRadius: "7px",
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.bookingEmpty}>
                            No booked leads for {formatDateKeyShort(topScheduleDateKey)}.
                        </div>
                    )}
                </div>

                <div className={styles.bookingPanel}>
                    <div className={styles.bookingPanelHead}>
                        <div>
                            <div className={styles.bookingTitle}>Confirmed Today</div>
                            <div className={styles.bookingSubtitle}>
                                Attendance, call, and SMS
                            </div>
                        </div>

                        <div className={styles.bookingPanelActions}>
                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={openLandlordConfirmedPage}
                            >
                                Landlord View
                            </button>

                            <div className={styles.bookingCount}>
                                {loading ? "..." : confirmedToday.length}
                            </div>
                        </div>
                    </div>

                    {confirmedToday.length ? (
                        <div className={styles.bookingMiniList}>
                            {confirmedToday.map((appointment) => (
                                <div
                                    className={`${styles.appointmentCard} ${isAppointmentConfirmed(appointment)
                                            ? styles.appointmentCardConfirmed
                                            : ""
                                        }`}
                                    key={appointment.id}
                                >
                                    <div className={styles.appointmentCardTop}>
                                        <div>
                                            <div className={styles.bookingMiniTitle}>
                                                {appointment.lead_name || "Unnamed Lead"}
                                            </div>
                                            <div className={styles.bookingMiniSub}>
                                                {appointment.phone}
                                            </div>
                                            <div className={styles.bookingMiniSub}>
                                                {appointment.apt_address} ·{" "}
                                                {formatTime(appointment.showing_at)}
                                            </div>
                                        </div>

                                        <div className={styles.bookingMiniMeta}>
                                            <strong>{appointment.confirmation_status}</strong>
                                        </div>
                                    </div>

                                    <div className={styles.confirmedActions}>
                                        <select
                                            value={appointment.attendance_status || "pending"}
                                            onChange={(event) =>
                                                updateAppointmentField(
                                                    appointment,
                                                    "attendance_status",
                                                    event.target.value
                                                )
                                            }
                                        >
                                            {attendanceStatusOptions.map((status) => (
                                                <option key={status} value={status}>
                                                    {status}
                                                </option>
                                            ))}
                                        </select>

                                        <a
                                            className={styles.tinyButtonLink}
                                            href={getPhoneHref(appointment.phone, "call")}
                                        >
                                            Call
                                        </a>

                                        <a
                                            className={styles.tinyButtonLink}
                                            href={getPhoneHref(appointment.phone, "sms")}
                                        >
                                            SMS
                                        </a>

                                        <button
                                            className={styles.tinyButton}
                                            type="button"
                                            onClick={() => openEditAppointmentModal(appointment)}
                                        >
                                            Edit
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.bookingEmpty}>No confirmed leads today.</div>
                    )}
                </div>

                <div className={styles.bookingPanel}>
                    <div className={styles.bookingPanelHead}>
                        <div>
                            <div className={styles.bookingTitle}>Today's Schedule</div>
                            <div className={styles.bookingSubtitle}>
                                {formatDateKeyShort(topScheduleDateKey)} schedule slots
                            </div>
                        </div>

                        <div className={styles.bookingPanelActions}>
                            <button
                                className={styles.primarySmallButton}
                                type="button"
                                onClick={() => openCreateScheduleModal(topScheduleDateKey)}
                            >
                                Create Schedule
                            </button>

                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={() => setIsTemplatesModalOpen(true)}
                            >
                                Templates
                            </button>

                            <div className={styles.bookingCount}>
                                {loading ? "..." : todaySchedules.length}
                            </div>
                        </div>
                    </div>

                    {todaySchedules.length ? (
                        <div className={styles.bookingMiniList}>
                            {todaySchedules.map((schedule) => (
                                <div
                                    className={styles.bookingMiniRowWithAction}
                                    key={schedule.id}
                                >
                                    <div>
                                        <div className={styles.bookingMiniTitle}>
                                            {schedule.apt_address}
                                        </div>
                                        <div className={styles.bookingMiniSub}>
                                            {schedule.showing_label || "Showing"}
                                        </div>
                                    </div>

                                    <div className={styles.scheduleActions}>
                                        <div className={styles.bookingMiniMeta}>
                                            {formatTime(schedule.showing_at)}
                                        </div>

                                        <button
                                            className={styles.deleteScheduleButton}
                                            type="button"
                                            onClick={() => deleteSchedule(schedule)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.bookingEmpty}>No schedule slots today.</div>
                    )}
                </div>
            </section>

            <section className={styles.bookingCalendarCard}>
                <div className={styles.sectionHeader}>
                    <div>
                        <div className={styles.sectionTitle}>Booking Calendar</div>
                        <div className={styles.sectionSubtitle}>{calendar.monthLabel}</div>
                    </div>

                    <div className={styles.sectionActions}>
                        <button className={styles.smallNavButton} type="button">
                            Previous Month
                        </button>
                        <button className={styles.smallNavButton} type="button">
                            This Month
                        </button>
                        <button className={styles.primarySmallButton} type="button">
                            Next Month
                        </button>
                    </div>
                </div>

                <div className={styles.bookingCalendarGrid}>
                    {monthWeekDays.map((day) => (
                        <div className={styles.monthWeekday} key={day}>
                            {day}
                        </div>
                    ))}

                    {calendar.cells.map((cell, index) => {
                        if (cell.type === "blank") {
                            return (
                                <div
                                    className={`${styles.bookingCalDay} ${styles.bookingEmptyCell}`}
                                    key={`blank-${index}`}
                                />
                            );
                        }

                        const daySchedules = schedulesByDay.get(cell.dateKey || "") || [];
                        const dayAppointments =
                            appointmentsByDay.get(cell.dateKey || "") || [];

                        return (
                            <div
                                className={`${styles.bookingCalDay} ${cell.dateKey === topScheduleDateKey
                                        ? styles.bookingToday
                                        : ""
                                    }`}
                                key={cell.dateKey}
                                onClick={() => {
                                    if (cell.dateKey) {
                                        setTopScheduleDateKey(cell.dateKey);
                                    }
                                }}
                            >
                                <div className={styles.bookingDayHead}>
                                    <span>{cell.dayNumber}</span>
                                    <strong>{daySchedules.length}</strong>
                                </div>

                                <div className={styles.miniButtonRow}>
                                    <button
                                        className={styles.miniDayButtonSet}
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            openCreateScheduleModal(cell.dateKey);
                                        }}
                                    >
                                        Set
                                    </button>

                                    <button
                                        className={styles.miniDayButtonAdd}
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();

                                            if (cell.dateKey) {
                                                setTopScheduleDateKey(cell.dateKey);
                                            }

                                            openAddBookingModal(daySchedules[0]?.id);
                                        }}
                                    >
                                        Add
                                    </button>
                                </div>

                                <div className={styles.scheduleListScroll}>
                                    {daySchedules.length ? (
                                        daySchedules.map((schedule) => (
                                            <div
                                                className={styles.scheduleCompactWrap}
                                                key={schedule.id}
                                            >
                                                <button
                                                    className={styles.scheduleCompactRow}
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setTopScheduleDateKey(
                                                            getDateKeyFromIso(schedule.showing_at)
                                                        );
                                                        openAddBookingModal(schedule.id);
                                                    }}
                                                >
                                                    <span>{schedule.apt_address}</span>
                                                    <strong>{formatTime(schedule.showing_at)}</strong>
                                                </button>

                                                <button
                                                    className={styles.scheduleCompactDelete}
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        deleteSchedule(schedule);
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className={styles.bookingNoShowings}>
                                            No schedules yet
                                        </div>
                                    )}
                                </div>

                                <div className={styles.leadLogBox}>
                                    <div className={styles.leadLogTitle}>Lead Log</div>
                                    <div className={styles.leadLogScroll}>
                                        {dayAppointments.length ? (
                                            dayAppointments.map((appointment) => (
                                                <div
                                                    className={`${styles.calendarLeadCard} ${isAppointmentConfirmed(appointment)
                                                            ? styles.appointmentCardConfirmed
                                                            : ""
                                                        }`}
                                                    key={appointment.id}
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <div className={styles.leadLogRow}>
                                                        <span>
                                                            {appointment.lead_name ||
                                                                appointment.phone ||
                                                                "Unnamed Lead"}
                                                        </span>
                                                        <strong>
                                                            {appointment.appointment_status}
                                                        </strong>
                                                    </div>

                                                    <AppointmentActionRow
                                                        appointment={appointment}
                                                        compact
                                                    />

                                                    <div className={styles.calendarContactActions}>
                                                        <a
                                                            href={getPhoneHref(
                                                                appointment.phone,
                                                                "call"
                                                            )}
                                                            className={styles.tinyButtonLink}
                                                        >
                                                            Call
                                                        </a>
                                                        <a
                                                            href={getPhoneHref(
                                                                appointment.phone,
                                                                "sms"
                                                            )}
                                                            className={styles.tinyButtonLink}
                                                        >
                                                            SMS
                                                        </a>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className={styles.dayLeadEmpty}>
                                                No booked leads
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <ScheduleTemplatesModal
                isOpen={isTemplatesModalOpen}
                onClose={() => setIsTemplatesModalOpen(false)}
                availableApartments={availableApartments}
                currentDateKey={topScheduleDateKey}
                currentDaySchedules={todaySchedules}
                onApplied={async (appliedDateKey) => {
                    if (appliedDateKey) {
                        setTopScheduleDateKey(appliedDateKey);
                    }

                    await loadBookingData();
                }}
            />

            {isScheduleModalOpen ? (
                <div className={styles.modalBackdrop}>
                    <div className={styles.modal}>
                        <div className={styles.modalHead}>
                            <div>
                                <div className={styles.bookingTitle}>Create Schedule</div>
                                <div className={styles.bookingSubtitle}>
                                    Select apartments and showing time
                                </div>
                            </div>

                            <button
                                className={styles.modalClose}
                                type="button"
                                onClick={closeCreateScheduleModal}
                            >
                                ×
                            </button>
                        </div>

                        <label className={styles.formLabel}>
                            Schedule Date
                            <input
                                type="date"
                                value={scheduleDateKey}
                                onChange={(event) => setScheduleDateKey(event.target.value)}
                            />
                        </label>

                        <div className={styles.formLabel}>
                            Common Times
                            <div className={styles.commonTimeGrid}>
                                {commonTimes.map((time) => (
                                    <button
                                        key={time.value}
                                        type="button"
                                        className={`${styles.commonTimeButton} ${scheduleTime === time.value
                                                ? styles.commonTimeButtonActive
                                                : ""
                                            }`}
                                        onClick={() => setScheduleTime(time.value)}
                                    >
                                        {time.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <label className={styles.formLabel}>
                            Editable Time
                            <input
                                type="time"
                                value={scheduleTime}
                                onChange={(event) => setScheduleTime(event.target.value)}
                            />
                        </label>

                        <div className={styles.modalUtilityRow}>
                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={selectAllApartments}
                            >
                                Select All
                            </button>

                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={clearApartmentSelection}
                            >
                                Clear
                            </button>
                        </div>

                        <div className={styles.modalSectionTitle}>
                            Available Apartments From Home Filter
                        </div>

                        <div className={styles.modalAptList}>
                            {availableApartments.length ? (
                                availableApartments.map((address) => (
                                    <label className={styles.modalAptCheck} key={address}>
                                        <input
                                            type="checkbox"
                                            checked={selectedApartments.includes(address)}
                                            onChange={() => toggleApartment(address)}
                                        />
                                        <span>{address}</span>
                                    </label>
                                ))
                            ) : (
                                <div className={styles.bookingEmpty}>
                                    No available apartments selected.
                                </div>
                            )}
                        </div>

                        <label className={styles.formLabel}>
                            Notes
                            <textarea
                                value={scheduleNotes}
                                onChange={(event) => setScheduleNotes(event.target.value)}
                                placeholder="Optional notes"
                            />
                        </label>

                        <div className={styles.modalActions}>
                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={closeCreateScheduleModal}
                            >
                                Cancel
                            </button>

                            <button
                                className={styles.primarySmallButton}
                                type="button"
                                onClick={createSchedules}
                            >
                                Save Schedule
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {isBookingModalOpen ? (
                <div className={styles.modalBackdrop}>
                    <div className={styles.modal}>
                        <div className={styles.modalHead}>
                            <div>
                                <div className={styles.bookingTitle}>Add Booking</div>
                                <div className={styles.bookingSubtitle}>
                                    Search lead by phone and assign to schedule
                                </div>
                            </div>

                            <button
                                className={styles.modalClose}
                                type="button"
                                onClick={closeAddBookingModal}
                            >
                                ×
                            </button>
                        </div>

                        <div className={styles.searchRow}>
                            <input
                                value={phoneSearch}
                                onChange={(event) => setPhoneSearch(event.target.value)}
                                placeholder="Search phone, any format"
                            />

                            <button
                                className={styles.primarySmallButton}
                                type="button"
                                onClick={searchLeadByPhone}
                            >
                                Search
                            </button>
                        </div>

                        {leadSearchMessage ? (
                            <div className={styles.bookingEmpty}>{leadSearchMessage}</div>
                        ) : null}

                        {foundLead ? (
                            <div className={styles.foundLeadCard}>
                                <div className={styles.bookingMiniTitle}>
                                    {foundLead.lead_name || "Unnamed Lead"}
                                </div>
                                <div className={styles.bookingMiniSub}>{foundLead.phone}</div>
                                <div className={styles.bookingMiniSub}>
                                    {foundLead.apt_address}
                                </div>
                            </div>
                        ) : null}

                        <div className={styles.availableSchedulesBox}>
                            <div className={styles.modalSectionTitle}>
                                Available Schedules
                            </div>

                            {availableScheduleGroups.length ? (
                                <div className={styles.availableScheduleList}>
                                    {availableScheduleGroups.map((group) => {
                                        const selectedScheduleInThisGroup =
                                            group.schedules.some(
                                                (schedule) =>
                                                    String(schedule.id) ===
                                                    String(selectedScheduleId)
                                            );

                                        return (
                                            <label
                                                className={styles.scheduleDateDropdownRow}
                                                key={group.dateKey}
                                            >
                                                <span>{formatDateKeyShort(group.dateKey)}</span>

                                                <select
                                                    value={
                                                        selectedScheduleInThisGroup
                                                            ? selectedScheduleId
                                                            : ""
                                                    }
                                                    onChange={(event) => {
                                                        if (event.target.value) {
                                                            setSelectedScheduleId(
                                                                event.target.value
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <option value="">
                                                        Select schedule for this date
                                                    </option>

                                                    {group.schedules.map((schedule) => (
                                                        <option
                                                            key={schedule.id}
                                                            value={schedule.id}
                                                        >
                                                            {schedule.apt_address} ·{" "}
                                                            {formatTime(schedule.showing_at)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className={styles.bookingEmpty}>
                                    No available schedules. Create a schedule first.
                                </div>
                            )}
                        </div>

                        <div className={styles.modalActions}>
                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={closeAddBookingModal}
                            >
                                Cancel
                            </button>

                            <button
                                className={styles.primarySmallButton}
                                type="button"
                                onClick={addBookingToSchedule}
                            >
                                Book Selected Schedule
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {editingAppointment ? (
                <div className={styles.modalBackdrop}>
                    <div className={styles.modal}>
                        <div className={styles.modalHead}>
                            <div>
                                <div className={styles.bookingTitle}>Edit Booking</div>
                                <div className={styles.bookingSubtitle}>
                                    {editingAppointment.lead_name || "Unnamed Lead"} ·{" "}
                                    {formatDateTime(editingAppointment.showing_at)}
                                </div>
                            </div>

                            <button
                                className={styles.modalClose}
                                type="button"
                                onClick={closeEditAppointmentModal}
                            >
                                ×
                            </button>
                        </div>

                        <div className={styles.editBookingInfo}>
                            <div>
                                <strong>Lead</strong>
                                <span>{editingAppointment.lead_name || "Unnamed Lead"}</span>
                            </div>
                            <div>
                                <strong>Phone</strong>
                                <span>{editingAppointment.phone || "No phone"}</span>
                            </div>
                            <div>
                                <strong>Apartment</strong>
                                <span>{editingAppointment.apt_address || "No apartment"}</span>
                            </div>
                        </div>

                        <label className={styles.formLabel}>
                            Appointment Status
                            <select
                                value={editAppointmentStatus}
                                onChange={(event) => setEditAppointmentStatus(event.target.value)}
                            >
                                {appointmentStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {status}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className={styles.formLabel}>
                            Confirmation Status
                            <select
                                value={editConfirmationStatus}
                                onChange={(event) =>
                                    setEditConfirmationStatus(event.target.value)
                                }
                            >
                                {confirmationStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {status}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className={styles.formLabel}>
                            Attendance Status
                            <select
                                value={editAttendanceStatus}
                                onChange={(event) => setEditAttendanceStatus(event.target.value)}
                            >
                                {attendanceStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {status}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className={styles.formLabel}>
                            Notes
                            <textarea
                                value={editAppointmentNotes}
                                onChange={(event) => setEditAppointmentNotes(event.target.value)}
                                placeholder="Optional booking notes"
                            />
                        </label>

                        <div className={styles.modalActions}>
                            <a
                                className={styles.smallNavButton}
                                href={getPhoneHref(editingAppointment.phone, "call")}
                            >
                                Call
                            </a>

                            <a
                                className={styles.smallNavButton}
                                href={getPhoneHref(editingAppointment.phone, "sms")}
                            >
                                SMS
                            </a>

                            <button
                                className={styles.smallNavButton}
                                type="button"
                                onClick={closeEditAppointmentModal}
                            >
                                Cancel
                            </button>

                            <button
                                className={styles.primarySmallButton}
                                type="button"
                                onClick={saveEditedAppointment}
                            >
                                Save Booking
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
}