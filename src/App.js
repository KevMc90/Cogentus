import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://rapidnote-backend.onrender.com";

// Section definitions -- order matters for display
const SECTION_KEYS = [
  { key: "hpiCareHistory",         label: "HPI/Care History" },
  { key: "clinicalSummary",        label: "Clinical Summary" },
  { key: "poc",                    label: "POC" },
  { key: "requestedVisits",        label: "Requested Visits" },
  { key: "determinationRationale", label: "Determination and Rationale" },
  { key: "approvedVisits",         label: "Approved Visits" },
];

// Per-section highlight colours
const SECTION_STYLES = {
  "Determination and Rationale": {
    background: "#fffbeb",
    borderLeft: "4px solid #f59e0b",
  },
  "Approved Visits": {
    background: "#f0fdf4",
    borderLeft: "4px solid #22c55e",
  },
};

// Determination badge colours
function detColor(label) {
  if (!label) return { bg: "#f3f4f6", text: "#374151" };
  const l = label.toLowerCase();
  if (l.startsWith("approved"))        return { bg: "#dcfce7", text: "#15803d" };
  if (l.startsWith("partial denial"))  return { bg: "#fef3c7", text: "#92400e" };
  if (l.startsWith("full denial"))     return { bg: "#fee2e2", text: "#991b1b" };
  if (l.startsWith("pend"))            return { bg: "#f3f4f6", text: "#374151" };
  return { bg: "#f3f4f6", text: "#374151" };
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
}

// --- parseReview ------------------------------------------------------------
function parseReview(reviewText) {
  if (!reviewText) return null;

  const headingPattern = SECTION_KEYS.map(({ label }) =>
    label.replace(/\//g, "\\/").replace(/\s+/g, "\\s+")
  ).join("|");
  const splitter = new RegExp(`((?:${headingPattern})\\s*:?)`, "gi");

  const parts = reviewText.split(splitter).map((s) => s.trim()).filter(Boolean);

  if (parts.length < 2) {
    return [{ label: "HPI/Care History", content: reviewText.trim() }];
  }

  const sections = [];
  for (let i = 0; i < parts.length; i++) {
    const matchedKey = SECTION_KEYS.find(({ label }) =>
      parts[i].replace(/\s*:$/, "").toLowerCase() === label.toLowerCase()
    );
    if (matchedKey) {
      const nextIsContent =
        parts[i + 1] &&
        !SECTION_KEYS.find(({ label }) =>
          parts[i + 1].replace(/\s*:$/, "").toLowerCase() === label.toLowerCase()
        );
      const content = nextIsContent ? parts[i + 1] : "";
      sections.push({ label: matchedKey.label, content: content.trim() });
      if (content) i++;
    }
  }

  return SECTION_KEYS.map(({ label }) => {
    const found = sections.find((s) => s.label === label);
    return { label, content: found ? found.content : "" };
  });
}

// --- Spinner -----------------------------------------------------------------
function Spinner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "24px 0",
        padding: "16px 20px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          border: "3px solid #e5e7eb",
          borderTop: "3px solid #1e3a5f",
          borderRadius: "50%",
          animation: "rn-spin 0.8s linear infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "#1e3a5f", fontSize: 14, fontWeight: 600 }}>
        Generating review — this may take up to 30 seconds...
      </span>
      <style>{`@keyframes rn-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// --- ReviewSection -----------------------------------------------------------
function ReviewSection({ label, content, isLast }) {
  const extra = SECTION_STYLES[label] || {};
  return (
    <div
      style={{
        padding: "16px 24px",
        borderBottom: isLast ? "none" : "1px solid #e5e7eb",
        background: extra.background || "#fff",
        borderLeft: extra.borderLeft || "none",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#1e3a5f",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.75,
          color: "#1f2937",
          whiteSpace: "pre-wrap",
        }}
      >
        {content || (
          <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>
        )}
      </div>
    </div>
  );
}

// --- HistoryRow --------------------------------------------------------------
function HistoryRow({ row, isExpanded, onToggle }) {
  const [rowCopied, setRowCopied] = useState(false);
  const badge = detColor(row.determination_label);

  const copyRowReview = () => {
    const text = [
      `HPI/Care History:\n${row.hpi || "—"}`,
      `Clinical Summary:\n${row.clinical_summary || "—"}`,
      `POC: ${row.poc || "Not specified"}`,
      `Requested Visits: ${row.requested_visits ?? "—"}`,
      `Determination and Rationale:\n${row.determination_line || "—"}`,
      `Approved Visits: ${row.approved_visits ?? "—"}`,
    ].join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setRowCopied(true);
      setTimeout(() => setRowCopied(false), 2500);
    });
  };

  return (
    <div
      style={{
        borderBottom: "1px solid #e5e7eb",
        background: isExpanded ? "#f8fafc" : "#fff",
      }}
    >
      {/* Summary row — clickable */}
      <div
        onClick={onToggle}
        style={{
          display: "grid",
          gridTemplateColumns: "140px 80px 90px 1fr 80px",
          gap: 12,
          padding: "11px 20px",
          alignItems: "center",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 13, color: "#4b5563" }}>
          {formatDateTime(row.created_at)}
        </span>
        <span style={{ fontSize: 13, color: "#374151", textTransform: "capitalize" }}>
          {row.review_type === "subsequent" ? "SUB" : "IE"}
        </span>
        <span style={{ fontSize: 13, fontFamily: "monospace", color: "#1e3a5f", fontWeight: 600 }}>
          {row.primary_diagnosis || "—"}
        </span>
        <span
          style={{
            display: "inline-block",
            padding: "2px 9px",
            borderRadius: 99,
            fontSize: 12,
            fontWeight: 700,
            background: badge.bg,
            color: badge.text,
            width: "fit-content",
          }}
        >
          {row.determination_label || "—"}
        </span>
        <span style={{ fontSize: 13, color: "#374151", textAlign: "right" }}>
          {row.approved_visits ?? "—"} visits
        </span>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div
          style={{
            borderTop: "1px solid #e5e7eb",
            padding: "16px 20px",
            background: "#fff",
          }}
        >
          {/* Copy button */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <button
              onClick={copyRowReview}
              style={{
                background: rowCopied ? "#22c55e" : "#1e3a5f",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              {rowCopied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>

          {/* Detail fields */}
          {[
            { heading: "HPI/Care History", value: row.hpi },
            { heading: "Clinical Summary",  value: row.clinical_summary },
            { heading: "POC",               value: row.poc },
            { heading: "Determination and Rationale", value: row.determination_line },
          ].map(({ heading, value }) => (
            <div key={heading} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1e3a5f",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 4,
                }}
              >
                {heading}
              </div>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "#1f2937",
                  whiteSpace: "pre-wrap",
                }}
              >
                {value || <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- ReviewHistory -----------------------------------------------------------
function ReviewHistory({ refreshTrigger }) {
  const [reviews, setReviews]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`${API_BASE}/api/reviews`);
      setReviews(res.data.reviews || []);
    } catch (err) {
      setError("Could not load review history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews, refreshTrigger]);

  const card = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    marginBottom: 20,
    boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };

  return (
    <div style={card}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          background: "#1e3a5f",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Review History
        </span>
        <button
          onClick={fetchReviews}
          style={{
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Column headers */}
      {reviews.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "140px 80px 90px 1fr 80px",
            gap: 12,
            padding: "8px 20px",
            background: "#f8fafc",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          {["Date / Time", "Type", "Dx Code", "Determination", "Approved"].map((h) => (
            <span
              key={h}
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {h}
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ padding: "24px 20px", color: "#6b7280", fontSize: 14 }}>
          Loading...
        </div>
      ) : error ? (
        <div style={{ padding: "24px 20px", color: "#991b1b", fontSize: 14 }}>
          {error}
        </div>
      ) : reviews.length === 0 ? (
        <div
          style={{
            padding: "32px 20px",
            textAlign: "center",
            color: "#9ca3af",
            fontSize: 14,
            fontStyle: "italic",
          }}
        >
          No reviews generated yet
        </div>
      ) : (
        reviews.map((row) => (
          <HistoryRow
            key={row.id}
            row={row}
            isExpanded={expandedId === row.id}
            onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
          />
        ))
      )}
    </div>
  );
}

// --- App ---------------------------------------------------------------------
function App() {
  const [reviewType, setReviewType]           = useState("initial");
  const [hpi, setHpi]                         = useState("");
  const [priorNote, setPriorNote]             = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [file, setFile]                       = useState(null);
  const [review, setReview]                   = useState("");
  const [ruling, setRuling]                   = useState(null);
  const [error, setError]                     = useState("");
  const [loading, setLoading]                 = useState(false);
  const [copied, setCopied]                   = useState(false);
  const [historyRefresh, setHistoryRefresh]   = useState(0);

  const buildFormData = () => {
    const fd = new FormData();
    fd.append("document", file);
    fd.append("reviewType", reviewType);
    fd.append("hpi", hpi.trim());
    fd.append("requestedVisits", String(parseInt(requestedVisits || "0", 10)));
    if (reviewType === "subsequent") {
      fd.append("priorNote", priorNote.trim());
    }
    return fd;
  };

  const handleSubmit = async () => {
    setError("");
    setReview("");
    setRuling(null);
    setCopied(false);

    if (!file) { setError("A supporting PDF is required."); return; }
    if (!requestedVisits) { setError("Requested Visits is required."); return; }

    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/api/generate-review`,
        buildFormData(),
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setReview(res.data.review || "");
      setRuling(res.data.ruling || null);
      setHistoryRefresh((n) => n + 1); // trigger history reload
    } catch (err) {
      const msg = err?.response?.data?.error;
      setError(msg || `Error generating review: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!review) return;
    const secs = parseReview(review);
    const text = secs
      ? secs.map(({ label, content }) => `${label}:\n${content}`).join("\n\n")
      : review;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const sections = review ? parseReview(review) : null;

  // -- shared style tokens ----------------------------------------------------
  const card = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    marginBottom: 20,
    boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };
  const fieldWrap = { marginBottom: 18 };
  const label = (text) => (
    <label
      style={{
        display: "block",
        fontSize: 13,
        fontWeight: 600,
        color: "#374151",
        marginBottom: 6,
        letterSpacing: "0.01em",
      }}
    >
      {text}
    </label>
  );
  const inputBase = {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 7,
    padding: "9px 12px",
    fontSize: 14,
    color: "#111827",
    background: "#f9fafb",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: "32px 16px 60px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      }}
    >
      <div style={{ maxWidth: 740, margin: "0 auto" }}>

        {/* -- Page header -- */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: "#1e3a5f",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>R</span>
            </div>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#1e3a5f",
                  letterSpacing: "-0.01em",
                }}
              >
                Cogentus
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
                Clinical Determinations, Made Cogent
              </p>
            </div>
          </div>
        </div>

        {/* -- Input card -- */}
        <div style={{ ...card, padding: "24px 28px" }}>
          <h2
            style={{
              margin: "0 0 20px",
              fontSize: 14,
              fontWeight: 700,
              color: "#1e3a5f",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Review Details
          </h2>

          {/* Review Type */}
          <div style={fieldWrap}>
            {label("Review Type")}
            <select
              value={reviewType}
              onChange={(e) => setReviewType(e.target.value)}
              style={{ ...inputBase, cursor: "pointer" }}
            >
              <option value="initial">Initial</option>
              <option value="subsequent">Subsequent</option>
            </select>
          </div>

          {/* HPI / Care History */}
          <div style={fieldWrap}>
            {label('HPI / Care History')}
            <textarea
              value={hpi}
              onChange={(e) => setHpi(e.target.value)}
              placeholder='e.g. 57 YO M, dx M25.561 R shoulder partial supraspinatus tear, fall injury 2/2026. IE 4/7/2026. 8v prev approved at 2x/wk x 4wks (PD for frequency). Initial request.'
              rows={4}
              style={{ ...inputBase, resize: 'vertical', lineHeight: 1.6 }}
            />
          </div>

          {/* Requested Visits */}
          <div style={fieldWrap}>
            {label("Requested Visits")}
            <input
              type="number"
              min="0"
              value={requestedVisits}
              onChange={(e) => setRequestedVisits(e.target.value)}
              placeholder="e.g. 12"
              style={inputBase}
            />
          </div>

          {/* Prior Review Note — SUB only */}
          {reviewType === 'subsequent' && (
            <div style={fieldWrap}>
              {label('Prior Review Note (paste previous determination here)')}
              <textarea
                value={priorNote}
                onChange={(e) => setPriorNote(e.target.value)}
                placeholder='Paste the prior reviewer note here — Cogentus will use it to compare against the current documentation.'
                rows={5}
                style={{ ...inputBase, resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>
          )}

          {/* PDF Upload */}
          <div style={fieldWrap}>
            {label("Supporting Document (PDF) *")}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                border: "1px dashed #d1d5db",
                borderRadius: 7,
                cursor: "pointer",
                background: "#f9fafb",
                fontSize: 14,
                color: file ? "#1e3a5f" : "#6b7280",
              }}
            >
              <span>
                {file ? file.name : "Click to upload PDF..."}
              </span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files[0] || null)}
                style={{ display: "none" }}
              />
            </label>
          </div>

          {/* Error banner */}
          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 7,
                padding: "10px 14px",
                color: "#991b1b",
                fontSize: 14,
                marginBottom: 18,
              }}
            >
              {error}
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              background: loading ? "#93c5fd" : "#1e3a5f",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              padding: "11px 28px",
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.02em",
              transition: "background 0.2s",
            }}
          >
            Generate Review
          </button>
        </div>

        {/* -- Spinner -- */}
        {loading && <Spinner />}

        {/* -- Output card -- */}
        {sections && !loading && (
          <div style={card}>

            {/* Navy header bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 24px",
                background: "#1e3a5f",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#fff",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Generated Review
                </span>
              </div>
              <button
                onClick={handleCopy}
                style={{
                  background: copied ? "#22c55e" : "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 6,
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>

            {/* Review sections */}
            {sections.map(({ label: secLabel, content }, idx) => (
              <ReviewSection
                key={secLabel}
                label={secLabel}
                content={content}
                isLast={idx === sections.length - 1}
              />
            ))}
          </div>
        )}

        {/* -- Review History -- */}
        <ReviewHistory refreshTrigger={historyRefresh} />

      </div>
    </div>
  );
}

export default App;
