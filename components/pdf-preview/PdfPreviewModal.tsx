"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import styles from "./PdfPreviewModal.module.css";

// Renders PDF pages as canvas elements via pdf.js -- entirely our own UI,
// independent of the browser's native PDF handling. Built because relying
// on a browser tab to render inline (Content-Disposition: inline) turned
// out to be inconsistent: it depends on per-user browser PDF settings, and
// even with correct headers Chrome sometimes downloads instead of viewing.
// The worker is loaded from a CDN matching the installed pdfjs-dist
// version -- react-pdf's own recommended setup for Next.js, since bundling
// the worker file directly runs into Turbopack/webpack asset-path issues.
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfPreviewModalProps {
  url: string;
  title?: string;
  onClose: () => void;
}

export default function PdfPreviewModal({ url, title, onClose }: PdfPreviewModalProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [loadError, setLoadError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [scrollMode, setScrollMode] = useState(true);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.toolbar}>
          <span className={styles.title}>{title || "Preview"}</span>
          <div className={styles.toolbarControls}>
            <button
              type="button"
              className={styles.toolbarButton}
              onClick={() => setScrollMode((m) => !m)}
            >
              {scrollMode ? "Single page" : "Scroll all pages"}
            </button>
            {!scrollMode && (
              <>
                <button
                  type="button"
                  className={styles.toolbarButton}
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1}
                >
                  ‹ Prev
                </button>
                <span className={styles.pageInfo}>
                  Page {pageNumber} of {numPages || "…"}
                </span>
                <button
                  type="button"
                  className={styles.toolbarButton}
                  onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                  disabled={pageNumber >= numPages}
                >
                  Next ›
                </button>
              </>
            )}
            {scrollMode && (
              <span className={styles.pageInfo}>{numPages || "…"} pages</span>
            )}
            <button type="button" className={styles.toolbarButton} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              −
            </button>
            <span className={styles.pageInfo}>{Math.round(zoom * 100)}%</span>
            <button type="button" className={styles.toolbarButton} onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}>
              +
            </button>
            <a href={url} download className={styles.toolbarButton}>
              Download
            </a>
            <button type="button" className={styles.closeButton} onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className={styles.viewport}>
          {loadError ? (
            <div className={styles.errorBanner}>{loadError}</div>
          ) : (
            <Document
              file={url}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              onLoadError={(err) => setLoadError(err.message || "Could not load this PDF.")}
              loading={<div className={styles.muted}>Loading PDF…</div>}
              className={scrollMode ? styles.scrollPages : undefined}
            >
              {scrollMode
                ? Array.from({ length: numPages }, (_, i) => (
                    <Page key={i + 1} pageNumber={i + 1} scale={zoom} />
                  ))
                : <Page pageNumber={pageNumber} scale={zoom} />}
            </Document>
          )}
        </div>
      </div>
    </div>
  );
}
