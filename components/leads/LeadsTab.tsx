"use client";

import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import styles from "./LeadsTab.module.css";

export type PipelineLead = {
    lead_id: string | null;
    created_at: string | null;
    created_at_ts: string | null;
    lead_name: string | null;
    phone: string | null;
    apt_address: string | null;
    current_status: string | null;
    conversation_stage: string | null;
    needs_human_review_bool: boolean | null;
    notes: string | null;
    last_outbound_sms: string | null;
    last_outbound_at: string | null;
    pipeline_status?: string | null;
};

type LeadsTabProps = {
    leads: PipelineLead[];
    loading?: boolean;
    onRefresh?: () => Promise<void> | void;
};

const pipelineStatuses = [
    "new_lead",
    "contacted",
    "requirements_sent",
    "schedule_sent",
    "booked",
    "confirmed",
    "showed",
    "no_show",
    "reschedule_needed",
    "cancelled",
    "nurture",
    "lost",
];

const mainProgressStatuses = [
    "new_lead",
    "contacted",
    "requirements_sent",
    "schedule_sent",
    "booked",
    "confirmed",
    "showed",
];

const followupStatuses = [
    "no_show",
    "reschedule_needed",
    "nurture",
    "contacted",
    "requirements_sent",
    "schedule_sent",
];

function prettyStatus(value: string | null | undefined) {
    return String(value || "new_lead")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeStatus(value: string | null | undefined) {
    return String(value || "new_lead").trim() || "new_lead";
}

function getLeadBaseKey(lead: PipelineLead) {
    return String(lead.lead_id || `${lead.phone}-${lead.apt_address}`);
}

function getLeadRowKey(lead: PipelineLead, index: number) {
    return [
        lead.lead_id || "no-id",
        lead.phone || "no-phone",
        lead.apt_address || "no-address",
        lead.created_at_ts || lead.created_at || "no-date",
        index,
    ].join("|");
}

function getLeadDateKey(lead: PipelineLead) {
    const value = lead.created_at_ts || lead.created_at;

    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function buildQuoSenderLine(lead: PipelineLead) {
    const phone = String(lead.phone || "").trim();
    const name = String(lead.lead_name || "").trim();
    const address = String(lead.apt_address || "").trim();

    return [phone, name, address].filter(Boolean).join(" | ");
}

function getProgressIndex(status: string) {
    const index = mainProgressStatuses.indexOf(status);
    return index >= 0 ? index : -1;
}

export default function LeadsTab({ leads, loading, onRefresh }: LeadsTabProps) {
    const [selectedStatus, setSelectedStatus] = useState("all");
    const [search, setSearch] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [message, setMessage] = useState("");
    const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
        leads[0]?.lead_id || null
    );
    const [checkedLeadKeys, setCheckedLeadKeys] = useState<string[]>([]);

    const filteredLeads = useMemo(() => {
        const searchText = search.trim().toLowerCase();

        return leads.filter((lead) => {
            const pipelineStatus = normalizeStatus(lead.pipeline_status);
            const leadDateKey = getLeadDateKey(lead);

            if (selectedStatus === "followup_pool") {
                if (!followupStatuses.includes(pipelineStatus)) return false;
            } else if (selectedStatus !== "all" && pipelineStatus !== selectedStatus) {
                return false;
            }

            if (dateFrom && (!leadDateKey || leadDateKey < dateFrom)) return false;
            if (dateTo && (!leadDateKey || leadDateKey > dateTo)) return false;

            if (!searchText) return true;

            const haystack = [
                lead.lead_name,
                lead.phone,
                lead.apt_address,
                lead.current_status,
                lead.conversation_stage,
                lead.pipeline_status,
            ]
                .join(" ")
                .toLowerCase();

            return haystack.includes(searchText);
        });
    }, [leads, search, selectedStatus, dateFrom, dateTo]);

    const selectedLead = useMemo(() => {
        const selectedFromFiltered = filteredLeads.find(
            (lead) => String(lead.lead_id) === String(selectedLeadId)
        );

        return selectedFromFiltered || filteredLeads[0] || null;
    }, [filteredLeads, selectedLeadId]);

    const selectedPipelineStatus = normalizeStatus(selectedLead?.pipeline_status);
    const selectedProgressIndex = getProgressIndex(selectedPipelineStatus);

    const counts = useMemo(() => {
        const map = new Map<string, number>();

        for (const lead of leads) {
            const status = normalizeStatus(lead.pipeline_status);
            map.set(status, (map.get(status) || 0) + 1);
        }

        return map;
    }, [leads]);

    const checkedLeads = useMemo(() => {
        const checked = new Set(checkedLeadKeys);

        return filteredLeads.filter((lead, index) =>
            checked.has(getLeadRowKey(lead, index))
        );
    }, [checkedLeadKeys, filteredLeads]);

    const allVisibleChecked =
        filteredLeads.length > 0 &&
        filteredLeads.every((lead, index) =>
            checkedLeadKeys.includes(getLeadRowKey(lead, index))
        );

    async function updatePipelineStatus(lead: PipelineLead, nextStatus: string) {
        if (!lead.lead_id) return;

        setMessage("");
        setUpdatingLeadId(lead.lead_id);

        const { error } = await supabase
            .from("dashboard_leads")
            .update({
                pipeline_status: nextStatus,
            })
            .eq("lead_id", lead.lead_id);

        setUpdatingLeadId(null);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage(
            `Updated ${lead.lead_name || lead.phone || "lead"} to ${prettyStatus(
                nextStatus
            )}.`
        );

        await onRefresh?.();
    }

    function toggleLeadChecked(lead: PipelineLead, index: number) {
        const key = getLeadRowKey(lead, index);

        setCheckedLeadKeys((current) => {
            if (current.includes(key)) {
                return current.filter((item) => item !== key);
            }

            return [...current, key];
        });
    }

    function toggleAllVisibleChecked() {
        const visibleKeys = filteredLeads.map((lead, index) =>
            getLeadRowKey(lead, index)
        );

        setCheckedLeadKeys((current) => {
            if (allVisibleChecked) {
                return current.filter((key) => !visibleKeys.includes(key));
            }

            return Array.from(new Set([...current, ...visibleKeys]));
        });
    }

    async function copySelectedForQuoSender() {
        const sourceLeads = checkedLeads.length ? checkedLeads : filteredLeads;
        const lines = sourceLeads.map(buildQuoSenderLine).filter(Boolean);

        if (!lines.length) {
            setMessage("No leads to copy.");
            return;
        }

        await navigator.clipboard.writeText(lines.join("\n"));

        setMessage(
            checkedLeads.length
                ? `Copied ${checkedLeads.length} selected lead(s) for QuoSender.`
                : `Copied ${filteredLeads.length} filtered lead(s) for QuoSender.`
        );
    }

    function clearDateFilters() {
        setDateFrom("");
        setDateTo("");
    }

    return (
        <section className={styles.leadsShell}>
            <section className={styles.heroCard}>
                <div className={styles.heroTop}>
                    <div>
                        <div className={styles.eyebrow}>Lead Pipeline</div>
                        <h1 className={styles.title}>Leads</h1>
                        <p className={styles.subtitle}>
                            Filter leads, update pipeline status, and prepare follow-up lists
                            for QuoSender.
                        </p>
                    </div>

                    <div className={styles.heroStats}>
                        <div className={styles.statBox}>
                            <strong>{leads.length}</strong>
                            <span>Total</span>
                        </div>

                        <div className={styles.statBox}>
                            <strong>{filteredLeads.length}</strong>
                            <span>Shown</span>
                        </div>

                        <div className={styles.statBox}>
                            <strong>{checkedLeads.length}</strong>
                            <span>Selected</span>
                        </div>
                    </div>
                </div>

                {selectedLead ? (
                    <div className={styles.selectedPanel}>
                        <div className={styles.selectedLeadInfo}>
                            <div className={styles.selectedName}>
                                {selectedLead.lead_name || "Unnamed Lead"}
                            </div>

                            <div className={styles.selectedMeta}>
                                {selectedLead.phone || "No phone"} ·{" "}
                                {selectedLead.apt_address || "No apartment"}
                            </div>

                            <div className={styles.selectedSms}>
                                {selectedLead.last_outbound_sms || "No outbound SMS yet"}
                            </div>
                        </div>

                        <div className={styles.pipelineTrackWrap}>
                            <div className={styles.pipelineTrack}>
                                {mainProgressStatuses.map((status, index) => {
                                    const isDone =
                                        selectedProgressIndex >= 0 && index < selectedProgressIndex;
                                    const isCurrent = status === selectedPipelineStatus;

                                    return (
                                        <div className={styles.pipelineStep} key={status}>
                                            <div
                                                className={`${styles.pipelineCircle} ${isDone ? styles.pipelineCircleDone : ""
                                                    } ${isCurrent ? styles.pipelineCircleCurrent : ""}`}
                                            >
                                                {index + 1}
                                            </div>

                                            <div
                                                className={`${styles.pipelineLabel} ${isCurrent ? styles.pipelineLabelCurrent : ""
                                                    }`}
                                            >
                                                {prettyStatus(status)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {!mainProgressStatuses.includes(selectedPipelineStatus) ? (
                                <div className={styles.specialStatus}>
                                    Current status:{" "}
                                    <strong>{prettyStatus(selectedPipelineStatus)}</strong>
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </section>

            <section className={styles.filterCard}>
                <div className={styles.filterTop}>
                    <input
                        className={styles.searchInput}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search name, phone, apartment, status..."
                    />

                    <input
                        className={styles.dateInput}
                        type="date"
                        value={dateFrom}
                        onChange={(event) => setDateFrom(event.target.value)}
                    />

                    <input
                        className={styles.dateInput}
                        type="date"
                        value={dateTo}
                        onChange={(event) => setDateTo(event.target.value)}
                    />

                    <button
                        className={styles.refreshButton}
                        type="button"
                        onClick={clearDateFilters}
                    >
                        Clear Dates
                    </button>

                    <button
                        className={styles.copyButton}
                        type="button"
                        onClick={copySelectedForQuoSender}
                    >
                        Copy for QuoSender
                    </button>

                    <button
                        className={styles.refreshButton}
                        type="button"
                        onClick={() => onRefresh?.()}
                    >
                        Refresh
                    </button>
                </div>

                <div className={styles.statusGrid}>
                    <button
                        className={`${styles.statusButton} ${selectedStatus === "all" ? styles.statusButtonActive : ""
                            }`}
                        type="button"
                        onClick={() => setSelectedStatus("all")}
                    >
                        All
                    </button>

                    <button
                        className={`${styles.statusButton} ${selectedStatus === "followup_pool"
                            ? styles.statusButtonDarkActive
                            : styles.statusButtonDark
                            }`}
                        type="button"
                        onClick={() => setSelectedStatus("followup_pool")}
                    >
                        Follow-up Pool
                    </button>

                    {pipelineStatuses.map((status) => (
                        <button
                            key={status}
                            className={`${styles.statusButton} ${selectedStatus === status ? styles.statusButtonActive : ""
                                }`}
                            type="button"
                            onClick={() => setSelectedStatus(status)}
                        >
                            {prettyStatus(status)} ({counts.get(status) || 0})
                        </button>
                    ))}
                </div>
            </section>

            {message ? <div className={styles.messageBox}>{message}</div> : null}

            {loading ? (
                <div className={styles.empty}>Loading leads...</div>
            ) : filteredLeads.length ? (
                <section className={styles.tableCard}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.checkCol}>
                                    <input
                                        type="checkbox"
                                        checked={allVisibleChecked}
                                        onChange={toggleAllVisibleChecked}
                                    />
                                </th>
                                <th>Lead</th>
                                <th>Apartment</th>
                                <th>Pipeline</th>
                                <th>Current</th>
                                <th>Stage</th>
                                <th>Last SMS</th>
                                <th>Created</th>
                            </tr>
                        </thead>

                        <tbody>
                            {filteredLeads.map((lead, index) => {
                                const pipelineStatus = normalizeStatus(lead.pipeline_status);
                                const leadKey = getLeadRowKey(lead, index);
                                const isSelected =
                                    String(selectedLead?.lead_id) === String(lead.lead_id);
                                const isChecked = checkedLeadKeys.includes(leadKey);

                                return (
                                    <tr
                                        key={leadKey}
                                        className={isSelected ? styles.selectedRow : ""}
                                        onClick={() => setSelectedLeadId(lead.lead_id)}
                                    >
                                        <td
                                            className={styles.checkCol}
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => toggleLeadChecked(lead, index)}
                                            />
                                        </td>

                                        <td>
                                            <div className={styles.leadName}>
                                                {lead.lead_name || "Unnamed Lead"}
                                            </div>
                                            <div className={styles.muted}>
                                                {lead.phone || "No phone"}
                                            </div>
                                            <div className={styles.idText}>
                                                #{getLeadBaseKey(lead)}
                                            </div>
                                        </td>

                                        <td>
                                            <div className={styles.addressText}>
                                                {lead.apt_address || "No apartment"}
                                            </div>
                                        </td>

                                        <td onClick={(event) => event.stopPropagation()}>
                                            <select
                                                className={styles.statusSelect}
                                                value={pipelineStatus}
                                                disabled={updatingLeadId === lead.lead_id}
                                                onChange={(event) =>
                                                    updatePipelineStatus(lead, event.target.value)
                                                }
                                            >
                                                {pipelineStatuses.map((status) => (
                                                    <option key={status} value={status}>
                                                        {prettyStatus(status)}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>

                                        <td>
                                            <span className={styles.badge}>
                                                {lead.current_status || "—"}
                                            </span>
                                        </td>

                                        <td>
                                            <span className={styles.badgeLight}>
                                                {lead.conversation_stage || "—"}
                                            </span>
                                        </td>

                                        <td>
                                            <div className={styles.smsText}>
                                                {lead.last_outbound_sms || "No outbound SMS"}
                                            </div>
                                            <div className={styles.muted}>
                                                {lead.last_outbound_at || ""}
                                            </div>
                                        </td>

                                        <td>
                                            <div className={styles.createdText}>
                                                {lead.created_at || lead.created_at_ts || "—"}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </section>
            ) : (
                <div className={styles.empty}>No leads found for this filter.</div>
            )}
        </section>
    );
}