"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import styles from "./ScheduleTemplatesModal.module.css";

type ShowingSchedule = {
    id: number;
    apt_address: string;
    showing_at: string;
    showing_label: string | null;
    schedule_status: string;
    max_slots: number;
    notes: string | null;
};

type ScheduleTemplate = {
    id: number;
    template_name: string;
    template_date: string | null;
    notes: string | null;
    is_active: boolean | null;
};

type ScheduleTemplateItem = {
    id?: number;
    template_id?: number;
    apt_address: string;
    time_value: string;
    sort_order: number;
};

type ScheduleTemplatesModalProps = {
    isOpen: boolean;
    onClose: () => void;
    availableApartments: string[];
    currentDateKey: string;
    currentDaySchedules: ShowingSchedule[];
    onApplied: (appliedDateKey?: string) => Promise<void>;
};

const APP_TIME_ZONE = "America/New_York";

const defaultCommonTimes = [
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

function timeLabelFromValue(value: string) {
    if (!value) return "";

    const [hourRaw, minuteRaw] = value.split(":");
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);

    if (Number.isNaN(hour) || Number.isNaN(minute)) return value;

    const date = new Date(Date.UTC(2026, 0, 1, hour, minute, 0));

    return date.toLocaleTimeString("en-US", {
        timeZone: "UTC",
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatDateKeyShort(dateKey: string) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
    });
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

function timeValueFromIso(value: string | null) {
    if (!value) return "18:45";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "18:45";

    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: APP_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);

    const get = (type: string) => parts.find((part) => part.type === type)?.value;

    return `${get("hour")}:${get("minute")}`;
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

    const time = formatTime(iso);

    return `${weekday} ${time}`;
}

function dedupeAddresses(addresses: string[]) {
    return Array.from(new Set(addresses.filter(Boolean)));
}

function dedupeTimes(times: Array<{ label: string; value: string }>) {
    const seen = new Set<string>();
    const result: Array<{ label: string; value: string }> = [];

    for (const time of times) {
        if (!time.value || seen.has(time.value)) continue;

        seen.add(time.value);
        result.push(time);
    }

    return result.sort((a, b) => a.value.localeCompare(b.value));
}

export default function ScheduleTemplatesModal({
    isOpen,
    onClose,
    availableApartments,
    currentDateKey,
    currentDaySchedules,
    onApplied,
}: ScheduleTemplatesModalProps) {
    const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
        null
    );

    const [templateName, setTemplateName] = useState("");
    const [applyDate, setApplyDate] = useState(currentDateKey);
    const [items, setItems] = useState<ScheduleTemplateItem[]>([]);
    const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
    const [newAddress, setNewAddress] = useState("");
    const [customTime, setCustomTime] = useState("18:45");
    const [extraTimes, setExtraTimes] = useState<
        Array<{ label: string; value: string }>
    >([]);

    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    const commonTimes = useMemo(() => {
        const itemTimes = items.map((item) => ({
            label: timeLabelFromValue(item.time_value),
            value: item.time_value,
        }));

        return dedupeTimes([...defaultCommonTimes, ...extraTimes, ...itemTimes]);
    }, [extraTimes, items]);

    const addressOptions = useMemo(() => {
        const itemAddresses = items.map((item) => item.apt_address);
        const scheduleAddresses = currentDaySchedules.map(
            (schedule) => schedule.apt_address
        );

        return dedupeAddresses([
            ...availableApartments,
            ...itemAddresses,
            ...scheduleAddresses,
        ]);
    }, [availableApartments, currentDaySchedules, items]);

    const selectedItem =
        selectedRowIndex !== null ? items[selectedRowIndex] || null : null;

    const selectedTimeIsCommon = selectedItem
        ? commonTimes.some((time) => time.value === selectedItem.time_value)
        : false;

    async function loadTemplates() {
        setLoading(true);
        setMessage("");

        const { data, error } = await supabase
            .from("dashboard_schedule_templates")
            .select("id, template_name, template_date, notes, is_active")
            .order("created_at", { ascending: false });

        if (error) {
            setMessage(error.message);
            setTemplates([]);
            setLoading(false);
            return;
        }

        const activeTemplates = (data || []).filter(
            (template) => template.is_active !== false
        );

        setTemplates(activeTemplates);
        setLoading(false);
    }

    async function loadTemplate(templateId: number) {
        setLoading(true);
        setMessage("");

        const template = templates.find((item) => item.id === templateId);

        if (!template) {
            setMessage("Template not found.");
            setLoading(false);
            return;
        }

        const { data, error } = await supabase
            .from("dashboard_schedule_template_items")
            .select("id, template_id, apt_address, time_value, sort_order")
            .eq("template_id", templateId)
            .order("sort_order", { ascending: true });

        if (error) {
            setMessage(error.message);
            setLoading(false);
            return;
        }

        const loadedItems = data || [];

        setSelectedTemplateId(template.id);
        setTemplateName(template.template_name);
        setItems(loadedItems);
        setSelectedRowIndex(loadedItems.length ? 0 : null);
        setCustomTime(loadedItems[0]?.time_value || "18:45");
        setNewAddress(addressOptions[0] || "");
        setMessage("");
        setLoading(false);
    }

    function startNewTemplate() {
        setSelectedTemplateId(null);
        setTemplateName("");
        setItems([]);
        setSelectedRowIndex(null);
        setNewAddress(addressOptions[0] || "");
        setCustomTime("18:45");
        setMessage("");
    }

    function buildTemplateFromCurrentDay() {
        const rows = currentDaySchedules.map((schedule, index) => ({
            apt_address: schedule.apt_address,
            time_value: timeValueFromIso(schedule.showing_at),
            sort_order: index,
        }));

        setSelectedTemplateId(null);
        setTemplateName(`${formatDateKeyShort(currentDateKey)} Schedule`);
        setApplyDate(currentDateKey);
        setItems(rows);
        setSelectedRowIndex(rows.length ? 0 : null);
        setCustomTime(rows[0]?.time_value || "18:45");
        setNewAddress(addressOptions[0] || "");
        setMessage("");
    }

    function addAddressRow() {
        const address = newAddress || addressOptions[0] || "";

        if (!address) {
            setMessage("Select an apartment first.");
            return;
        }

        const nextItem = {
            apt_address: address,
            time_value: customTime || "18:45",
            sort_order: items.length,
        };

        setItems((current) => [...current, nextItem]);
        setSelectedRowIndex(items.length);
        setCustomTime(nextItem.time_value);
        setMessage("");
    }

    function removeSelectedRow() {
        if (selectedRowIndex === null) {
            setMessage("Select a row first.");
            return;
        }

        const nextItems = items
            .filter((_, index) => index !== selectedRowIndex)
            .map((item, index) => ({
                ...item,
                sort_order: index,
            }));

        const nextSelectedIndex = nextItems.length
            ? Math.min(selectedRowIndex, nextItems.length - 1)
            : null;

        setItems(nextItems);
        setSelectedRowIndex(nextSelectedIndex);
        setCustomTime(
            nextSelectedIndex !== null ? nextItems[nextSelectedIndex].time_value : "18:45"
        );
    }

    function updateSelectedAddress(address: string) {
        if (selectedRowIndex === null) {
            setMessage("Select an apartment row first.");
            return;
        }

        setItems((current) =>
            current.map((item, index) => {
                if (index !== selectedRowIndex) return item;

                return {
                    ...item,
                    apt_address: address,
                };
            })
        );
    }

    function updateSelectedTime(timeValue: string) {
        if (selectedRowIndex === null) {
            setMessage("Select an apartment row first.");
            return;
        }

        setCustomTime(timeValue);

        setItems((current) =>
            current.map((item, index) => {
                if (index !== selectedRowIndex) return item;

                return {
                    ...item,
                    time_value: timeValue,
                };
            })
        );

        setMessage("");
    }

    function addNewTimeButton() {
        if (!customTime) {
            setMessage("Choose a custom time first.");
            return;
        }

        setExtraTimes((current) =>
            dedupeTimes([
                ...current,
                {
                    label: timeLabelFromValue(customTime),
                    value: customTime,
                },
            ])
        );

        updateSelectedTime(customTime);
        setMessage(`Added ${timeLabelFromValue(customTime)} as a time button.`);
    }

    async function saveTemplate() {
        setMessage("");

        if (!templateName.trim()) {
            setMessage("Template name is required.");
            return;
        }

        const cleanedItems = items
            .filter((item) => item.apt_address && item.time_value)
            .map((item, index) => ({
                apt_address: item.apt_address,
                time_value: item.time_value,
                sort_order: index,
            }));

        if (!cleanedItems.length) {
            setMessage("Add at least one apartment/time row.");
            return;
        }

        setLoading(true);

        let templateId = selectedTemplateId;

        if (templateId) {
            const { error } = await supabase
                .from("dashboard_schedule_templates")
                .update({
                    template_name: templateName.trim(),
                    updated_at: new Date().toISOString(),
                    is_active: true,
                })
                .eq("id", templateId);

            if (error) {
                setMessage(error.message);
                setLoading(false);
                return;
            }

            const { error: deleteItemsError } = await supabase
                .from("dashboard_schedule_template_items")
                .delete()
                .eq("template_id", templateId);

            if (deleteItemsError) {
                setMessage(deleteItemsError.message);
                setLoading(false);
                return;
            }
        } else {
            const { data, error } = await supabase
                .from("dashboard_schedule_templates")
                .insert({
                    template_name: templateName.trim(),
                    template_date: null,
                    notes: null,
                    is_active: true,
                })
                .select("id")
                .single();

            if (error) {
                setMessage(error.message);
                setLoading(false);
                return;
            }

            templateId = data.id;
            setSelectedTemplateId(templateId);
        }

        const itemRows = cleanedItems.map((item) => ({
            template_id: templateId,
            apt_address: item.apt_address,
            time_value: item.time_value,
            sort_order: item.sort_order,
        }));

        const { error: itemError } = await supabase
            .from("dashboard_schedule_template_items")
            .insert(itemRows);

        if (itemError) {
            setMessage(itemError.message);
            setLoading(false);
            return;
        }

        await loadTemplates();

        if (templateId) {
            setSelectedTemplateId(templateId);
        }

        setMessage("Template saved.");
        setLoading(false);
    }

    async function deleteTemplate() {
        if (!selectedTemplateId) {
            setMessage("Select a template first.");
            return;
        }

        setLoading(true);
        setMessage("");

        const { error } = await supabase
            .from("dashboard_schedule_templates")
            .update({
                is_active: false,
                updated_at: new Date().toISOString(),
            })
            .eq("id", selectedTemplateId);

        if (error) {
            setMessage(error.message);
            setLoading(false);
            return;
        }

        startNewTemplate();
        await loadTemplates();
        setMessage("Template deleted.");
        setLoading(false);
    }

    async function applyTemplateToDate() {
        setMessage("");

        if (!items.length) {
            setMessage("No template rows to apply.");
            return;
        }

        if (!applyDate) {
            setMessage("Select an apply date.");
            return;
        }

        const rows = items
            .filter((item) => item.apt_address && item.time_value)
            .map((item) => {
                const showingAt = newYorkLocalToUtcIso(applyDate, item.time_value);
                const showingLabel = buildShowingLabel(applyDate, item.time_value);

                return {
                    apt_address: item.apt_address,
                    showing_at: showingAt,
                    showing_label: showingLabel,
                    schedule_status: "available",
                    max_slots: 100,
                    notes: null,
                };
            });

        if (!rows.length) {
            setMessage("Template rows need address and time.");
            return;
        }

        setLoading(true);

        const { error } = await supabase
            .from("dashboard_showing_schedules")
            .insert(rows);

        if (error) {
            setMessage(error.message);
            setLoading(false);
            return;
        }

        await onApplied(applyDate);
        setMessage(`Template applied to ${formatDateKeyShort(applyDate)}.`);
        setLoading(false);
    }

    useEffect(() => {
        if (!isOpen) return;

        setApplyDate(currentDateKey);
        setNewAddress(addressOptions[0] || "");
        loadTemplates();
    }, [isOpen, currentDateKey]);

    useEffect(() => {
        if (!selectedItem) return;

        setCustomTime(selectedItem.time_value);
    }, [selectedItem?.time_value]);

    if (!isOpen) return null;

    return (
        <div className={styles.modalBackdrop}>
            <div className={styles.modal}>
                <div className={styles.modalHead}>
                    <div>
                        <div className={styles.title}>Schedule Templates</div>
                        <div className={styles.subtitle}>
                            Select a saved template, edit apartment/time rows, then load it to
                            a date.
                        </div>
                    </div>

                    <button className={styles.closeButton} type="button" onClick={onClose}>
                        ×
                    </button>
                </div>

                {message ? <div className={styles.message}>{message}</div> : null}

                <div className={styles.grid}>
                    <aside className={styles.sidebar}>
                        <button
                            className={styles.primaryButton}
                            type="button"
                            onClick={startNewTemplate}
                        >
                            New Template
                        </button>

                        <button
                            className={styles.secondaryButton}
                            type="button"
                            onClick={buildTemplateFromCurrentDay}
                        >
                            Save Current Day As Template
                        </button>

                        <div className={styles.sideTitle}>Saved Templates</div>

                        <div className={styles.templateList}>
                            {loading ? (
                                <div className={styles.empty}>Loading...</div>
                            ) : templates.length ? (
                                templates.map((template) => (
                                    <button
                                        key={template.id}
                                        type="button"
                                        className={`${styles.templateButton} ${selectedTemplateId === template.id
                                                ? styles.templateButtonActive
                                                : ""
                                            }`}
                                        onClick={() => loadTemplate(template.id)}
                                    >
                                        <strong>{template.template_name}</strong>
                                        <span>{template.is_active === false ? "Inactive" : "Active"}</span>
                                    </button>
                                ))
                            ) : (
                                <div className={styles.empty}>No templates yet.</div>
                            )}
                        </div>
                    </aside>

                    <section className={styles.editor}>
                        <label className={styles.formLabel}>
                            Template Name
                            <input
                                value={templateName}
                                onChange={(event) => setTemplateName(event.target.value)}
                                placeholder="Example: Weekday 5:30 PM Open Houses"
                            />
                        </label>

                        <label className={styles.formLabel}>
                            Load Template To Date
                            <input
                                type="date"
                                value={applyDate}
                                onChange={(event) => setApplyDate(event.target.value)}
                            />
                        </label>

                        <div className={styles.rowHeader}>
                            <div>
                                <div className={styles.sideTitle}>Apartment Rows</div>
                                <div className={styles.helperText}>
                                    Click an apartment row. The active time button changes based on
                                    that apartment.
                                </div>
                            </div>
                        </div>

                        <div className={styles.addRowPanel}>
                            <select
                                value={newAddress}
                                onChange={(event) => setNewAddress(event.target.value)}
                            >
                                <option value="">Select apartment</option>
                                {addressOptions.map((address) => (
                                    <option key={address} value={address}>
                                        {address}
                                    </option>
                                ))}
                            </select>

                            <button
                                className={styles.secondaryButton}
                                type="button"
                                onClick={addAddressRow}
                            >
                                Add Apartment
                            </button>
                        </div>

                        <div className={styles.rows}>
                            {items.length ? (
                                items.map((item, index) => (
                                    <button
                                        type="button"
                                        className={`${styles.itemRowButton} ${selectedRowIndex === index ? styles.itemRowButtonActive : ""
                                            }`}
                                        key={`${index}-${item.apt_address}-${item.time_value}`}
                                        onClick={() => {
                                            setSelectedRowIndex(index);
                                            setCustomTime(item.time_value);
                                        }}
                                    >
                                        <span>{item.apt_address}</span>
                                        <strong>{timeLabelFromValue(item.time_value)}</strong>
                                    </button>
                                ))
                            ) : (
                                <div className={styles.empty}>
                                    No apartment rows yet. Click “Add Apartment” or “Save Current
                                    Day As Template”.
                                </div>
                            )}
                        </div>

                        {selectedItem ? (
                            <div className={styles.selectedEditor}>
                                <div className={styles.sideTitle}>Selected Apartment</div>

                                <select
                                    value={selectedItem.apt_address}
                                    onChange={(event) => updateSelectedAddress(event.target.value)}
                                >
                                    {addressOptions.map((address) => (
                                        <option key={address} value={address}>
                                            {address}
                                        </option>
                                    ))}
                                </select>

                                <div className={styles.sideTitle}>Assigned Time</div>

                                <div className={styles.timeGrid}>
                                    {commonTimes.map((time) => (
                                        <button
                                            key={time.value}
                                            className={`${styles.timeButton} ${selectedItem.time_value === time.value
                                                    ? styles.timeButtonActive
                                                    : ""
                                                }`}
                                            type="button"
                                            onClick={() => updateSelectedTime(time.value)}
                                        >
                                            {time.label}
                                        </button>
                                    ))}
                                </div>

                                {!selectedTimeIsCommon ? (
                                    <div className={styles.customTimeNotice}>
                                        Current time is custom:{" "}
                                        <strong>{timeLabelFromValue(selectedItem.time_value)}</strong>
                                    </div>
                                ) : null}

                                <div className={styles.customTimeRow}>
                                    <label className={styles.formLabel}>
                                        Custom / Edit Time
                                        <input
                                            type="time"
                                            value={customTime}
                                            onChange={(event) => {
                                                setCustomTime(event.target.value);
                                                updateSelectedTime(event.target.value);
                                            }}
                                        />
                                    </label>

                                    <button
                                        className={styles.secondaryButton}
                                        type="button"
                                        onClick={addNewTimeButton}
                                    >
                                        Add New Time
                                    </button>

                                    <button
                                        className={styles.dangerButton}
                                        type="button"
                                        onClick={removeSelectedRow}
                                    >
                                        Remove Row
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        <div className={styles.actions}>
                            <button
                                className={styles.secondaryButton}
                                type="button"
                                onClick={onClose}
                            >
                                Close
                            </button>

                            <button
                                className={styles.dangerButton}
                                type="button"
                                onClick={deleteTemplate}
                                disabled={!selectedTemplateId}
                            >
                                Delete
                            </button>

                            <button
                                className={styles.primaryButton}
                                type="button"
                                onClick={saveTemplate}
                            >
                                Save / Update Template
                            </button>

                            <button
                                className={styles.primaryButton}
                                type="button"
                                onClick={applyTemplateToDate}
                            >
                                Load Template To Date
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}