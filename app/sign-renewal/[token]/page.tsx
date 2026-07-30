"use client";

import { use, useEffect, useState } from "react";
import styles from "../../../components/lease-signing/SignPage.module.css";
import SignatureCanvas from "../../../components/lease-signing/SignatureCanvas";

type Status = {
  documentId: string;
  role: string;
  name: string | null;
  email: string;
  status: string;
  originalPdfUrl: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  consentedAt: string | null;
  waitingOnOthers: boolean;
  envelopeCompleted: boolean;
  completedPdfUrl: string | null;
};

const CONSENT_TEXT_1 =
  "I consent to use electronic records and electronic signatures for this renewal agreement.";
const CONSENT_TEXT_2 =
  "I confirm that I have reviewed and agree to the terms of this renewal agreement.";

export default function SignRenewalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");

  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [devOnlyCode, setDevOnlyCode] = useState("");
  const [otpEmailSent, setOtpEmailSent] = useState(false);
  const [verified, setVerified] = useState(false);

  const [consent1, setConsent1] = useState(false);
  const [consent2, setConsent2] = useState(false);

  const [signatureMode, setSignatureMode] = useState<"typed" | "drawn">("typed");
  const [typedName, setTypedName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState("");
  const [completedPdfUrl, setCompletedPdfUrl] = useState<string | null>(null);
  const [waitingForOthers, setWaitingForOthers] = useState(false);

  useEffect(() => {
    fetch(`/api/lease-signing/${token}`)
      .then((res) => res.json())
      .then((json: { ok: boolean; error?: string } & Partial<Status>) => {
        if (!json.ok) {
          setLoadError(json.error || "Could not load this signing request.");
          return;
        }
        setStatus(json as Status);
        setVerified(!!json.verifiedAt);
        if (json.status === "signed") {
          if (json.envelopeCompleted) {
            setCompletedPdfUrl(json.completedPdfUrl ?? null);
          } else {
            setWaitingForOthers(true);
          }
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Unexpected error."));
  }, [token]);

  async function sendCode() {
    setOtpBusy(true);
    setOtpError("");
    setDevOnlyCode("");
    try {
      const res = await fetch(`/api/lease-signing/${token}/send-code`, { method: "POST" });
      const json: { ok: boolean; error?: string; devOnlyCode?: string; emailSent?: boolean } = await res.json();
      if (!json.ok) {
        setOtpError(json.error || "Could not send code.");
        return;
      }
      setOtpSent(true);
      setOtpEmailSent(!!json.emailSent);
      if (json.devOnlyCode) setDevOnlyCode(json.devOnlyCode);
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyCode() {
    setOtpBusy(true);
    setOtpError("");
    try {
      const res = await fetch(`/api/lease-signing/${token}/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otpCode }),
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        setOtpError(json.error || "Incorrect code.");
        return;
      }
      setVerified(true);
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setOtpBusy(false);
    }
  }

  const canSign =
    verified &&
    consent1 &&
    consent2 &&
    (signatureMode === "typed" ? typedName.trim().length > 0 : !!signatureDataUrl);

  async function signAndAccept() {
    setSignBusy(true);
    setSignError("");
    try {
      const res = await fetch(`/api/lease-signing/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consentAccepted1: consent1,
          consentAccepted2: consent2,
          signatureType: signatureMode,
          typedName: signatureMode === "typed" ? typedName.trim() : undefined,
          signatureDataUrl: signatureMode === "drawn" ? signatureDataUrl : undefined,
        }),
      });
      const json: { ok: boolean; error?: string; completedPdfUrl?: string; waitingOnOthers?: boolean } =
        await res.json();
      if (!json.ok) {
        setSignError(json.error || "Could not complete signing.");
        return;
      }
      if (json.waitingOnOthers) {
        setWaitingForOthers(true);
      } else {
        setCompletedPdfUrl(json.completedPdfUrl ?? null);
      }
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setSignBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBanner}>{loadError}</div>
      </div>
    );
  }

  if (!status) {
    return <div className={styles.page}>Loading…</div>;
  }

  if (completedPdfUrl) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Signed successfully</h1>
          <p>Thank you — the renewal agreement has been signed by everyone and is now complete.</p>
          <p>Document ID: {status.documentId}</p>
          <a className={styles.primaryButton} href={completedPdfUrl} target="_blank" rel="noreferrer">
            Download completed agreement
          </a>
        </div>
      </div>
    );
  }

  if (waitingForOthers) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Thanks — you&apos;re signed</h1>
          <p>
            Your signature as <b>{status.role}</b> has been recorded. This agreement will be complete once
            the other party/parties have also signed — you&apos;ll receive an email with the final document
            once everyone has.
          </p>
          <p>Document ID: {status.documentId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Lease Renewal Agreement</h1>
        <p className={styles.meta}>
          Signing as {status.role}: {status.name || status.email} · Document ID: {status.documentId}
        </p>

        {status.originalPdfUrl && (
          <iframe src={status.originalPdfUrl} className={styles.pdfFrame} title="Renewal agreement" />
        )}
        {status.originalPdfUrl && (
          <a href={status.originalPdfUrl} download className={styles.smallButton}>
            Download unsigned agreement
          </a>
        )}
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>1. Verify your email</h2>
        {verified ? (
          <p className={styles.successText}>✓ Email verified</p>
        ) : (
          <>
            <p>We'll send a one-time code to {status.email}.</p>
            {!otpSent ? (
              <button type="button" className={styles.primaryButton} onClick={sendCode} disabled={otpBusy}>
                {otpBusy ? "Sending…" : "Send code"}
              </button>
            ) : (
              <>
                {otpEmailSent && <p className={styles.successText}>✓ Code sent to {status.email}</p>}
                {devOnlyCode && (
                  <p className={styles.devNote}>
                    Dev-only: couldn&apos;t email the code (sandbox mode?), so here it is directly: <b>{devOnlyCode}</b>
                  </p>
                )}
                <input
                  className={styles.input}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="6-digit code"
                  maxLength={6}
                />
                <button type="button" className={styles.primaryButton} onClick={verifyCode} disabled={otpBusy}>
                  {otpBusy ? "Verifying…" : "Verify"}
                </button>
                <button type="button" className={styles.smallButton} onClick={sendCode} disabled={otpBusy}>
                  Resend code
                </button>
              </>
            )}
            {otpError && <p className={styles.errorText}>{otpError}</p>}
          </>
        )}
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>2. Consent</h2>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={consent1} onChange={(e) => setConsent1(e.target.checked)} />
          {CONSENT_TEXT_1}
        </label>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={consent2} onChange={(e) => setConsent2(e.target.checked)} />
          {CONSENT_TEXT_2}
        </label>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>3. Signature</h2>
        <div className={styles.modeToggle}>
          <button
            type="button"
            className={signatureMode === "typed" ? styles.primaryButton : styles.smallButton}
            onClick={() => setSignatureMode("typed")}
          >
            Type name
          </button>
          <button
            type="button"
            className={signatureMode === "drawn" ? styles.primaryButton : styles.smallButton}
            onClick={() => setSignatureMode("drawn")}
          >
            Draw signature
          </button>
        </div>
        {signatureMode === "typed" ? (
          <input
            className={`${styles.input} ${styles.signatureInput}`}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Type your full legal name"
          />
        ) : (
          <SignatureCanvas onChange={setSignatureDataUrl} />
        )}
      </div>

      {signError && <p className={styles.errorText}>{signError}</p>}
      <button
        type="button"
        className={styles.primaryButton}
        disabled={!canSign || signBusy}
        onClick={signAndAccept}
      >
        {signBusy ? "Submitting…" : "Sign and Accept"}
      </button>
    </div>
  );
}
