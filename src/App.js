import React, { useState } from "react";
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

// --- parseReview ------------------------------------------------------------
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

// --- parseGates --------------------------------------------------------------
// Converts the backend's ruling.sopSummary into an array of gate pill objects.
function parseGates(ruling) {
  if (!ruling) return [];
  const summary = ruling.sopSummary;
  if (!summary) return [];

  // If already an array of { gate, passed, label } objects -- use directly
  if (Array.isArray(summary)) {
    return summary.map((g, i) => ({
      id: g.gate || `G${i + 1}`,
      passed: g.passed !== false,
      label: g.label || g.gate || `Gate ${i + 1}`,
    }));
  }

  // If it's a string, try to parse lines like "G1: No overlap -- PASS"
  if (typeof summary === "string") {
    return summary
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const passed = /pass|PASS|approved/i.test(line);
        const gateMatch = line.match(/G(\d+)/i);
        const id = gateMatch ? `G${gateMatch[1]}` : `G${i + 1}`;
        // Strip leading gate id and status word for the short label
        const label = line
          .replace(/^G\d+\s*[:--]\s*/i, "")
          .replace(/\s*[--]\s*(pass|fail|approved|denied|pend)/i, "")
          .trim();
        return { id, passed, label: label || line };
      });
  }

  return [];
}

// --- Spinner -----------------------------------------------------------------
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

// --- GatePills ---------------------------------------------------------------
function GatePills({ gates }) {
  if (!gates || gates.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "14px 20px",
        borderBottom: "1px solid #e5e7eb",
        background: "#f8fafc",
      }}
    >
      {gates.map(({ id, passed, label }) => (
        <span
          key={id}
          title={label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: passed ? "#dcfce7" : "#fef3c7",
            color: passed ? "#166534" : "#92400e",
            border: `1px solid ${passed ? "#86efac" : "#fcd34d"}`,
            whiteSpace: "nowrap",
          }}
        >
          <span>{passed ? "PASS" : "FAIL"}</span>
          <span>
            {id}: {label}
          </span>
        </span>
      ))}
    </div>
  );
}

// --- ReviewSection -----------------------------------------------------------
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

// --- App ---------------------------------------------------------------------
function App() {
  const [reviewType, setReviewType]           = useState("initial");
  const [hpi, setHpi]                         = useState("");
  const [priorNote, setPriorNote]             = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [poc, setPoc]                         = useState("");
  const [file, setFile]                       = useState(null);
  const [review, setReview]                   = useState("");
  const [ruling, setRuling]                   = useState(null);
  const [error, setError]                     = useState("");
  const [loading, setLoading]                 = useState(false);
  const [copied, setCopied]                   = useState(false);

  const buildFormData = () => {
    const fd = new FormData();
    fd.append("document", file);                                          // must match upload.single("document")
    fd.append("reviewType", reviewType);
    fd.append("hpi", hpi.trim());
    fd.append("requestedVisits", String(parseInt(requestedVisits || "0", 10)));
    fd.append("poc", poc.trim());
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
    if (!poc.trim()) { setError("Plan of Care is required (e.g. 2x/week x 4 weeks)."); return; }

    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/api/generate-review`,
        buildFormData(),
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setReview(res.data.review || "");
      setRuling(res.data.ruling || null);
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
  const gates    = ruling  ? parseGates(ruling)   : [];

  // -- shared style tokens ----------------------------------------------------
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

        {/* -- Page header -- */}
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
                RapidNote
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
                AI-Assisted Prior Authorization Review
              </p>
            </div>
          </div>
        </div>

        {/* -- Input card -- */}
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

          {/* Requested Visits + Plan of Care -- 2-col on desktop */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
              marginBottom: 18,
            }}
          >
            <div>
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
            <div>
              {label("Plan of Care (e.g. 2x/week x 4 weeks)")}
              <input
                type="text"
                value={poc}
                onChange={(e) => setPoc(e.target.value)}
                placeholder="e.g. 2x/week x 6 weeks"
                style={inputBase}
              />
            </div>
          </div>

          {/* Prior Review Note — SUB only */}
          {reviewType === 'subsequent' && (
            <div style={fieldWrap}>
              {label('Prior Review Note (paste previous determination here)')}
              <textarea
                value={priorNote}
                onChange={(e) => setPriorNote(e.target.value)}
                placeholder='Paste the prior reviewer note here — RapidNote will use it to compare against the current documentation.'
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

        {/* -- Spinner -- */}
        {loading && <Spinner />}

        {/* -- Output card -- */}
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

            {/* Gate pills row */}
            {gates.length > 0 && <GatePills gates={gates} />}

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
      </div>
    </div>
  );
}

export default App;
