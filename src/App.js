import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Cockpit from "./components/Cockpit";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://cogentus-backend.onrender.com";

// ── TAT helpers (mirrors backend computeTatStatus) ───────────────────────────
function computeTat(sub) {
  if (!sub) return null;
  const priority     = sub.review_priority || sub.reviewPriority || "standard";
  const hoursAllowed = priority === "urgent" ? 24 : priority === "expedited" ? 8 : 72;
  const receivedAt   = new Date(sub.received_at || sub.receivedAt || sub.submitted_at || sub.submittedAt || Date.now());
  const now          = new Date();
  let   elapsedMs    = now - receivedAt;
  if (sub.rmi_sent_at || sub.rmiSentAt) {
    const sentAt    = new Date(sub.rmi_sent_at || sub.rmiSentAt);
    const pauseEnd  = (sub.rmi_responded_at || sub.rmiRespondedAt) ? new Date(sub.rmi_responded_at || sub.rmiRespondedAt) : now;
    elapsedMs      -= Math.max(0, pauseEnd - sentAt);
  }
  const elapsedHours = Math.max(0, elapsedMs / 3600000);
  const pct          = Math.min(100, (elapsedHours / hoursAllowed) * 100);
  const hoursLeft    = Math.max(0, hoursAllowed - elapsedHours);
  return {
    status:       pct >= 100 ? "breached" : pct >= 70 ? "at_risk" : "on_track",
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    hoursLeft:    Math.round(hoursLeft * 10) / 10,
    pct:          Math.round(pct),
    hoursAllowed,
    priority,
  };
}

function TatBadge({ sub, style = {} }) {
  const tat = computeTat(sub);
  if (!tat) return null;
  const isBreached = tat.status === "breached";
  const isAtRisk   = tat.status === "at_risk";
  const colors = isBreached
    ? { bg: "#fef2f2", text: "#dc2626", border: "#fca5a5" }
    : isAtRisk
    ? { bg: "#fffbeb", text: "#d97706", border: "#fcd34d" }
    : { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" };
  const label = isBreached
    ? `⚠ SLA BREACHED`
    : `${tat.priority === "urgent" ? "⚡" : "⏱"} ${tat.hoursLeft.toFixed(0)}h left`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 20,
      background: colors.bg, border: `1px solid ${colors.border}`,
      fontSize: 10, fontWeight: 700, color: colors.text,
      fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap",
      ...style,
    }}>
      {label}
    </span>
  );
}

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
  if (!label) return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" };
  const l = label.toLowerCase();
  if (l.startsWith("approved"))        return { bg: "#dcfce7", text: "#15803d", border: "#86efac" };
  if (l.startsWith("partial denial"))  return { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" };
  if (l.startsWith("full denial"))     return { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" };
  if (l.startsWith("pend"))            return { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd" };
  return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" };
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  const dd  = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh  = String(d.getHours()).padStart(2, "0");
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

// --- Spinner ----------------------------------------------------------------
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
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          border: "2.5px solid #e2e8f0",
          borderTop: "2.5px solid #1a3a5c",
          borderRadius: "50%",
          animation: "rn-spin 0.8s linear infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "#1a3a5c", fontSize: 14, fontWeight: 600, fontFamily: '"DM Sans", sans-serif' }}>
        Generating review — this may take up to 30 seconds...
      </span>
    </div>
  );
}

// --- ReviewSection ----------------------------------------------------------
function ReviewSection({ label, content, isLast }) {
  const extra = SECTION_STYLES[label] || {};
  const isDetermination = label === "Determination and Rationale";
  const detBadge = isDetermination && content ? detColor(content.split(":")[0].trim()) : null;
  return (
    <div
      style={{
        padding: "18px 28px",
        borderBottom: isLast ? "none" : "1px solid #f1f5f9",
        background: extra.background || "#fff",
        borderLeft: extra.borderLeft || "none",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: "1px solid #f1f5f9",
          fontFamily: '"DM Sans", sans-serif',
        }}
      >
        {label}
      </div>
      {isDetermination && detBadge && content ? (
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "3px 10px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              background: detBadge.bg,
              color: detBadge.text,
              border: `1px solid ${detBadge.border}`,
              marginBottom: 8,
              fontFamily: '"DM Sans", sans-serif',
            }}
          >
            {content.split(":")[0].trim()}
          </span>
          <div style={{ fontSize: 15, lineHeight: 1.8, color: "#1e293b", whiteSpace: "pre-wrap" }}>
            {content.includes(":") ? content.slice(content.indexOf(":") + 1).trim() : ""}
          </div>
        </div>
      ) : (
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.8,
            color: "#1e293b",
            whiteSpace: "pre-wrap",
          }}
        >
          {content || (
            <span style={{ color: "#94a3b8", fontStyle: "italic" }}>—</span>
          )}
        </div>
      )}
    </div>
  );
}

// --- HistoryRow -------------------------------------------------------------
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

  const [rowHover, setRowHover] = useState(false);
  return (
    <div
      style={{
        borderBottom: "1px solid #f1f5f9",
        background: isExpanded ? "#f8fafc" : rowHover ? "#fafbfc" : "#fff",
        transition: "background 0.12s",
      }}
    >
      <div
        onClick={onToggle}
        onMouseEnter={() => setRowHover(true)}
        onMouseLeave={() => setRowHover(false)}
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
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            background: badge.bg,
            color: badge.text,
            border: `1px solid ${badge.border}`,
            width: "fit-content",
            fontFamily: '"DM Sans", sans-serif',
            letterSpacing: "0.02em",
          }}
        >
          {row.determination_label || "—"}
        </span>
        <span style={{ fontSize: 13, color: "#374151", textAlign: "right" }}>
          {row.approved_visits ?? "—"} visits
        </span>
      </div>


      {isExpanded && (
        <div
          style={{
            borderTop: "1px solid #e5e7eb",
            padding: "16px 20px",
            background: "#fff",
          }}
        >
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

          {[
            { heading: "HPI/Care History",           value: row.hpi },
            { heading: "Clinical Summary",            value: row.clinical_summary },
            { heading: "POC",                         value: row.poc },
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
              <div style={{ fontSize: 14, lineHeight: 1.7, color: "#1f2937", whiteSpace: "pre-wrap" }}>
                {value || <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- ReviewHistory ----------------------------------------------------------
function ReviewHistory({ refreshTrigger, token, onAuthError }) {
  const [reviews, setReviews]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`${API_BASE}/api/reviews`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setReviews(res.data.reviews || []);
    } catch (err) {
      if (err?.response?.status === 401) {
        onAuthError();
      } else {
        setError("Could not load review history.");
      }
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError]);

  useEffect(() => { fetchReviews(); }, [fetchReviews, refreshTrigger]);

  const card = {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    marginBottom: 20,
    boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };

  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: '"DM Sans", sans-serif' }}>
          Review History
        </span>
        <button
          onClick={fetchReviews}
          style={{
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.28)",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            cursor: "pointer",
            fontFamily: '"DM Sans", sans-serif',
          }}
        >
          Refresh
        </button>
      </div>

      {reviews.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "140px 80px 90px 1fr 80px",
            gap: 12,
            padding: "8px 20px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          {["Date / Time", "Type", "Dx Code", "Determination", "Approved"].map((h) => (
            <span
              key={h}
              style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: '"DM Sans", sans-serif' }}
            >
              {h}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "24px 20px", color: "#6b7280", fontSize: 14 }}>Loading...</div>
      ) : error ? (
        <div style={{ padding: "24px 20px", color: "#991b1b", fontSize: 14 }}>{error}</div>
      ) : reviews.length === 0 ? (
        <div style={{ padding: "32px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14, fontStyle: "italic" }}>
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

// --- AuthPage ---------------------------------------------------------------
function AuthPage({ onAuthSuccess }) {
  const [view, setView]           = useState("login"); // "login" | "register"
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [fullName, setFullName]   = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);

  const inputBase = {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 7,
    padding: "10px 12px",
    fontSize: 14,
    color: "#111827",
    background: "#f9fafb",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/auth/login`, { email, password });
      onAuthSuccess(res.data.token, res.data.user);
    } catch (err) {
      if (err?.response?.status === 401) {
        setError("Invalid email or password.");
      } else if (!err?.response) {
        setError("Connection error. Please try again.");
      } else {
        setError(err?.response?.data?.error || "Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/auth/register`, {
        email,
        password,
        full_name: fullName,
      });
      onAuthSuccess(res.data.token, res.data.user);
    } catch (err) {
      if (err?.response?.status === 409) {
        setError("An account with this email already exists.");
      } else if (!err?.response) {
        setError("Connection error. Please try again.");
      } else {
        setError(err?.response?.data?.error || "Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f4f8 0%, #e2eaf4 50%, #edf1f8 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, animation: "rn-fadein 0.4s ease-out" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 52,
              height: 52,
              background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
              borderRadius: 14,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
              boxShadow: "0 4px 16px rgba(26,58,92,0.25)",
            }}
          >
            <span style={{ color: "#fff", fontSize: 26, fontWeight: 700, fontFamily: '"DM Sans", sans-serif' }}>C</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, color: "#1a3a5c", letterSpacing: "-0.02em", fontFamily: '"DM Sans", sans-serif' }}>
            CogentCR
          </h1>
          {view === "login" && (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b", letterSpacing: "0.01em" }}>
              AI-powered clinical prior authorization review
            </p>
          )}
        </div>

        {/* Card */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: "36px 32px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.09)",
          }}
        >
          <h2 style={{ margin: "0 0 24px", fontSize: 17, fontWeight: 600, color: "#0f172a", fontFamily: '"DM Sans", sans-serif' }}>
            {view === "login" ? "Sign in to your account" : "Create your account"}
          </h2>

          <form onSubmit={view === "login" ? handleLogin : handleRegister}>
            {view === "register" && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  style={inputBase}
                  autoComplete="name"
                />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={inputBase}
                autoComplete="email"
              />
            </div>

            <div style={{ marginBottom: view === "register" ? 16 : 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={view === "register" ? "At least 8 characters" : "••••••••"}
                required
                style={inputBase}
                autoComplete={view === "login" ? "current-password" : "new-password"}
              />
            </div>

            {view === "register" && (
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={inputBase}
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: 7,
                  padding: "10px 14px",
                  color: "#991b1b",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                background: loading ? "#94a3b8" : "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px",
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "opacity 0.2s",
                fontFamily: '"DM Sans", sans-serif',
                letterSpacing: "0.01em",
                boxShadow: loading ? "none" : "0 2px 10px rgba(26,58,92,0.25)",
              }}
            >
              {loading ? "Please wait..." : view === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "#6b7280" }}>
            {view === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  onClick={() => { setView("register"); setError(""); }}
                  style={{ background: "none", border: "none", color: "#1e3a5f", fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 13 }}
                >
                  Register
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => { setView("login"); setError(""); }}
                  style={{ background: "none", border: "none", color: "#1e3a5f", fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 13 }}
                >
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- DocumentSummary --------------------------------------------------------
function DocumentSummary({ summary }) {
  const [open, setOpen] = useState(false);
  if (!summary) return null;

  const hasWarnings = summary.warnings && summary.warnings.length > 0;

  return (
    <div
      style={{
        borderBottom: "1px solid #e5e7eb",
        background: "#f8fafc",
      }}
    >
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 24px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Info icon */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#6b7280",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          i
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", flex: 1 }}>
          Document Summary — {summary.totalSelected} of {summary.totalSubmitted} submitted{" "}
          {summary.totalSubmitted === 1 ? "document" : "documents"} used
          {hasWarnings && (
            <span
              style={{
                marginLeft: 10,
                padding: "1px 8px",
                borderRadius: 99,
                background: "#fef3c7",
                color: "#92400e",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {summary.warnings.length} {summary.warnings.length === 1 ? "warning" : "warnings"}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 24px 16px" }}>
          {/* Warnings */}
          {hasWarnings && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #f59e0b",
                borderRadius: 6,
                padding: "10px 14px",
                marginBottom: 14,
              }}
            >
              {summary.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 13, color: "#92400e", lineHeight: 1.5 }}>
                  {i > 0 && <br />}⚠ {w}
                </div>
              ))}
            </div>
          )}

          {/* Documents used */}
          {summary.selectedDocuments.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Used in this determination
              </div>
              {summary.selectedDocuments.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "6px 0",
                    borderBottom: i < summary.selectedDocuments.length - 1 ? "1px solid #e5e7eb" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#22c55e",
                      flexShrink: 0,
                      marginTop: 5,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                      {d.filename}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {d.documentType}{d.documentDate ? ` — ${d.documentDate}` : ""}
                      {d.notes ? ` · ${d.notes}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Documents skipped */}
          {summary.skippedDocuments.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Not used
              </div>
              {summary.skippedDocuments.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "6px 0",
                    borderBottom: i < summary.skippedDocuments.length - 1 ? "1px solid #e5e7eb" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#d1d5db",
                      flexShrink: 0,
                      marginTop: 5,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#374151" }}>{d.filename}</div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>
                      {d.documentType}{d.notes ? ` · ${d.notes}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Dashboard --------------------------------------------------------------
function Dashboard({ user, token, onAuthError, onBack }) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");

  useEffect(() => {
    axios
      .get(`${API_BASE}/api/analytics`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setAnalytics(res.data))
      .catch((err) => {
        if (err?.response?.status === 401) onAuthError();
        else setError("Could not load analytics.");
      })
      .finally(() => setLoading(false));
  }, [token, onAuthError]);

  const card = {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };
  const cardHeader = {
    padding: "12px 20px",
    background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
  };
  const cardTitle = {
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: '"DM Sans", sans-serif',
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#64748b", fontSize: 14 }}>Loading analytics...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#991b1b", fontSize: 14 }}>{error}</span>
      </div>
    );
  }
  if (!analytics) return null;

  const a = analytics;
  const total = a.totalReviews || 1;

  const detItems = [
    { label: "Approved",       count: a.determinationBreakdown.approved,      color: "#22c55e", bg: "#f0fdf4" },
    { label: "Partial Denial", count: a.determinationBreakdown.partialDenial, color: "#f59e0b", bg: "#fffbeb" },
    { label: "Full Denial",    count: a.determinationBreakdown.fullDenial,    color: "#ef4444", bg: "#fef2f2" },
    { label: "Pend",           count: a.determinationBreakdown.pend,          color: "#9ca3af", bg: "#f9fafb" },
  ];

  // Fill last 14 days including zeros
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const isoDate = d.toISOString().split("T")[0];
    const found   = a.reviewsByDay.find((r) => {
      const rd = new Date(r.date).toISOString().split("T")[0];
      return rd === isoDate;
    });
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    last14.push({ label: `${mm}/${dd}`, count: found ? found.count : 0 });
  }
  const maxDay = Math.max(...last14.map((d) => d.count), 1);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)",
        padding: "32px 16px 60px",
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 740, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 8px rgba(26,58,92,0.2)" }}>
              <span style={{ color: "#fff", fontSize: 20, fontWeight: 700, fontFamily: '"DM Sans", sans-serif' }}>C</span>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#1a3a5c", letterSpacing: "-0.02em", fontFamily: '"DM Sans", sans-serif' }}>
                My Dashboard
              </h1>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>{user?.name || user?.email}</p>
            </div>
          </div>
          <button
            onClick={onBack}
            style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 12px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}
          >
            ← Back to Reviews
          </button>
        </div>

        {/* Row 1 — 4 metric cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Total Reviews",    value: a.totalReviews,  color: "#1e3a5f" },
            { label: "Reviews Today",    value: a.reviewsToday,  color: "#1e3a5f" },
            { label: "Approval Rate",    value: `${a.approvalRate}%`, color: "#15803d" },
            {
              label: "Avg Review Time",
              value: a.avgProcessingTimeSeconds != null ? `${a.avgProcessingTimeSeconds}s` : "—",
              color: "#1e3a5f",
            },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ ...card, padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1, fontFamily: '"DM Sans", sans-serif' }}>{value}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 7, fontFamily: '"DM Sans", sans-serif' }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Row 2 — Determination breakdown */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={cardHeader}><span style={cardTitle}>Determination Breakdown</span></div>
          <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {detItems.map(({ label, count, color, bg }) => {
              const pct = Math.round((count / total) * 100);
              return (
                <div key={label} style={{ background: bg, borderRadius: 8, padding: "14px 12px", border: `1px solid ${color}33` }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, fontFamily: '"DM Sans", sans-serif' }}>{count}</div>
                  <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, marginTop: 4, fontFamily: '"DM Sans", sans-serif' }}>{label}</div>
                  <div style={{ marginTop: 10, height: 4, background: "#e5e7eb", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Row 3 — Top 5 diagnoses */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={cardHeader}><span style={cardTitle}>Top Diagnoses</span></div>
          <div style={{ padding: "8px 20px 14px" }}>
            {a.topDiagnoses.length === 0 ? (
              <div style={{ padding: "16px 0", color: "#9ca3af", fontSize: 14, fontStyle: "italic" }}>No data yet</div>
            ) : (
              a.topDiagnoses.map(({ code, count }, i) => {
                const maxCount = a.topDiagnoses[0]?.count || 1;
                return (
                  <div
                    key={code}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: i < a.topDiagnoses.length - 1 ? "1px solid #f3f4f6" : "none" }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", width: 18 }}>#{i + 1}</span>
                    <span style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: "#1e3a5f", width: 88, flexShrink: 0 }}>{code}</span>
                    <div style={{ flex: 1, height: 6, background: "#f3f4f6", borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${Math.round((count / maxCount) * 100)}%`, background: "#1e3a5f", borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 13, color: "#374151", fontWeight: 600, width: 28, textAlign: "right", flexShrink: 0 }}>{count}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Row 4 — Reviews per day bar chart */}
        <div style={card}>
          <div style={cardHeader}><span style={cardTitle}>Reviews — Last 14 Days</span></div>
          <div style={{ padding: "16px 20px 8px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
              {last14.map(({ label, count }) => (
                <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", height: 72 }}>
                    <div
                      style={{
                        width: "80%",
                        height: count === 0 ? 2 : `${Math.max(4, Math.round((count / maxDay) * 68))}px`,
                        background: count === 0 ? "#e5e7eb" : "#1e3a5f",
                        borderRadius: "2px 2px 0 0",
                      }}
                    />
                  </div>
                  {count > 0 && (
                    <span style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>{count}</span>
                  )}
                </div>
              ))}
            </div>
            {/* Date labels every 7 days */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, padding: "0 1%" }}>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{last14[0]?.label}</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{last14[6]?.label}</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{last14[13]?.label}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// --- SubmitCaseView ---------------------------------------------------------
function SubmitCaseView({ user, token, plans, onBack }) {
  const [providerName, setProviderName]   = useState("");
  const [providerNpi, setProviderNpi]     = useState("");
  const [memberName, setMemberName]       = useState("");
  const [memberId, setMemberId]           = useState("");
  const [dob, setDob]                     = useState("");
  const [discipline, setDiscipline]       = useState("PT");
  const [diagCodes, setDiagCodes]         = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [planId, setPlanId]               = useState("");
  const [docList, setDocList]             = useState("");
  const [providerNotes, setProviderNotes] = useState("");
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");
  const [submitted, setSubmitted]         = useState(null);

  const parsedDiags = diagCodes.split(",").map(s => s.trim()).filter(Boolean);
  const parsedDocs  = docList.split("\n").map(s => s.trim()).filter(Boolean);
  const completeness = Math.round([
    !!providerName.trim(), !!memberName.trim(), !!memberId.trim(), !!dob.trim(),
    !!discipline, parsedDiags.length > 0, parseInt(requestedVisits, 10) > 0, parsedDocs.length > 0,
  ].filter(Boolean).length / 8 * 100);

  const meterColor = completeness >= 80 ? "#22c55e" : completeness >= 50 ? "#f59e0b" : "#ef4444";

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/v1/submit`, {
        providerName: providerName.trim() || null, providerNpi: providerNpi.trim() || null,
        memberName: memberName.trim() || null, memberId: memberId.trim() || null,
        dob: dob.trim() || null, discipline,
        diagnosisCodes: parsedDiags, requestedVisits: parseInt(requestedVisits, 10) || null,
        planId: planId || null, documentList: parsedDocs,
        providerNotes: providerNotes.trim() || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setSubmitted(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || "Submission failed. Please try again.");
    } finally { setLoading(false); }
  };

  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.07)", overflow: "hidden" };
  const fieldWrapS = { marginBottom: 16 };
  const labelS = (t) => (<label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.03em", fontFamily: '"DM Sans", sans-serif' }}>{t}</label>);
  const inputS = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 13px", fontSize: 14, color: "#0f172a", background: "#f8fafc", outline: "none", boxSizing: "border-box", fontFamily: '"Inter", sans-serif' };

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 480, width: "100%", background: "#fff", borderRadius: 16, padding: "40px 36px", boxShadow: "0 4px 24px rgba(0,0,0,0.09)", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, background: "#dcfce7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 24 }}>✓</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#166534", fontFamily: '"DM Sans", sans-serif' }}>Submission Received</h2>
          <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 14 }}>Your prior auth request has been submitted for review.</p>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: '"DM Sans", sans-serif' }}>Submission ID</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a5c", fontFamily: "monospace" }}>{submitted.submissionId}</div>
            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Completeness</div>
            <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${submitted.completenessScore}%`, background: meterColor, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>{submitted.completenessScore}% complete</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onBack} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}>Back to Reviews</button>
            <button onClick={() => setSubmitted(null)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer" }}>Submit Another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 100%)", padding: "0 0 60px", fontFamily: '"Inter", sans-serif' }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", borderBottom: "1px solid #e2e8f0", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", padding: "0 16px" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 17, fontWeight: 700, fontFamily: '"DM Sans", sans-serif' }}>C</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#1a3a5c", fontFamily: '"DM Sans", sans-serif' }}>Submit Prior Auth Request</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 120, height: 6, background: "#e2e8f0", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${completeness}%`, background: meterColor, borderRadius: 3, transition: "width 0.2s, background 0.2s" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: meterColor, width: 36, fontFamily: '"DM Sans", sans-serif' }}>{completeness}%</span>
            <button onClick={onBack} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer" }}>← Back</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 16px 0" }}>
        <div style={{ ...card, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", fontFamily: '"DM Sans", sans-serif' }}>Provider Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={fieldWrapS}>{labelS("Provider Name *")}<input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="e.g. Springfield PT Associates" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Provider NPI")}<input value={providerNpi} onChange={e => setProviderNpi(e.target.value)} placeholder="10-digit NPI" style={inputS} /></div>
          </div>
        </div>

        <div style={{ ...card, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", fontFamily: '"DM Sans", sans-serif' }}>Member Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={fieldWrapS}>{labelS("Member Name *")}<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="First Last" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Member ID *")}<input value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="MBR-XXXXX" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Date of Birth *")}<input type="date" value={dob} onChange={e => setDob(e.target.value)} style={inputS} /></div>
          </div>
        </div>

        <div style={{ ...card, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", fontFamily: '"DM Sans", sans-serif' }}>Clinical Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={fieldWrapS}>{labelS("Discipline *")}<select value={discipline} onChange={e => setDiscipline(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="PT">PT</option><option value="OT">OT</option><option value="ST">ST</option></select></div>
            <div style={fieldWrapS}>{labelS("Requested Visits *")}<input type="number" min="0" value={requestedVisits} onChange={e => setRequestedVisits(e.target.value)} placeholder="e.g. 16" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Insurance Plan")}<select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="">— Select Plan —</option>{plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}</select></div>
          </div>
          <div style={fieldWrapS}>{labelS("Diagnosis Codes * (comma-separated)")}<input value={diagCodes} onChange={e => setDiagCodes(e.target.value)} placeholder="e.g. M25.561, M75.1" style={inputS} /></div>
          <div style={fieldWrapS}>{labelS("Document List * (one filename per line)")}<textarea value={docList} onChange={e => setDocList(e.target.value)} placeholder={"IE_Patient_05202026.pdf\nScript_Patient_05182026.pdf"} rows={3} style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} /></div>
          <div style={fieldWrapS}>{labelS("Provider Notes")}<textarea value={providerNotes} onChange={e => setProviderNotes(e.target.value)} placeholder="Clinical context, urgency, history — anything that helps the reviewer." rows={3} style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} /></div>
        </div>

        {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <button onClick={handleSubmit} disabled={loading} style={{ background: loading ? "#94a3b8" : "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", color: "#fff", border: "none", borderRadius: 8, padding: "12px 32px", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: '"DM Sans", sans-serif', boxShadow: loading ? "none" : "0 2px 10px rgba(26,58,92,0.25)" }}>
          {loading ? "Submitting..." : `Submit Request (${completeness}% complete)`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT DECISION LETTER (client-side, no auth header needed)
// ─────────────────────────────────────────────────────────────────────────────
function printDecisionLetter(submission, decision) {
  const isApproved = submission.status === "approved";
  const isDenied   = submission.status === "denied";
  const decLabel   = isApproved ? "APPROVED" : isDenied ? "DENIED" : "PENDED";
  const decColor   = isApproved ? "#15803d"  : isDenied ? "#991b1b" : "#1d4ed8";
  const decBg      = isApproved ? "#f0fdf4"  : isDenied ? "#fef2f2" : "#eff6ff";
  const approvedVisits = decision?.approved_visits ?? null;
  const rationale      = decision?.rationale       ?? "";
  const decidedAt      = decision?.recorded_at ?? submission.updated_at ?? new Date().toISOString();
  const decidedStr     = new Date(decidedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const diags = Array.isArray(submission.diagnosis_codes) ? submission.diagnosis_codes : [];

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CogentCR Decision Letter — ${submission.submission_id}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;800&family=Public+Sans:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Public Sans', Arial, sans-serif; background: #f8fafc; padding: 32px; color: #1e293b; }
  .page { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 16px rgba(0,0,0,0.1); }
  .header { background: #1a3a5c; padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; }
  .header-brand { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.02em; }
  .header-sub { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px; }
  .body { padding: 28px 32px; }
  .det-badge { display: inline-block; padding: 8px 18px; border-radius: 8px; background: ${decBg}; border: 1.5px solid ${decColor}; color: ${decColor}; font-size: 14px; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 22px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 22px; }
  .field-label { font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.1em; }
  .field-value { font-size: 13px; color: #1e293b; font-weight: 600; margin-top: 1px; }
  .visits-box { background: ${decBg}; border: 1px solid ${decColor}; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; }
  .visits-label { font-size: 9px; font-weight: 700; color: ${decColor}; text-transform: uppercase; letter-spacing: 0.1em; }
  .visits-num { font-family: 'Fraunces', Georgia, serif; font-size: 36px; font-weight: 800; color: ${decColor}; line-height: 1; margin-top: 2px; }
  .rationale { margin-bottom: 18px; }
  .rationale-label { font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
  .rationale-text { font-size: 13px; line-height: 1.7; color: #374151; }
  .footer-rule { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0 14px; }
  .footer-text { font-size: 10px; color: #9ca3af; line-height: 1.6; }
  .diag-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .diag-chip { padding: 2px 8px; background: #eff6ff; color: #1a3a5c; font-size: 11px; font-family: monospace; font-weight: 600; border-radius: 4px; }
  @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; border-radius: 0; } }
</style>
</head><body>
<div class="page">
  <div class="header">
    <div>
      <div class="header-brand">CogentCR</div>
      <div class="header-sub">Utilization Management Decision Letter</div>
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,0.5);text-align:right;">Generated ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</div>
  </div>
  <div class="body">
    <div class="det-badge">${decLabel}</div>
    <div class="grid">
      <div><div class="field-label">Member Name</div><div class="field-value">${submission.member_name || "—"}</div></div>
      <div><div class="field-label">Member ID</div><div class="field-value">${submission.member_id || "—"}</div></div>
      <div><div class="field-label">Date of Birth</div><div class="field-value">${submission.dob || "—"}</div></div>
      <div><div class="field-label">Discipline</div><div class="field-value">${submission.discipline || "PT"}</div></div>
      <div><div class="field-label">Case ID</div><div class="field-value" style="font-family:monospace">${submission.submission_id}</div></div>
      <div><div class="field-label">Decision Date</div><div class="field-value">${decidedStr}</div></div>
    </div>
    ${diags.length > 0 ? `<div style="margin-bottom:18px"><div class="field-label">Diagnosis Codes</div><div class="diag-chips">${diags.map(c => `<span class="diag-chip">${c}</span>`).join("")}</div></div>` : ""}
    ${isApproved && approvedVisits != null ? `<div class="visits-box"><div class="visits-label">Authorized Visits</div><div class="visits-num">${approvedVisits} <span style="font-size:16px;font-weight:600">visits</span></div></div>` : ""}
    ${rationale ? `<div class="rationale"><div class="rationale-label">Clinical Rationale</div><div class="rationale-text">${rationale}</div></div>` : ""}
    <hr class="footer-rule">
    <div class="footer-text">
      ${isApproved
        ? "This authorization is valid for the services and dates specified above. Contact CogentCR if clinical circumstances change materially prior to initiation of services."
        : isDenied
        ? "This determination is subject to appeal within 60 calendar days of receipt. To initiate an appeal, contact your CogentCR case coordinator. This determination was made in accordance with established clinical criteria and the member's benefit plan."
        : "Additional clinical documentation has been requested. Please respond within 5 business days to avoid automatic case closure. Contact your case coordinator with questions."}
    </div>
  </div>
</div>
<script>setTimeout(() => window.print(), 400);<\/script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION BELL
// ─────────────────────────────────────────────────────────────────────────────
function NotificationBell({ token }) {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread]               = useState(0);
  const [open, setOpen]                   = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } });
      setNotifications(r.data.notifications || []);
      setUnread(r.data.unread || 0);
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 60000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const markAllRead = async () => {
    try {
      await axios.post(`${API_BASE}/v1/notifications/read-all`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
    } catch {}
  };

  const toggleOpen = () => {
    if (!open && unread > 0) markAllRead();
    setOpen(o => !o);
  };

  const typeColor = (type) => {
    if (type === "determination") return "#1a3a5c";
    return "#6b7280";
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={toggleOpen}
        style={{
          position: "relative", background: open ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.2)", borderRadius: 7, padding: "5px 10px",
          cursor: "pointer", color: "#fff", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", gap: 6,
        }}
        title="Notifications"
      >
        <span>🔔</span>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -5, right: -5, background: "#dc2626", color: "#fff",
            fontSize: 9, fontWeight: 800, borderRadius: "50%", width: 16, height: 16,
            display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 8px)", width: 300, zIndex: 200,
          background: "#fff", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Notifications</span>
            {notifications.some(n => !n.is_read) && (
              <button onClick={markAllRead} style={{ fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Mark all read</button>
            )}
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: "20px 14px", fontSize: 12, color: "#9ca3af", textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No notifications yet.</div>
            ) : notifications.map(n => (
              <div key={n.id} style={{
                padding: "10px 14px", borderBottom: "1px solid #f8fafc",
                background: n.is_read ? "#fff" : "#eff6ff",
                display: "flex", gap: 8, alignItems: "flex-start",
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: n.is_read ? "#d1d5db" : typeColor(n.type), marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#1e293b", fontFamily: "'Public Sans', sans-serif", lineHeight: 1.4 }}>{n.message}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>
                    {n.created_at ? new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER SHELL
// ─────────────────────────────────────────────────────────────────────────────
function ReviewerShell({ user, token, onLogout }) {
  const [revView, setRevView]               = useState("home"); // "home"|"cockpit"|"ur_form"|"search"|"my_stats"
  const [assignedCase, setAssignedCase]     = useState(null);
  const [queueStats, setQueueStats]         = useState(null);
  const [getCaseLoading, setGetCaseLoading] = useState(false);
  const [getCaseError, setGetCaseError]     = useState("");
  const DISC_COLOR = user.discipline === "OT" ? "#c2410c" : user.discipline === "ST" ? "#15803d" : "#1a3a5c";

  useEffect(() => {
    axios.get(`${API_BASE}/v1/queue-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setQueueStats(r.data))
      .catch(() => {});
  }, [token, revView]);

  const handleGetCase = async () => {
    setGetCaseLoading(true);
    setGetCaseError("");
    try {
      const res = await axios.get(`${API_BASE}/v1/get-case`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.data.case) {
        const sub = res.data.case;
        const diags = Array.isArray(sub.diagnosis_codes) ? sub.diagnosis_codes : [];
        setAssignedCase({
          caseId:         sub.submission_id,
          memberName:     sub.member_name || "Unknown Member",
          memberId:       sub.member_id   || "—",
          dob:            sub.dob         || "—",
          discipline:     sub.discipline  || user.discipline || "PT",
          reviewType:     "initial",
          submittedAt:    sub.submitted_at,
          receivedAt:     sub.received_at || sub.submitted_at,
          reviewPriority: sub.review_priority || "standard",
          rmiSentAt:      sub.rmi_sent_at     || null,
          rmiRespondedAt: sub.rmi_responded_at || null,
          documents:      sub.document_list || [],
          metrics: {
            primaryDiagnosisCode: diags[0] || null,
            diagnosisCodes:       diags,
            requestedVisits:      sub.requested_visits || 0,
            therapyType:          sub.discipline || user.discipline || "PT",
            functionalLimitations: [],
            sopIndicators: [],
            documentationQuality: {},
          },
          planRuleSet: sub.plan_id ? { planId: sub.plan_id } : null,
        });
        setRevView("cockpit");
      } else {
        setGetCaseError(res.data.message || "No cases available.");
      }
    } catch (err) {
      setGetCaseError("Failed to reach server. Please try again.");
    } finally {
      setGetCaseLoading(false);
    }
  };

  const handleCaseDone = () => {
    setAssignedCase(null);
    setRevView("home");
  };

  // ── Cockpit view ──
  if (revView === "cockpit" && assignedCase) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{
          background: "#1a3a5c", padding: "8px 20px", display: "flex", alignItems: "center",
          gap: 12, flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.01em" }}>CogentCR</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginLeft: 6 }}>|</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>Reviewing case</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleCaseDone}
            style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}
          >
            Back to Queue
          </button>
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Cockpit
            user={user}
            liveCase={assignedCase}
            hideQueueNav={true}
            onCaseDone={handleCaseDone}
            onBack={handleCaseDone}
          />
        </div>
      </div>
    );
  }

  // ── UR Form view ──
  if (revView === "ur_form") {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <div style={{ background: "#1a3a5c", padding: "10px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>CogentCR</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
          <NotificationBell token={token} />
          <button onClick={onLogout} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Logout</button>
        </div>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
          {[["home","Get Case"], ["ur_form","UR Form"], ["search","Search"], ["my_stats","My Stats"]].map(([v, label]) => (
            <button key={v} onClick={() => setRevView(v)} style={{
              padding: "12px 20px", fontSize: 13, fontWeight: revView === v ? 700 : 500,
              color: revView === v ? "#1a3a5c" : "#6b7280", background: "none", border: "none",
              borderBottom: revView === v ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
              cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
            }}>{label}</button>
          ))}
        </div>
        <URFormEmbed user={user} token={token} />
      </div>
    );
  }

  // ── Search view ──
  if (revView === "search") {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <div style={{ background: "#1a3a5c", padding: "10px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>CogentCR</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
          <NotificationBell token={token} />
          <button onClick={onLogout} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Logout</button>
        </div>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
          {[["home","Get Case"], ["ur_form","UR Form"], ["search","Search"], ["my_stats","My Stats"]].map(([v, label]) => (
            <button key={v} onClick={() => setRevView(v)} style={{
              padding: "12px 20px", fontSize: 13, fontWeight: revView === v ? 700 : 500,
              color: revView === v ? "#1a3a5c" : "#6b7280", background: "none", border: "none",
              borderBottom: revView === v ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
              cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
            }}>{label}</button>
          ))}
        </div>
        <CaseSearchView token={token} />
      </div>
    );
  }

  // ── My Stats view ──
  if (revView === "my_stats") {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <div style={{ background: "#1a3a5c", padding: "10px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>CogentCR</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
          <NotificationBell token={token} />
          <button onClick={onLogout} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Logout</button>
        </div>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
          {[["home","Get Case"], ["ur_form","UR Form"], ["search","Search"], ["my_stats","My Stats"]].map(([v, label]) => (
            <button key={v} onClick={() => setRevView(v)} style={{
              padding: "12px 20px", fontSize: 13, fontWeight: revView === v ? 700 : 500,
              color: revView === v ? "#1a3a5c" : "#6b7280", background: "none", border: "none",
              borderBottom: revView === v ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
              cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
            }}>{label}</button>
          ))}
        </div>
        <ReviewerDashboard token={token} user={user} />
      </div>
    );
  }

  // ── Home view ──
  const discLabel   = user.discipline || "PT";
  const pendingCount = queueStats
    ? (queueStats.byDiscipline || []).filter(d => d.discipline === discLabel).reduce((s, r) => s + parseInt(r.count), 0)
    : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Public Sans', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#1a3a5c", padding: "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.02em" }}>CogentCR</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>|</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", fontFamily: "'Public Sans', sans-serif" }}>Reviewer Portal</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12, background: DISC_COLOR, color: "#fff", border: "1.5px solid rgba(255,255,255,0.3)" }}>{discLabel}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
        <NotificationBell token={token} />
        <button onClick={onLogout} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Logout</button>
      </div>

      {/* Tab bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
        {[["home","Get Case"], ["ur_form","UR Form"], ["search","Search"], ["my_stats","My Stats"]].map(([v, label]) => (
          <button key={v} onClick={() => setRevView(v)} style={{
            padding: "12px 20px", fontSize: 13, fontWeight: revView === v ? 700 : 500,
            color: revView === v ? "#1a3a5c" : "#6b7280", background: "none", border: "none",
            borderBottom: revView === v ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
            cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
          }}>{label}</button>
        ))}
      </div>

      {/* Home content */}
      <div style={{ maxWidth: 520, margin: "72px auto", padding: "0 24px" }}>

        {/* ── Get Case hero — dominant first element ── */}
        <div style={{ background: "#fff", borderRadius: 20, padding: "52px 40px 44px", boxShadow: "0 4px 24px rgba(26,58,92,0.13)", border: "1px solid #dde4ef", textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280", marginBottom: 12, fontFamily: "'Public Sans', sans-serif" }}>
            {discLabel} Reviewer
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.1, marginBottom: 10 }}>
            Ready to review?
          </div>
          <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 36, fontFamily: "'Public Sans', sans-serif", lineHeight: 1.5 }}>
            Cases are assigned by priority and submission age.<br />
            Click below to get your next case.
          </div>
          <button
            onClick={handleGetCase}
            disabled={getCaseLoading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              padding: "16px 56px", borderRadius: 12,
              background: getCaseLoading ? "#94a3b8" : "#1a3a5c",
              color: "#fff", fontSize: 18, fontWeight: 700,
              border: "none", cursor: getCaseLoading ? "not-allowed" : "pointer",
              fontFamily: "'Public Sans', sans-serif",
              boxShadow: getCaseLoading ? "none" : "0 6px 20px rgba(26,58,92,0.38)",
              transition: "all 0.15s",
              letterSpacing: "-0.01em",
            }}
          >
            {getCaseLoading ? "Finding case…" : "Get Case"}
          </button>
          {getCaseError && (
            <div style={{ marginTop: 18, fontSize: 13, color: "#dc2626", fontFamily: "'Public Sans', sans-serif" }}>
              {getCaseError}
            </div>
          )}
        </div>

        {/* ── Queue stats — secondary ── */}
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { label: "Pending in your queue", value: pendingCount !== null ? pendingCount : "—", color: pendingCount > 0 ? "#1a3a5c" : "#9ca3af" },
            { label: "Completed today",        value: queueStats?.casesToday ?? "—",              color: "#15803d" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 5, fontFamily: "'Public Sans', sans-serif" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Thin wrapper: lets ReviewerShell embed the existing form logic without full App state
function URFormEmbed({ user, token }) {
  const [reviewType, setReviewType]   = useState("initial");
  const [therapyType, setTherapyType] = useState(user.discipline || "PT");
  const [hpi, setHpi]                 = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [files, setFiles]             = useState([]);
  const [review, setReview]           = useState("");
  const [ruling, setRuling]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const authHeaders = { Authorization: `Bearer ${token}` };

  const handleSubmit = async () => {
    setError(""); setReview(""); setRuling(null);
    if (files.length === 0) { setError("Please attach at least one PDF."); return; }
    if (!requestedVisits)   { setError("Requested Visits is required."); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("pdfs", f));
      fd.append("reviewType", reviewType);
      fd.append("therapyType", therapyType);
      fd.append("hpi", hpi.trim());
      fd.append("requestedVisits", String(parseInt(requestedVisits || "0", 10)));
      const res = await axios.post(`${API_BASE}/api/generate-review`, fd, { headers: { "Content-Type": "multipart/form-data", ...authHeaders } });
      setReview(res.data.review || "");
      setRuling(res.data.ruling || null);
    } catch (err) {
      setError(err.response?.data?.error || "Review generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const inputS = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box" };
  const labelS = (t) => <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>{t}</div>;

  return (
    <div style={{ maxWidth: 640, margin: "32px auto", padding: "0 24px" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "28px 28px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 20, fontFamily: "'Fraunces', Georgia, serif" }}>UR Review Form</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>{labelS("Review Type")}<select value={reviewType} onChange={e => setReviewType(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="initial">Initial</option><option value="subsequent">Subsequent</option></select></div>
          <div>{labelS("Discipline")}<select value={therapyType} onChange={e => setTherapyType(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="PT">PT</option><option value="OT">OT</option><option value="ST">ST</option></select></div>
          <div>{labelS("Requested Visits")}<input type="number" min="0" value={requestedVisits} onChange={e => setRequestedVisits(e.target.value)} placeholder="e.g. 16" style={inputS} /></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          {labelS("HPI / Clinical Context")}
          <textarea value={hpi} onChange={e => setHpi(e.target.value)} rows={3} placeholder="Brief clinical context..." style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          {labelS("Clinical PDFs")}
          <input type="file" accept=".pdf" multiple onChange={e => setFiles(Array.from(e.target.files))} style={{ fontSize: 13, fontFamily: "'DM Sans', sans-serif" }} />
          {files.length > 0 && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{files.length} file(s) selected</div>}
        </div>
        <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: "11px 0", borderRadius: 8, background: loading ? "#94a3b8" : "#1a3a5c", color: "#fff", fontSize: 14, fontWeight: 700, border: "none", cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Public Sans', sans-serif" }}>
          {loading ? "Processing..." : "Generate Review"}
        </button>
        {error && <div style={{ marginTop: 12, color: "#dc2626", fontSize: 13 }}>{error}</div>}
        {review && (
          <div style={{ marginTop: 20, padding: "16px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "'DM Sans', sans-serif", whiteSpace: "pre-wrap", color: "#1e293b" }}>
            {review}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE SEARCH VIEW (Phase 9)
// ─────────────────────────────────────────────────────────────────────────────
function CaseSearchView({ token }) {
  const [q, setQ]               = useState("");
  const [status, setStatus]     = useState("all");
  const [discipline, setDisc]   = useState("all");
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState("");

  const statusColor = (s) => {
    if (s === "approved")       return { bg: "#dcfce7", text: "#15803d" };
    if (s === "denied")         return { bg: "#fee2e2", text: "#991b1b" };
    if (s === "under_review")   return { bg: "#fef3c7", text: "#92400e" };
    if (s === "pending_review") return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  const discColor = (d) => {
    if (d === "OT") return { bg: "#fff7ed", text: "#c2410c" };
    if (d === "ST") return { bg: "#f0fdf4", text: "#15803d" };
    return { bg: "#eff6ff", text: "#1a3a5c" };
  };

  const runSearch = async () => {
    setLoading(true); setError(""); setSearched(true);
    try {
      const params = new URLSearchParams();
      if (q.trim())           params.set("q", q.trim());
      if (status !== "all")   params.set("status", status);
      if (discipline !== "all") params.set("discipline", discipline);
      const res = await axios.get(`${API_BASE}/v1/search-cases?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setResults(res.data.cases || []);
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputS = { padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", background: "#fff" };

  return (
    <div style={{ maxWidth: 900, margin: "32px auto", padding: "0 24px" }}>
      {/* Search bar */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Search</div>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runSearch()}
              placeholder="Member name, case ID, member ID, or diagnosis code..."
              style={{ ...inputS, width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Status</div>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
              <option value="all">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="pending_review">Pending Review</option>
              <option value="under_review">Under Review</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Discipline</div>
            <select value={discipline} onChange={e => setDisc(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
              <option value="all">All Disciplines</option>
              <option value="PT">PT</option>
              <option value="OT">OT</option>
              <option value="ST">ST</option>
            </select>
          </div>
          <button
            onClick={runSearch}
            disabled={loading}
            style={{ padding: "9px 22px", borderRadius: 8, background: "#1a3a5c", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", flexShrink: 0 }}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 13, color: "#dc2626" }}>{error}</div>}
      </div>

      {/* Results */}
      {searched && (
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Results</span>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>{results.length} case{results.length !== 1 ? "s" : ""} found</span>
          </div>
          {results.length === 0 ? (
            <div style={{ padding: "32px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>
              No cases match your search.
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 130px 120px 70px", gap: 0, padding: "8px 20px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                {["Member", "Case ID", "Disc.", "Status", "Submitted", "Score"].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif" }}>{h}</span>
                ))}
              </div>
              {results.map(r => {
                const sc = statusColor(r.status);
                const dc = discColor(r.discipline);
                return (
                  <div key={r.submission_id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 130px 120px 70px", gap: 0, padding: "12px 20px", borderBottom: "1px solid #f1f5f9", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{r.member_name || "—"}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1, fontFamily: "'DM Sans', monospace" }}>{r.member_id || "—"}</div>
                    </div>
                    <span style={{ fontSize: 11, color: "#374151", fontFamily: "monospace" }}>{r.submission_id}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: dc.bg, color: dc.text, width: "fit-content", fontFamily: "'DM Sans', sans-serif" }}>{r.discipline || "—"}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: sc.bg, color: sc.text, width: "fit-content", textTransform: "capitalize", fontFamily: "'DM Sans', sans-serif" }}>
                      {(r.status || "submitted").replace(/_/g, " ")}
                    </span>
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: r.completeness_score >= 80 ? "#15803d" : r.completeness_score >= 50 ? "#92400e" : "#6b7280" }}>
                      {r.completeness_score != null ? r.completeness_score + "%" : "—"}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {!searched && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>
          Enter a search term above and press Search or Enter.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER DASHBOARD (Phase 9)
// ─────────────────────────────────────────────────────────────────────────────
function ReviewerDashboard({ token, user }) {
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState("today");

  useEffect(() => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/reviewer-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setStats(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const PERIODS = [
    { key: "today",      label: "Today" },
    { key: "this_week",  label: "This Week" },
    { key: "this_month", label: "Month" },
    { key: "all_time",   label: "All Time" },
  ];

  const DET_COLORS = {
    "Approved":      "#15803d",
    "Partial Denial":"#92400e",
    "Full Denial":   "#991b1b",
    "Pended":        "#1d4ed8",
  };

  const totals = stats?.totals || {};
  const totalForPeriod = parseInt(totals[period] || 0);

  const byDet = stats?.byDetermination || [];
  const detRows = byDet.map(r => ({
    det: r.determination,
    count: parseInt(r[period] || 0),
    color: DET_COLORS[r.determination] || "#6b7280",
  })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);

  const recent = stats?.recent || [];

  const detColor2 = (det) => {
    if (!det) return { bg: "#f3f4f6", text: "#374151" };
    const l = det.toLowerCase();
    if (l.startsWith("approved"))        return { bg: "#dcfce7", text: "#15803d" };
    if (l.startsWith("partial denial"))  return { bg: "#fef3c7", text: "#92400e" };
    if (l.startsWith("full denial"))     return { bg: "#fee2e2", text: "#991b1b" };
    if (l.startsWith("pend"))            return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  if (loading) {
    return <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading your stats...</div>;
  }

  return (
    <div style={{ maxWidth: 820, margin: "32px auto", padding: "0 24px" }}>
      {/* Period stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        {PERIODS.map(p => {
          const val = parseInt(totals[p.key] || 0);
          const active = period === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                background: active ? "#1a3a5c" : "#fff",
                border: active ? "2px solid #1a3a5c" : "1px solid #e2e8f0",
                borderRadius: 12, padding: "18px 16px", cursor: "pointer", textAlign: "left",
                boxShadow: active ? "0 4px 16px rgba(26,58,92,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
                transition: "all 0.14s",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 800, color: active ? "#fff" : "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: active ? "rgba(255,255,255,0.75)" : "#6b7280", marginTop: 6, fontFamily: "'Public Sans', sans-serif" }}>{p.label}</div>
            </button>
          );
        })}
      </div>

      {/* Determination breakdown */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 16, fontFamily: "'Fraunces', Georgia, serif" }}>
          Breakdown — {PERIODS.find(p => p.key === period)?.label}
        </div>
        {detRows.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>No cases recorded for this period.</div>
        ) : detRows.map(r => {
          const pct = totalForPeriod > 0 ? Math.round((r.count / totalForPeriod) * 100) : 0;
          return (
            <div key={r.det} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{r.det}</span>
                <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.count} ({pct}%)</span>
              </div>
              <div style={{ background: "#f1f5f9", borderRadius: 4, height: 8, overflow: "hidden" }}>
                <div style={{ width: pct + "%", height: "100%", background: r.color, borderRadius: 4, transition: "width 0.4s ease" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent activity */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>
          Recent Activity
        </div>
        {recent.length === 0 ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No recent activity.</div>
        ) : recent.map((r, i) => {
          const dc = detColor2(r.determination);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 70px 120px", gap: 0, padding: "11px 20px", borderBottom: "1px solid #f1f5f9", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "#374151" }}>{r.case_id || "—"}</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: dc.bg, color: dc.text, width: "fit-content", fontFamily: "'DM Sans', sans-serif" }}>
                {r.determination || "—"}
              </span>
              <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.discipline || "—"}</span>
              <span style={{ fontSize: 11, color: "#374151", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{r.approved_visits != null ? r.approved_visits + " v" : "—"}</span>
              <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif" }}>
                {r.recorded_at ? new Date(r.recorded_at).toLocaleDateString() : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER PORTAL (Phase 10)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STEPS = ["submitted", "pending_review", "under_review", "decision"];
function statusStep(s) {
  if (s === "approved" || s === "denied" || s === "pended") return 3;
  if (s === "under_review")   return 2;
  if (s === "pending_review") return 1;
  return 0;
}
function StatusProgressBar({ status }) {
  const step = statusStep(status);
  const isDecision = step === 3;
  const decisionColor = status === "approved" ? "#15803d" : status === "denied" ? "#991b1b" : "#1d4ed8";
  const LABELS = ["Submitted", "In Queue", "Under Review", status === "approved" ? "Approved" : status === "denied" ? "Denied" : status === "pended" ? "Pended" : "Decision"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, width: "100%", marginTop: 8 }}>
      {LABELS.map((label, i) => {
        const done    = i < step;
        const current = i === step;
        const dotColor = current && isDecision ? decisionColor : (done || current) ? "#1a3a5c" : "#d1d5db";
        return (
          <React.Fragment key={i}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 56 }}>
              <div style={{
                width: 12, height: 12, borderRadius: "50%",
                background: dotColor,
                border: current && !isDecision ? "2px solid #1a3a5c" : "none",
                boxShadow: current ? "0 0 0 3px rgba(26,58,92,0.15)" : "none",
                transition: "all 0.2s",
              }} />
              <span style={{ fontSize: 9, color: current ? dotColor : done ? "#1a3a5c" : "#9ca3af", fontWeight: current ? 700 : 500, marginTop: 3, fontFamily: "'DM Sans', sans-serif", textAlign: "center", lineHeight: 1.2 }}>{label}</span>
            </div>
            {i < LABELS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < step ? "#1a3a5c" : "#e2e8f0", marginBottom: 12, transition: "background 0.3s" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DecisionLetter({ submission, decision }) {
  const isApproved = submission.status === "approved";
  const isDenied   = submission.status === "denied";
  const isPended   = submission.status === "pended";
  if (!isApproved && !isDenied && !isPended) return null;

  const decColor = isApproved ? "#15803d" : isDenied ? "#991b1b" : "#1d4ed8";
  const decBg    = isApproved ? "#f0fdf4" : isDenied ? "#fef2f2" : "#eff6ff";
  const decLabel = isApproved ? "APPROVED" : isDenied ? "DENIED" : "PENDED FOR ADDITIONAL INFORMATION";

  const approvedVisits = decision?.approved_visits ?? null;
  const rationale      = decision?.rationale       ?? null;
  const decidedAt      = decision?.recorded_at     ?? submission.updated_at;

  return (
    <div style={{ marginTop: 20, border: `1.5px solid ${decColor}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      {/* Letterhead */}
      <div style={{ background: "#1a3a5c", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>CogentCR</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginLeft: 4 }}>|</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>Utilization Management Decision</span>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {/* Decision badge */}
        <div style={{ display: "inline-block", padding: "6px 16px", borderRadius: 8, background: decBg, border: `1px solid ${decColor}`, color: decColor, fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", marginBottom: 16, fontFamily: "'Public Sans', sans-serif" }}>
          {decLabel}
        </div>

        {/* Member info */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", marginBottom: 16 }}>
          {[
            ["Member",      submission.member_name || "—"],
            ["Member ID",   submission.member_id   || "—"],
            ["Date of Birth",submission.dob        || "—"],
            ["Discipline",  submission.discipline  || "PT"],
            ["Case ID",     submission.submission_id],
            ["Decision Date", decidedAt ? new Date(decidedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>{k}</span>
              <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 500, fontFamily: "'Public Sans', sans-serif" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Approved visits */}
        {isApproved && approvedVisits != null && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: "#15803d", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>Authorized Visits</span>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#15803d", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.1, marginTop: 2 }}>
              {approvedVisits} <span style={{ fontSize: 14, fontWeight: 600 }}>visits</span>
            </div>
          </div>
        )}

        {/* Rationale */}
        {rationale && (
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>Clinical Rationale</span>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.65, marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>{rationale}</div>
          </div>
        )}

        {/* Footer note + print */}
        <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 12, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5, flex: 1 }}>
            {isApproved
              ? "This authorization is valid for the services and dates specified. Contact CogentCR if clinical circumstances change."
              : isDenied
              ? "This determination is subject to appeal within 60 calendar days of receipt. Contact your case coordinator for appeal instructions."
              : "Additional clinical documentation has been requested. Please respond within 5 business days to avoid case closure."}
          </div>
          <button
            onClick={() => printDecisionLetter(submission, decision)}
            style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", whiteSpace: "nowrap" }}
          >
            Print / PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSubmissionForm({ token, onSubmitted }) {
  const [providerName,    setProviderName]    = useState("");
  const [providerNpi,     setProviderNpi]     = useState("");
  const [memberName,      setMemberName]      = useState("");
  const [memberId,        setMemberId]        = useState("");
  const [dob,             setDob]             = useState("");
  const [discipline,      setDiscipline]      = useState("PT");
  const [diagInput,       setDiagInput]       = useState("");
  const [diagnosisCodes,  setDiagnosisCodes]  = useState([]);
  const [requestedVisits, setRequestedVisits] = useState("");
  const [planId,          setPlanId]          = useState("");
  const [documentNames,   setDocumentNames]   = useState([""]);
  const [providerNotes,   setProviderNotes]   = useState("");
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState("");
  const [plans,           setPlans]           = useState([]);

  useEffect(() => {
    axios.get(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlans(r.data.plans || [])).catch(() => {});
  }, [token]);

  const docList = documentNames.filter(d => d.trim());
  const fields = [
    !!providerName.trim(),
    !!memberName.trim(),
    !!memberId.trim(),
    !!dob,
    !!discipline,
    diagnosisCodes.length > 0,
    parseInt(requestedVisits) > 0,
    docList.length > 0,
  ];
  const completeness = Math.round(fields.filter(Boolean).length / 8 * 100);

  const addDiagCode = () => {
    const code = diagInput.trim().toUpperCase();
    if (code && !diagnosisCodes.includes(code)) {
      setDiagnosisCodes(prev => [...prev, code]);
    }
    setDiagInput("");
  };

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/v1/submit`, {
        providerName, providerNpi, memberName, memberId, dob,
        discipline, diagnosisCodes,
        requestedVisits: parseInt(requestedVisits) || 0,
        planId: planId || null,
        documentList: docList,
        providerNotes,
      }, { headers: { Authorization: `Bearer ${token}` } });
      onSubmitted(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Submission failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputS = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box", background: "#fff" };
  const labelS = (t) => <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>{t}</div>;

  return (
    <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 24px" }}>
      {/* Completeness meter */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Public Sans', sans-serif" }}>Submission Completeness</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: completeness >= 85 ? "#15803d" : completeness >= 50 ? "#92400e" : "#6b7280", fontFamily: "'Fraunces', Georgia, serif" }}>{completeness}%</span>
        </div>
        <div style={{ background: "#f1f5f9", borderRadius: 6, height: 8, overflow: "hidden" }}>
          <div style={{ width: completeness + "%", height: "100%", background: completeness >= 85 ? "#15803d" : completeness >= 50 ? "#f59e0b" : "#94a3b8", borderRadius: 6, transition: "width 0.3s ease" }} />
        </div>
        {completeness >= 85 && (
          <div style={{ fontSize: 11, color: "#15803d", marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>
            Complete — eligible for auto-review on submission
          </div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: "24px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
        {/* Provider info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Provider Information</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
          <div>{labelS("Practice / Provider Name")}<input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="e.g. Springfield PT Clinic" style={inputS} /></div>
          <div>{labelS("NPI (optional)")}<input value={providerNpi} onChange={e => setProviderNpi(e.target.value)} placeholder="1234567890" style={inputS} /></div>
        </div>

        {/* Member info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Member Information</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
          <div style={{ gridColumn: "1 / 3" }}>{labelS("Member Name")}<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="First Last" style={inputS} /></div>
          <div>{labelS("Date of Birth")}<input type="date" value={dob} onChange={e => setDob(e.target.value)} style={inputS} /></div>
          <div>{labelS("Member ID")}<input value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="e.g. XYZ123456" style={inputS} /></div>
          <div>{labelS("Plan / Payer")}<select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
            <option value="">Select plan...</option>
            {plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}
          </select></div>
          <div style={{ gridColumn: "3 / 4" }}>{labelS("Discipline")}<select value={discipline} onChange={e => setDiscipline(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
            <option value="PT">PT — Physical Therapy</option>
            <option value="OT">OT — Occupational Therapy</option>
            <option value="ST">ST — Speech Therapy</option>
          </select></div>
        </div>

        {/* Clinical info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Clinical Request</div>
        <div style={{ marginBottom: 14 }}>
          {labelS("Diagnosis Codes (ICD-10)")}
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input value={diagInput} onChange={e => setDiagInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addDiagCode()}
              placeholder="e.g. M54.5 then Enter" style={{ ...inputS, flex: 1 }} />
            <button onClick={addDiagCode} style={{ padding: "8px 14px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", flexShrink: 0, fontFamily: "'Public Sans', sans-serif" }}>Add</button>
          </div>
          {diagnosisCodes.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {diagnosisCodes.map(c => (
                <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, background: "#eff6ff", color: "#1a3a5c", fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}>
                  {c}
                  <button onClick={() => setDiagnosisCodes(prev => prev.filter(x => x !== c))} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 13 }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 14 }}>
          <div>{labelS("Requested Visits")}<input type="number" min="1" value={requestedVisits} onChange={e => setRequestedVisits(e.target.value)} placeholder="e.g. 16" style={inputS} /></div>
        </div>
        <div style={{ marginBottom: 20 }}>
          {labelS("Clinical Notes (optional)")}
          <textarea value={providerNotes} onChange={e => setProviderNotes(e.target.value)} rows={3} placeholder="Brief clinical context or special circumstances..." style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} />
        </div>

        {/* Documents */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Supporting Documents</div>
        <div style={{ marginBottom: 20 }}>
          {labelS("Document Names")}
          {documentNames.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={d} onChange={e => { const next = [...documentNames]; next[i] = e.target.value; setDocumentNames(next); }}
                placeholder={`e.g. Initial Evaluation Report ${i > 0 ? i + 1 : ""}`} style={{ ...inputS, flex: 1 }} />
              {documentNames.length > 1 && (
                <button onClick={() => setDocumentNames(prev => prev.filter((_, j) => j !== i))}
                  style={{ padding: "8px 10px", borderRadius: 7, background: "#fee2e2", color: "#991b1b", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}>×</button>
              )}
            </div>
          ))}
          <button onClick={() => setDocumentNames(prev => [...prev, ""])}
            style={{ fontSize: 12, color: "#1a3a5c", background: "none", border: "1px dashed #93c5fd", borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", marginTop: 2 }}>
            + Add document
          </button>
        </div>

        {error && <div style={{ marginBottom: 12, padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 7, fontSize: 13, color: "#991b1b", fontFamily: "'DM Sans', sans-serif" }}>{error}</div>}

        <button onClick={handleSubmit} disabled={loading} style={{
          width: "100%", padding: "13px 0", borderRadius: 9, background: loading ? "#94a3b8" : "#1a3a5c",
          color: "#fff", fontSize: 14, fontWeight: 700, border: "none", cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "'Public Sans', sans-serif", boxShadow: loading ? "none" : "0 4px 14px rgba(26,58,92,0.25)",
        }}>
          {loading ? "Submitting..." : `Submit Authorization Request (${completeness}% complete)`}
        </button>
      </div>
    </div>
  );
}

function MyCasesView({ token }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(null);
  const [decisions, setDecisions]     = useState({});

  useEffect(() => {
    axios.get(`${API_BASE}/v1/submissions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setSubmissions(r.data.submissions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const handleExpand = async (sub) => {
    const id = sub.submission_id;
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!decisions[id]) {
      try {
        const r = await axios.get(`${API_BASE}/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        setDecisions(prev => ({ ...prev, [id]: r.data.decision }));
      } catch {}
    }
  };

  if (loading) return <div style={{ textAlign: "center", padding: "48px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading...</div>;

  if (submissions.length === 0) return (
    <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 24px" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "48px 24px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>No submissions yet</div>
        <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>Use "New Submission" to request authorization.</div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 24px" }}>
      {submissions.map(sub => {
        const isOpen = expanded === sub.submission_id;
        return (
          <div key={sub.submission_id} style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 14, overflow: "hidden" }}>
            <div onClick={() => handleExpand(sub)} style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{sub.member_name || "Unknown Member"}</span>
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "#9ca3af" }}>{sub.submission_id}</span>
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>
                  {sub.discipline || "PT"} · {sub.requested_visits} visits requested · {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : "—"}
                </div>
                <div style={{ marginTop: 10 }}>
                  <StatusProgressBar status={sub.status} />
                </div>
              </div>
              <span style={{ fontSize: 16, color: "#9ca3af", flexShrink: 0, marginTop: 2 }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
              <div style={{ borderTop: "1px solid #f1f5f9", padding: "16px 20px" }}>
                {/* Diagnosis codes */}
                {Array.isArray(sub.diagnosis_codes) && sub.diagnosis_codes.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>Diagnosis Codes</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                      {sub.diagnosis_codes.map(c => (
                        <span key={c} style={{ padding: "2px 8px", borderRadius: 5, background: "#eff6ff", color: "#1a3a5c", fontSize: 11, fontFamily: "monospace", fontWeight: 600 }}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Decision letter */}
                <DecisionLetter submission={sub} decision={decisions[sub.submission_id]} />
                {!["approved","denied","pended"].includes(sub.status) && (
                  <div style={{ marginTop: 12, padding: "12px 16px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>
                      Your case is in queue. You will be notified once a determination is made.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProviderPortal({ user, token, onLogout }) {
  const [provView, setProvView] = useState("my_cases"); // "new_submission" | "my_cases"
  const [confirmation, setConfirmation] = useState(null);

  const handleSubmitted = (data) => {
    setConfirmation(data);
    setProvView("confirmation");
  };

  const HEADER = (
    <div style={{ background: "#1a3a5c", padding: "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.02em" }}>CogentCR</span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>|</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", fontFamily: "'Public Sans', sans-serif" }}>Provider Portal</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
      <NotificationBell token={token} />
      <button onClick={onLogout} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Logout</button>
    </div>
  );

  const TABS = (
    <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
      {[["new_submission","New Submission"], ["my_cases","My Cases"]].map(([v, label]) => (
        <button key={v} onClick={() => { setProvView(v); setConfirmation(null); }} style={{
          padding: "12px 20px", fontSize: 13, fontWeight: provView === v ? 700 : 500,
          color: provView === v ? "#1a3a5c" : "#6b7280", background: "none", border: "none",
          borderBottom: provView === v ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
          cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
        }}>{label}</button>
      ))}
    </div>
  );

  // Confirmation / auto-approval result view
  if (provView === "confirmation" && confirmation) {
    const auto = confirmation.autoApproval;
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Public Sans', system-ui, sans-serif" }}>
        {HEADER}{TABS}
        <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 24px" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "32px 28px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
            {auto?.eligible ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>✓</div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#15803d", fontFamily: "'Fraunces', Georgia, serif" }}>Auto-Approved</div>
                    <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>Your request met all criteria for automatic authorization.</div>
                  </div>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "16px 20px", marginBottom: 18 }}>
                  <div style={{ fontSize: 11, color: "#15803d", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>Authorized</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: "#15803d", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.1 }}>{auto.approvedVisits} <span style={{ fontSize: 15, fontWeight: 600 }}>visits</span></div>
                  {auto.rationale && <div style={{ fontSize: 12, color: "#374151", marginTop: 8, fontFamily: "'Public Sans', sans-serif", lineHeight: 1.6 }}>{auto.rationale}</div>}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>⏳</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Submitted for Review</div>
                  <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>A reviewer will process your request. You can track status in My Cases.</div>
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 16px", marginBottom: 20 }}>
              {[
                ["Case ID", confirmation.submissionId],
                ["Completeness", confirmation.completenessScore + "%"],
                ["Submitted", confirmation.submittedAt ? new Date(confirmation.submittedAt).toLocaleDateString() : "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>{k}</div>
                  <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600, fontFamily: "'Public Sans', sans-serif", marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
            <button onClick={() => { setProvView("my_cases"); setConfirmation(null); }}
              style={{ padding: "10px 24px", borderRadius: 8, background: "#1a3a5c", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
              View My Cases
            </button>
            <button onClick={() => { setProvView("new_submission"); setConfirmation(null); }}
              style={{ marginLeft: 10, padding: "10px 24px", borderRadius: 8, background: "none", color: "#1a3a5c", fontSize: 13, fontWeight: 600, border: "1px solid #d1d5db", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
              Submit Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Public Sans', system-ui, sans-serif" }}>
      {HEADER}{TABS}
      {provView === "new_submission" && <NewSubmissionForm token={token} onSubmitted={handleSubmitted} />}
      {provView === "my_cases"       && <MyCasesView token={token} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER DASHBOARD (Phase 12)
// ─────────────────────────────────────────────────────────────────────────────
function MasterDashboard({ token }) {
  const [stats, setStats]       = useState(null);
  const [tatStats, setTatStats] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState("today");
  const [error, setError]       = useState("");

  useEffect(() => {
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get(`${API_BASE}/v1/master-stats`, { headers: h }),
      axios.get(`${API_BASE}/v1/tat-stats`,    { headers: h }).catch(() => null),
    ]).then(([r1, r2]) => {
      setStats(r1.data);
      if (r2) setTatStats(r2.data);
      setLoading(false);
    }).catch(() => { setError("Failed to load stats."); setLoading(false); });
  }, [token]);

  const PERIODS = [
    { key: "today",      label: "Today" },
    { key: "this_week",  label: "This Week" },
    { key: "this_month", label: "This Month" },
    { key: "all_time",   label: "All Time" },
  ];
  const DET_COLORS = {
    "Approved":      "#15803d",
    "Partial Denial":"#92400e",
    "Full Denial":   "#991b1b",
    "Pended":        "#1d4ed8",
  };
  const discColor = (d) => d === "OT" ? "#c2410c" : d === "ST" ? "#15803d" : "#1a3a5c";

  const detBadge = (det) => {
    if (!det) return { bg: "#f3f4f6", text: "#374151" };
    const l = det.toLowerCase();
    if (l.startsWith("approved"))       return { bg: "#dcfce7", text: "#15803d" };
    if (l.includes("denial"))           return { bg: "#fee2e2", text: "#991b1b" };
    if (l.startsWith("partial"))        return { bg: "#fef3c7", text: "#92400e" };
    if (l.startsWith("pend"))           return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading team stats...</div>;
  if (error)   return <div style={{ textAlign: "center", padding: "60px 0", color: "#dc2626", fontSize: 13 }}>{error}</div>;
  if (!stats)  return null;

  const totals  = stats.totals  || {};
  const byDet   = stats.byDetermination || [];
  const revs    = stats.reviewers || [];
  const queue   = stats.queue || [];

  const totalForPeriod  = parseInt(totals[period] || 0);
  const detRows = byDet.map(r => ({
    det: r.determination,
    count: parseInt(r[period] || 0),
    color: DET_COLORS[r.determination] || "#6b7280",
  })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);

  const autoApprPct = totalForPeriod > 0 && totals.auto_approved_all
    ? Math.round(parseInt(totals.auto_approved_all) / parseInt(totals.all_time) * 100)
    : 0;

  return (
    <div style={{ maxWidth: 1000, margin: "28px auto", padding: "0 24px" }}>
      {/* Period selector + top stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {PERIODS.map(p => {
          const val = parseInt(totals[p.key] || 0);
          const active = period === p.key;
          return (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{
              background: active ? "#1a3a5c" : "#fff",
              border: active ? "2px solid #1a3a5c" : "1px solid #e2e8f0",
              borderRadius: 12, padding: "18px 16px", cursor: "pointer", textAlign: "left",
              boxShadow: active ? "0 4px 16px rgba(26,58,92,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
              transition: "all 0.14s",
            }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: active ? "#fff" : "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: active ? "rgba(255,255,255,0.75)" : "#6b7280", marginTop: 6, fontFamily: "'Public Sans', sans-serif" }}>Cases — {p.label}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Determination breakdown */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 16, fontFamily: "'Fraunces', Georgia, serif" }}>
            Team Breakdown — {PERIODS.find(p => p.key === period)?.label}
          </div>
          {detRows.length === 0 ? (
            <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>No cases for this period.</div>
          ) : detRows.map(r => {
            const pct = totalForPeriod > 0 ? Math.round(r.count / totalForPeriod * 100) : 0;
            return (
              <div key={r.det} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{r.det}</span>
                  <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.count} ({pct}%)</span>
                </div>
                <div style={{ background: "#f1f5f9", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: pct + "%", height: "100%", background: r.color, borderRadius: 4, transition: "width 0.4s ease" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Queue health + auto-approval */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif" }}>Queue Health</div>
            {queue.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>Queue is clear.</div>
            ) : queue.map(q => {
              const slaRisk = parseInt(q.sla_at_risk || 0);
              const breached = parseInt(q.sla_breached || 0);
              return (
                <div key={q.discipline} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: "#eff6ff", color: discColor(q.discipline), minWidth: 28, textAlign: "center", fontFamily: "'DM Sans', sans-serif" }}>{q.discipline}</span>
                  <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 4, height: 8, overflow: "hidden" }}>
                    <div style={{ width: "100%", height: "100%", background: breached > 0 ? "#dc2626" : slaRisk > 0 ? "#f59e0b" : "#1a3a5c", borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", minWidth: 24, textAlign: "right", fontFamily: "'Fraunces', Georgia, serif" }}>{q.pending}</span>
                  {(slaRisk > 0 || breached > 0) && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: breached > 0 ? "#dc2626" : "#f59e0b", fontFamily: "'DM Sans', sans-serif" }}>
                      {breached > 0 ? `${breached} breached` : `${slaRisk} at risk`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>Auto-Approval Rate (All Time)</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: "#15803d", fontFamily: "'Fraunces', Georgia, serif" }}>{autoApprPct}%</span>
              <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>{totals.auto_approved_all || 0} of {totals.all_time || 0} cases</span>
            </div>
            <div style={{ marginTop: 6, background: "#f1f5f9", borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ width: autoApprPct + "%", height: "100%", background: "#15803d", borderRadius: 4 }} />
            </div>
          </div>
        </div>
      </div>

      {/* SLA Compliance Panel */}
      {tatStats && (
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>SLA Compliance</span>
            {tatStats.summary.breached > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>
                {tatStats.summary.breached} BREACHED
              </span>
            )}
          </div>
          <div style={{ padding: "16px 20px" }}>
            {/* Summary row */}
            <div style={{ display: "flex", gap: 14, marginBottom: tatStats.atRiskCases.length > 0 ? 16 : 0 }}>
              {[
                { label: "Compliance Rate",  value: tatStats.summary.complianceRate + "%",  color: tatStats.summary.complianceRate >= 90 ? "#15803d" : tatStats.summary.complianceRate >= 75 ? "#d97706" : "#dc2626" },
                { label: "On Track",         value: tatStats.summary.onTrack,                color: "#15803d" },
                { label: "At Risk",          value: tatStats.summary.atRisk,                 color: "#d97706" },
                { label: "Breached",         value: tatStats.summary.breached,               color: tatStats.summary.breached > 0 ? "#dc2626" : "#9ca3af" },
                { label: "Avg Elapsed (h)",  value: tatStats.summary.avgElapsedHours,        color: "#374151" },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "12px 14px", border: "1px solid #f1f5f9", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, fontFamily: "'DM Sans', sans-serif" }}>{s.label}</div>
                </div>
              ))}
            </div>
            {/* Compliance bar */}
            <div style={{ background: "#f1f5f9", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: tatStats.atRiskCases.length > 0 ? 16 : 0 }}>
              <div style={{ width: tatStats.summary.complianceRate + "%", height: "100%", background: tatStats.summary.complianceRate >= 90 ? "#22c55e" : tatStats.summary.complianceRate >= 75 ? "#f59e0b" : "#ef4444", borderRadius: 4, transition: "width 0.6s" }} />
            </div>
            {/* At-risk cases list */}
            {tatStats.atRiskCases.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>Cases Needing Attention</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {tatStats.atRiskCases.slice(0, 5).map(c => (
                    <div key={c.submissionId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6, background: c.tatStatus === "breached" ? "#fef2f2" : "#fffbeb", border: `1px solid ${c.tatStatus === "breached" ? "#fca5a5" : "#fcd34d"}` }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: c.tatStatus === "breached" ? "#dc2626" : "#d97706", minWidth: 60 }}>{c.tatStatus === "breached" ? "BREACHED" : `${c.hoursLeft.toFixed(0)}h left`}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: "'Public Sans', sans-serif", flex: 1 }}>{c.memberName}</span>
                      <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{c.submissionId}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#eff6ff", color: "#1a3a5c" }}>{c.discipline}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: c.priority === "urgent" ? "#fef2f2" : "#f8fafc", color: c.priority === "urgent" ? "#dc2626" : "#9ca3af" }}>{c.priority.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-reviewer performance table */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>
          Reviewer Performance
        </div>
        {revs.length === 0 ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No reviewer activity yet.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 70px 80px 90px 80px 80px 80px", gap: 0, padding: "8px 20px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
              {["Reviewer","Disc.","Today","Week","Month","All Time","Approved","Denied"].map(h => (
                <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif" }}>{h}</span>
              ))}
            </div>
            {revs.map((r, i) => {
              const allTime = parseInt(r.all_time || 0);
              const approved = parseInt(r.approved || 0);
              const denied = parseInt(r.denied || 0);
              const approvePct = allTime > 0 ? Math.round(approved / allTime * 100) : 0;
              return (
                <div key={r.email} style={{ display: "grid", gridTemplateColumns: "1fr 60px 70px 80px 90px 80px 80px 80px", gap: 0, padding: "12px 20px", borderBottom: i < revs.length - 1 ? "1px solid #f1f5f9" : "none", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{r.full_name || "—"}</div>
                    <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif" }}>{r.email}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "#eff6ff", color: discColor(r.discipline), fontFamily: "'DM Sans', sans-serif", width: "fit-content" }}>{r.discipline}</span>
                  {[r.today, r.this_week, r.this_month, r.all_time].map((v, j) => (
                    <span key={j} style={{ fontSize: 13, fontWeight: j === 3 ? 700 : 400, color: j === 3 ? "#1a3a5c" : "#374151", fontFamily: j === 3 ? "'Fraunces', Georgia, serif" : "'Public Sans', sans-serif" }}>{parseInt(v || 0)}</span>
                  ))}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#15803d", fontFamily: "'DM Sans', sans-serif" }}>{approved} ({approvePct}%)</div>
                    <div style={{ background: "#f1f5f9", borderRadius: 3, height: 4, marginTop: 2, overflow: "hidden" }}>
                      <div style={{ width: approvePct + "%", height: "100%", background: "#15803d", borderRadius: 3 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: denied > 0 ? "#991b1b" : "#9ca3af", fontWeight: denied > 0 ? 600 : 400, fontFamily: "'DM Sans', sans-serif" }}>{denied}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function MasterQueueView({ token }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter]     = useState("all");
  const [discFilter, setDiscFilter]         = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter   !== "all") params.set("status", statusFilter);
      if (discFilter     !== "all") params.set("discipline", discFilter);
      const r = await axios.get(`${API_BASE}/v1/submissions?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setSubmissions(r.data.submissions || []);
    } catch {}
    setLoading(false);
  }, [token, statusFilter, discFilter]);

  useEffect(() => { load(); }, [load]);

  const statusBadge = (s) => {
    if (s === "approved")       return { bg: "#dcfce7", text: "#15803d" };
    if (s === "denied")         return { bg: "#fee2e2", text: "#991b1b" };
    if (s === "under_review")   return { bg: "#fef3c7", text: "#92400e" };
    if (s === "pending_review") return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  const selS = { padding: "7px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 12, fontFamily: "'DM Sans', sans-serif", outline: "none", background: "#fff", cursor: "pointer" };

  // Client-side priority filter + sort breached → at_risk → on_track
  const visible = submissions
    .filter(s => priorityFilter === "all" || (s.review_priority || "standard") === priorityFilter)
    .map(s => ({ ...s, _tat: computeTat(s) }))
    .sort((a, b) => {
      const rank = { breached: 0, at_risk: 1, on_track: 2 };
      return (rank[a._tat?.status] ?? 2) - (rank[b._tat?.status] ?? 2);
    });

  return (
    <div style={{ maxWidth: 1100, margin: "28px auto", padding: "0 24px" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selS}>
          <option value="all">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="pending_review">Pending Review</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
        </select>
        <select value={discFilter} onChange={e => setDiscFilter(e.target.value)} style={selS}>
          <option value="all">All Disciplines</option>
          <option value="PT">PT</option>
          <option value="OT">OT</option>
          <option value="ST">ST</option>
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={selS}>
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="expedited">Expedited</option>
          <option value="standard">Standard</option>
        </select>
        <button onClick={load} style={{ padding: "7px 16px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Refresh</button>
        <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4, fontFamily: "'DM Sans', sans-serif" }}>{visible.length} case{visible.length !== 1 ? "s" : ""}</span>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 55px 120px 80px 120px 100px", gap: 0, padding: "8px 20px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
          {["Member","Case ID","Disc.","Status","Visits","TAT / SLA","Submitted"].map(h => (
            <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif" }}>{h}</span>
          ))}
        </div>
        {loading ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Loading...</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No submissions match the current filters.</div>
        ) : visible.map((s, i) => {
          const sb    = statusBadge(s.status);
          const discC = s.discipline === "OT" ? "#c2410c" : s.discipline === "ST" ? "#15803d" : "#1a3a5c";
          const tat   = s._tat;
          const rowBg = tat?.status === "breached" ? "#fffafa" : tat?.status === "at_risk" ? "#fffef5" : "#fff";
          return (
            <div key={s.submission_id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 55px 120px 80px 120px 100px", gap: 0, padding: "12px 20px", borderBottom: i < visible.length - 1 ? "1px solid #f1f5f9" : "none", alignItems: "center", background: rowBg }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{s.member_name || "—"}</span>
                  {s.review_priority === "urgent" && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>⚡ URGENT</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif" }}>{s.member_id || "—"}</div>
              </div>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "#374151" }}>{s.submission_id?.substring(0, 10) || "—"}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: "#eff6ff", color: discC, fontFamily: "'DM Sans', sans-serif", width: "fit-content" }}>{s.discipline || "—"}</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: sb.bg, color: sb.text, textTransform: "capitalize", fontFamily: "'DM Sans', sans-serif", width: "fit-content" }}>{(s.status || "—").replace(/_/g," ")}</span>
              <span style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{s.requested_visits || "—"}</span>
              <TatBadge sub={s} />
              <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MasterShell({ user, token, onLogout }) {
  const [masterView, setMasterView] = useState("dashboard");

  // Cockpit full-screen override
  if (masterView === "cockpit") {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "#1a3a5c", padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>CogentCR</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>|</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>Master — Cockpit</span>
          <div style={{ flex: 1 }} />
          <NotificationBell token={token} />
          <button onClick={() => setMasterView("dashboard")} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>← Dashboard</button>
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Cockpit user={user} onBack={() => setMasterView("dashboard")} />
        </div>
      </div>
    );
  }

  const TABS = [
    ["dashboard", "Dashboard"],
    ["queue",     "All Cases"],
    ["ur_form",   "UR Form"],
    ["cockpit",   "Cockpit"],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Public Sans', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#0d1b2a", padding: "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.02em" }}>CogentCR</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>|</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 10, background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.9)", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.05em" }}>MASTER</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
        <NotificationBell token={token} />
        <button onClick={onLogout} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Logout</button>
      </div>

      {/* Tab bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
        {TABS.map(([v, label]) => (
          <button key={v} onClick={() => setMasterView(v)} style={{
            padding: "12px 20px", fontSize: 13, fontWeight: masterView === v ? 700 : 500,
            color: masterView === v ? "#0d1b2a" : "#6b7280", background: "none", border: "none",
            borderBottom: masterView === v ? "2.5px solid #0d1b2a" : "2.5px solid transparent",
            cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
          }}>{label}</button>
        ))}
      </div>

      {/* Content */}
      {masterView === "dashboard" && <MasterDashboard token={token} />}
      {masterView === "queue"     && <MasterQueueView token={token} />}
      {masterView === "ur_form"   && (
        <div style={{ background: "#f8fafc" }}>
          <URFormEmbed user={user} token={token} />
        </div>
      )}
    </div>
  );
}

// --- App --------------------------------------------------------------------
function App() {
  // Auth state — initialised from localStorage
  const [token, setToken] = useState(() => localStorage.getItem("cogentus_token") || "");
  const [user, setUser]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("cogentus_user") || "null"); }
    catch { return null; }
  });

  // View state
  const [view, setView] = useState("reviews"); // "reviews" | "dashboard" | "cockpit"

  // Live case forwarded to cockpit from form result
  const [pendingCockpitCase, setPendingCockpitCase] = useState(null);

  // Plan config
  const [plans, setPlans]               = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");

  useEffect(() => {
    if (!token) { setPlans([]); return; }
    axios.get(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setPlans(res.data.plans || []))
      .catch(() => {});
  }, [token]);

  // Review form state
  const [reviewType, setReviewType]           = useState("initial");
  const [therapyType, setTherapyType]         = useState("PT");
  const [hpi, setHpi]                         = useState("");
  const [priorNote, setPriorNote]             = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [files, setFiles]                     = useState([]);
  const [review, setReview]                   = useState("");
  const [ruling, setRuling]                   = useState(null);
  const [reviewId, setReviewId]               = useState(null);
  const [reviewMetrics, setReviewMetrics]     = useState(null);
  const [documentSummary, setDocumentSummary] = useState(null);
  const [error, setError]                     = useState("");
  const [loading, setLoading]                 = useState(false);
  const [copied, setCopied]                   = useState(false);
  const [historyRefresh, setHistoryRefresh]   = useState(0);

  const handleAuthSuccess = (tok, userData) => {
    localStorage.setItem("cogentus_token", tok);
    localStorage.setItem("cogentus_user", JSON.stringify(userData));
    setToken(tok);
    setUser(userData);
  };

  const handleAuthError = useCallback(() => {
    localStorage.removeItem("cogentus_token");
    localStorage.removeItem("cogentus_user");
    setToken("");
    setUser(null);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("cogentus_token");
    localStorage.removeItem("cogentus_user");
    setToken("");
    setUser(null);
  };

  // Show auth page when not logged in
  if (!token || !user) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />;
  }

  // Role-based shell routing
  if (user.role === "reviewer") {
    return <ReviewerShell user={user} token={token} onLogout={handleLogout} />;
  }
  if (user.role === "provider") {
    return <ProviderPortal user={user} token={token} onLogout={handleLogout} />;
  }
  if (user.role === "master" || user.role === "admin") {
    return <MasterShell user={user} token={token} onLogout={handleLogout} />;
  }
  // legacy / unknown role → existing UI below

  const authHeaders = { Authorization: `Bearer ${token}` };

  // Dashboard view
  if (view === "dashboard") {
    return (
      <Dashboard
        user={user}
        token={token}
        onAuthError={handleAuthError}
        onBack={() => setView("reviews")}
      />
    );
  }

  // Cockpit view
  if (view === "cockpit") {
    return <Cockpit user={user} onBack={() => setView("reviews")} liveCase={pendingCockpitCase} />;
  }

  // Submit view
  if (view === "submit") {
    return <SubmitCaseView user={user} token={token} plans={plans} onBack={() => setView("reviews")} />;
  }

  const buildFormData = () => {
    const fd = new FormData();
    files.forEach(f => fd.append("pdfs", f));
    fd.append("reviewType", reviewType);
    fd.append("therapyType", therapyType);
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
    setReviewId(null);
    setReviewMetrics(null);
    setDocumentSummary(null);
    setCopied(false);

    if (files.length === 0) { setError("At least one supporting PDF is required."); return; }
    if (!requestedVisits)   { setError("Requested Visits is required."); return; }

    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/api/generate-review`,
        buildFormData(),
        { headers: { "Content-Type": "multipart/form-data", ...authHeaders } }
      );
      setReview(res.data.review || "");
      setRuling(res.data.ruling || null);
      setReviewId(res.data.reviewId || null);
      setReviewMetrics(res.data.metrics || null);
      setDocumentSummary(res.data.documentSummary || null);
      setHistoryRefresh((n) => n + 1);
    } catch (err) {
      if (err?.response?.status === 401) {
        handleAuthError();
      } else {
        const msg = err?.response?.data?.error;
        setError(msg || `Error generating review: ${err.message}`);
      }
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

  const handleExport = () => {
    if (!review) return;
    const secs = parseReview(review);
    if (!secs) return;
    const get = (label) => secs.find((s) => s.label === label)?.content || "";

    const now = new Date();
    const mm   = String(now.getMonth() + 1).padStart(2, "0");
    const dd   = String(now.getDate()).padStart(2, "0");
    const yyyy = now.getFullYear();
    const hh   = String(now.getHours()).padStart(2, "0");
    const min  = String(now.getMinutes()).padStart(2, "0");
    const dateStr     = `${mm}/${dd}/${yyyy} ${hh}:${min}`;
    const fileDateStr = `${mm}${dd}${yyyy}`;
    const icd10 = (reviewMetrics?.primaryDiagnosisCode || "Unknown").replace(/[^A-Z0-9.]/gi, "");

    const content = [
      "COGENTUS CLINICAL DETERMINATION",
      `Generated: ${dateStr}`,
      `Reviewer: ${user?.name || user?.email || "Unknown"}`,
      `Review Type: ${reviewType === "initial" ? "Initial" : "Subsequent"}`,
      "═══════════════════════════════════════",
      "",
      "HPI / CARE HISTORY",
      get("HPI/Care History"),
      "",
      "CLINICAL SUMMARY",
      get("Clinical Summary"),
      "",
      "PLAN OF CARE",
      get("POC"),
      "",
      `REQUESTED VISITS: ${get("Requested Visits")}`,
      "",
      "DETERMINATION AND RATIONALE",
      get("Determination and Rationale"),
      "",
      `APPROVED VISITS: ${get("Approved Visits")}`,
      "",
      "═══════════════════════════════════════",
      "Generated by CogentCR Clinical Intelligence",
      "This determination is based on submitted clinical documentation and published evidence-based guidelines.",
      "For questions contact your utilization review supervisor.",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `CogentCR_Review_${icd10}_${fileDateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sections = review ? parseReview(review) : null;

  // Shared style tokens
  const card = {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    marginBottom: 20,
    boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };
  const fieldWrap = { marginBottom: 18 };
  const labelEl = (text) => (
    <label
      style={{
        display: "block",
        fontSize: 12,
        fontWeight: 600,
        color: "#475569",
        marginBottom: 6,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        fontFamily: '"DM Sans", sans-serif',
      }}
    >
      {text}
    </label>
  );
  const inputBase = {
    width: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 14,
    color: "#0f172a",
    background: "#f8fafc",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: '"Inter", sans-serif',
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)",
        padding: "0 0 60px",
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* -- Sticky page header -- */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
          padding: "0 16px",
        }}
      >
        <div style={{ maxWidth: 740, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
                borderRadius: 9,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 2px 6px rgba(26,58,92,0.2)",
              }}
            >
              <span style={{ color: "#fff", fontSize: 17, fontWeight: 700, fontFamily: '"DM Sans", sans-serif' }}>C</span>
            </div>
            <div>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "#1a3a5c",
                  letterSpacing: "-0.02em",
                  fontFamily: '"DM Sans", sans-serif',
                  lineHeight: 1,
                }}
              >
                CogentCR
              </span>
            </div>
          </div>

          {/* Reviewer info + nav + logout */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setView("dashboard")}
              style={{
                background: "none",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                color: "#1a3a5c",
                cursor: "pointer",
                fontFamily: '"DM Sans", sans-serif',
              }}
            >
              Dashboard
            </button>
            <button
              onClick={() => setView("cockpit")}
              style={{ background: "none", border: "1px solid #cbd5e1", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#1a3a5c", cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}
            >
              Cockpit
            </button>
            <button
              onClick={() => setView("submit")}
              style={{ background: "none", border: "1px solid #cbd5e1", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#1a3a5c", cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}
            >
              Submit Case
            </button>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {user.name || user.email}
            </span>
            <button
              onClick={handleLogout}
              style={{
                background: "none",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                color: "#475569",
                cursor: "pointer",
                fontFamily: '"DM Sans", sans-serif',
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 740, margin: "0 auto", padding: "28px 16px 0" }}>

        {/* -- Input card -- */}
        <div style={{ ...card, padding: "28px 32px" }}>
          <h2
            style={{
              margin: "0 0 22px",
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontFamily: '"DM Sans", sans-serif',
              paddingBottom: 12,
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            Review Details
          </h2>

          {/* Review Type */}
          <div style={fieldWrap}>
            {labelEl("Review Type")}
            <select
              value={reviewType}
              onChange={(e) => setReviewType(e.target.value)}
              style={{ ...inputBase, cursor: "pointer" }}
            >
              <option value="initial">Initial</option>
              <option value="subsequent">Subsequent</option>
            </select>
          </div>

          {/* Discipline */}
          <div style={fieldWrap}>
            {labelEl("Discipline")}
            <select
              value={therapyType}
              onChange={(e) => setTherapyType(e.target.value)}
              style={{ ...inputBase, cursor: "pointer" }}
            >
              <option value="PT">PT — Physical Therapy</option>
              <option value="OT">OT — Occupational Therapy</option>
              <option value="ST">ST — Speech-Language Therapy</option>
            </select>
          </div>

          {/* Insurance Plan */}
          {plans.length > 0 && (
            <div style={fieldWrap}>
              {labelEl("Insurance Plan")}
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                style={{ ...inputBase, cursor: "pointer" }}
              >
                <option value="">Default Plan (no override)</option>
                {plans.map(p => (
                  <option key={p.plan_id} value={p.plan_id}>
                    {p.plan_name} — {p.payer}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* HPI / Care History */}
          <div style={fieldWrap}>
            {labelEl("HPI / Care History")}
            <textarea
              value={hpi}
              onChange={(e) => setHpi(e.target.value)}
              placeholder="e.g. 57 YO M, dx M25.561 R shoulder partial supraspinatus tear, fall injury 2/2026. IE 4/7/2026. 8v prev approved at 2x/wk x 4wks (PD for frequency). Initial request."
              rows={4}
              style={{ ...inputBase, resize: "vertical", lineHeight: 1.6 }}
            />
          </div>

          {/* Requested Visits */}
          <div style={fieldWrap}>
            {labelEl("Requested Visits")}
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
          {reviewType === "subsequent" && (
            <div style={fieldWrap}>
              {labelEl("Prior Review Note (paste previous determination here)")}
              <textarea
                value={priorNote}
                onChange={(e) => setPriorNote(e.target.value)}
                placeholder="Paste the prior reviewer note here — CogentCR will use it to compare against the current documentation."
                rows={5}
                style={{ ...inputBase, resize: "vertical", lineHeight: 1.6 }}
              />
            </div>
          )}

          {/* PDF Upload — multi-file */}
          <div style={fieldWrap}>
            {labelEl("Supporting Documents (PDF) — up to 10 files *")}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 18px",
                border: "1.5px dashed #cbd5e1",
                borderRadius: 10,
                cursor: "pointer",
                background: "#f8fafc",
                fontSize: 14,
                color: files.length > 0 ? "#1a3a5c" : "#64748b",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: files.length > 0 ? "#1a3a5c" : "#94a3b8" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span style={{ fontFamily: '"Inter", sans-serif', fontSize: 14 }}>
                {files.length === 0
                  ? "Click to upload PDF(s)..."
                  : files.length === 1
                  ? files[0].name
                  : `${files.length} files selected`}
              </span>
              <input
                type="file"
                accept="application/pdf"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                style={{ display: "none" }}
              />
            </label>

            {/* File list when multiple selected */}
            {files.length > 1 && (
              <div style={{ marginTop: 8 }}>
                {files.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 0",
                      fontSize: 13,
                      color: "#374151",
                    }}
                  >
                    <span style={{ color: "#6b7280", fontSize: 11 }}>PDF</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </span>
                    <span style={{ color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                ))}
              </div>
            )}
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
              background: loading ? "#94a3b8" : "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "11px 28px",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.02em",
              transition: "opacity 0.2s",
              fontFamily: '"DM Sans", sans-serif',
              boxShadow: loading ? "none" : "0 2px 10px rgba(26,58,92,0.25)",
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 28px",
                background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: '"DM Sans", sans-serif' }}>
                Generated Review
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    if (!reviewMetrics) return;
                    const chosenPlan = plans.find(p => p.plan_id === selectedPlanId);
                    setPendingCockpitCase({
                      caseId:      `LIVE-${reviewId || Date.now()}`,
                      memberName:  "Live Case",
                      memberId:    reviewId ? `RID-${reviewId}` : "—",
                      dob:         "—",
                      discipline:  reviewMetrics.therapyType || "PT",
                      reviewType,
                      submittedAt: new Date().toISOString(),
                      documents:   [],
                      metrics:     reviewMetrics,
                      ruling,
                      planRuleSet: chosenPlan ? {
                        planId:               chosenPlan.plan_id,
                        planName:             chosenPlan.plan_name,
                        payer:                chosenPlan.payer,
                        autoApproveThreshold: chosenPlan.auto_approve_threshold,
                        maxVisitsPerEpisode:  chosenPlan.max_visits_per_episode,
                      } : null,
                    });
                    setView("cockpit");
                  }}
                  style={{
                    background: "rgba(255,255,255,0.18)",
                    border: "1px solid rgba(255,255,255,0.4)",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Send to Cockpit
                </button>
                <button
                  onClick={handleExport}
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Export .txt
                </button>
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
            </div>

            <DocumentSummary summary={documentSummary} />

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
        <ReviewHistory
          refreshTrigger={historyRefresh}
          token={token}
          onAuthError={handleAuthError}
        />

      </div>
    </div>
  );
}

export default App;
