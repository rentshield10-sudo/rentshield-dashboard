"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PdfPreviewModal from "@/components/pdf-preview/PdfPreviewModal";
import styles from "./PdfHistoryPage.module.css";

interface UploadRecord {
  id: number;
  rentvine_file_id: string;
  file_name: string;
  uploaded_at: string;
}

interface HistoryResponse {
  ok: boolean;
  error?: string;
  apartment?: { address: string; unit: string };
  uploads?: UploadRecord[];
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PdfHistoryPage() {
  const params = useParams<{ id: string }>();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [apartment, setApartment] = useState<{ address: string; unit: string } | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [previewUpload, setPreviewUpload] = useState<UploadRecord | null>(null);

  useEffect(() => {
    fetch(`/api/rentvine/apartment-details/${params.id}/pdf-history`)
      .then((res) => res.json())
      .then((json: HistoryResponse) => {
        if (!json.ok) {
          setErrorMessage(json.error || "Could not load upload history.");
          setStatus("error");
          return;
        }
        setApartment(json.apartment ?? null);
        setUploads(json.uploads ?? []);
        setStatus("success");
      })
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
        setStatus("error");
      });
  }, [params.id]);

  return (
    <div className={styles.page}>
      <h1>
        Upload History{apartment ? ` — ${apartment.address}${apartment.unit ? ` ${apartment.unit}` : ""}` : ""}
      </h1>

      {status === "loading" && <p className={styles.muted}>Loading…</p>}
      {status === "error" && <p className={styles.errorBanner}>{errorMessage}</p>}

      {status === "success" && uploads.length === 0 && (
        <p className={styles.muted}>No PDFs have been uploaded to Rentvine for this unit yet.</p>
      )}

      {status === "success" && uploads.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>File</th>
              <th>Uploaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((upload, i) => (
              <tr key={upload.id}>
                <td>{upload.file_name}</td>
                <td>{formatDateTime(upload.uploaded_at)}</td>
                <td>
                  <button type="button" className={styles.link} onClick={() => setPreviewUpload(upload)}>
                    {i === 0 ? "View (latest)" : "View"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {previewUpload && (
        <PdfPreviewModal
          url={`/api/rentvine/files/${previewUpload.rentvine_file_id}/download`}
          title={previewUpload.file_name}
          onClose={() => setPreviewUpload(null)}
        />
      )}
    </div>
  );
}
