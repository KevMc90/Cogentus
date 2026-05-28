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
  const [loading, setLoading]         = useState(false);
  const [slowConnection, setSlowConnection] = useState(false);

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
    setSlowConnection(false);
    const slowTimer = setTimeout(() => setSlowConnection(true), 5000);
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
      clearTimeout(slowTimer);
      setSlowConnection(false);
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
    setSlowConnection(false);
    const slowTimer = setTimeout(() => setSlowConnection(true), 5000);
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
      clearTimeout(slowTimer);
      setSlowConnection(false);
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
              {loading
                ? (slowConnection ? "Waking up server… (up to 60 s)" : "Please wait…")
                : view === "login" ? "Sign In" : "Create Account"}
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
  const [memberState, setMemberState]     = useState("");
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
        dob: dob.trim() || null, memberState: memberState.trim() || null, discipline,
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
            <div style={fieldWrapS}>
              {labelS("Provider NPI")}
              <input value={providerNpi} onChange={e => setProviderNpi(e.target.value)} placeholder="10-digit NPI" style={inputS} />
              <NpiLookupWidget npi={providerNpi} token={token} onVerified={name => { if (!providerName) setProviderName(name); }} />
            </div>
          </div>
        </div>

        <div style={{ ...card, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", fontFamily: '"DM Sans", sans-serif' }}>Member Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={fieldWrapS}>{labelS("Member Name *")}<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="First Last" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Member ID *")}<input value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="MBR-XXXXX" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Date of Birth *")}<input type="date" value={dob} onChange={e => setDob(e.target.value)} style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Member State")}<input value={memberState} onChange={e => setMemberState(e.target.value.toUpperCase().slice(0,2))} placeholder="e.g. CA" maxLength={2} style={{ ...inputS, textTransform: "uppercase" }} /></div>
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
// NPI LOOKUP WIDGET (Phase 22)
// ─────────────────────────────────────────────────────────────────────────────
function NpiLookupWidget({ npi, token, onVerified }) {
  const [state, setState] = React.useState(null); // null | "loading" | {provider} | "error" | "notfound"

  React.useEffect(() => {
    if (!npi || npi.length !== 10 || !/^\d{10}$/.test(npi)) { setState(null); return; }
    setState("loading");
    const tid = setTimeout(() => {
      axios.get(`${API_BASE}/v1/npi-lookup`, {
        params: { npi },
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => {
          setState({ provider: r.data.provider });
          if (onVerified && r.data.provider?.displayName) onVerified(r.data.provider.displayName);
        })
        .catch(e => {
          setState(e.response?.status === 404 ? "notfound" : "error");
        });
    }, 400);
    return () => clearTimeout(tid);
  }, [npi, token]); // eslint-disable-line

  if (!state) return null;
  if (state === "loading") return (
    <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>Verifying NPI…</div>
  );
  if (state === "notfound") return (
    <div style={{ marginTop: 6, fontSize: 11, color: "#dc2626", fontFamily: "'Public Sans', sans-serif" }}>NPI not found in NPPES registry.</div>
  );
  if (state === "error") return (
    <div style={{ marginTop: 6, fontSize: 11, color: "#d97706", fontFamily: "'Public Sans', sans-serif" }}>NPI registry unavailable — continuing without verification.</div>
  );
  const p = state.provider;
  return (
    <div style={{ marginTop: 6, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 7, padding: "8px 12px", display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span style={{ fontSize: 14, marginTop: 1 }}>✓</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", fontFamily: "'Public Sans', sans-serif" }}>{p.displayName || "—"}{p.credential ? `, ${p.credential}` : ""}</div>
        <div style={{ fontSize: 11, color: "#166534", fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
          {[p.specialty, p.city && p.state ? `${p.city}, ${p.state}` : (p.state || null)].filter(Boolean).join(" · ")}
          {p.status === "I" && <span style={{ marginLeft: 8, fontWeight: 700, color: "#dc2626" }}>INACTIVE</span>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER DIRECTORY VIEW (Phase 22)
// ─────────────────────────────────────────────────────────────────────────────
function ProviderDirectoryView({ token }) {
  const [providers, setProviders] = React.useState([]);
  const [q, setQ]                 = React.useState("");
  const [loading, setLoading]     = React.useState(true);
  const [npiInput, setNpiInput]   = React.useState("");
  const [lookupResult, setLookupResult] = React.useState(null);
  const [looking, setLooking]     = React.useState(false);

  const fetchProviders = (search) => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/providers`, {
      params: search ? { q: search } : {},
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { setProviders(r.data.providers || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchProviders(); }, [token]); // eslint-disable-line

  const handleSearch = (e) => { e.preventDefault(); fetchProviders(q); };

  const handleLookup = async () => {
    if (!/^\d{10}$/.test(npiInput)) return;
    setLooking(true); setLookupResult(null);
    try {
      const r = await axios.get(`${API_BASE}/v1/npi-lookup`, {
        params: { npi: npiInput },
        headers: { Authorization: `Bearer ${token}` },
      });
      setLookupResult(r.data.provider);
      fetchProviders(q);
    } catch (e) {
      setLookupResult({ error: e.response?.data?.error || "Lookup failed." });
    } finally {
      setLooking(false);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 24, marginBottom: 28, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Provider Directory</div>
          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>NPPES-verified providers cached from NPI lookups</div>
        </div>
        {/* Quick NPI lookup */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>Look up NPI</div>
            <input value={npiInput} onChange={e => setNpiInput(e.target.value)} placeholder="10-digit NPI"
              style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "monospace", width: 150 }} />
          </div>
          <button onClick={handleLookup} disabled={looking || npiInput.length !== 10}
            style={{ padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", opacity: npiInput.length !== 10 ? 0.5 : 1 }}>
            {looking ? "…" : "Verify"}
          </button>
        </div>
      </div>

      {lookupResult && (
        <div style={{ marginBottom: 18, padding: "12px 16px", borderRadius: 8, background: lookupResult.error ? "#fef2f2" : "#f0fdf4", border: `1px solid ${lookupResult.error ? "#fca5a5" : "#86efac"}`, fontFamily: "'Public Sans', sans-serif", fontSize: 13 }}>
          {lookupResult.error
            ? <span style={{ color: "#dc2626" }}>{lookupResult.error}</span>
            : <><strong>{lookupResult.displayName}{lookupResult.credential ? `, ${lookupResult.credential}` : ""}</strong> · {lookupResult.specialty} · {lookupResult.city}, {lookupResult.state} · NPI {lookupResult.npi}</>
          }
        </div>
      )}

      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, NPI, or specialty…"
          style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }} />
        <button type="submit" style={{ padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Search</button>
      </form>

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px 140px 80px 80px", padding: "10px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>
          <span>NPI</span><span>Provider</span><span>Cred.</span><span>Specialty</span><span>Location</span><span>Status</span>
        </div>
        {loading ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Loading…</div>
        ) : providers.length === 0 ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No providers found. Look up an NPI above to add one.</div>
        ) : providers.map(p => (
          <div key={p.npi} style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px 140px 80px 80px", padding: "11px 16px", borderBottom: "1px solid #f1f5f9", alignItems: "center", fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
            <span style={{ fontFamily: "monospace", color: "#374151", fontSize: 11 }}>{p.npi}</span>
            <span style={{ fontWeight: 600, color: "#1e293b" }}>{p.display_name || "—"}</span>
            <span style={{ color: "#6b7280" }}>{p.credential || "—"}</span>
            <span style={{ color: "#4b5563" }}>{p.specialty ? p.specialty.substring(0, 22) : "—"}</span>
            <span style={{ color: "#6b7280" }}>{p.city && p.state ? `${p.city}, ${p.state}` : (p.state || "—")}</span>
            <span style={{ fontWeight: 700, color: p.status === "I" ? "#dc2626" : "#16a34a" }}>{p.status === "A" ? "Active" : p.status === "I" ? "Inactive" : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EPISODE CONTEXT BAR (Phase 21)
// ─────────────────────────────────────────────────────────────────────────────
function EpisodeContextBar({ memberId, discipline, token }) {
  const [ctx, setCtx] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!memberId || !discipline || memberId === "—") { setLoading(false); return; }
    axios.get(`${API_BASE}/v1/episode-context`, {
      params: { memberId, discipline },
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { setCtx(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [memberId, discipline, token]);

  if (loading || !ctx || !ctx.episode) return null;

  const ep = ctx.episode;
  const subs = ctx.submissions || [];
  const cumVisits = ctx.cumulativeVisits || 0;
  const isConcurrent = subs.length > 1;

  return (
    <div style={{
      background: isConcurrent ? "#fffbeb" : "#f0f9ff",
      borderBottom: `1px solid ${isConcurrent ? "#fde68a" : "#bae6fd"}`,
      padding: "8px 20px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
      fontFamily: "'Public Sans', sans-serif",
      fontSize: 12,
    }}>
      {isConcurrent && (
        <span style={{ fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 5, padding: "2px 8px", fontSize: 11 }}>
          CONCURRENT REVIEW
        </span>
      )}
      <span style={{ color: "#374151" }}>
        <strong>Episode #{ep.episode_number}</strong> · {discipline} · Started {ep.started_at ? new Date(ep.started_at).toLocaleDateString() : "—"}
      </span>
      <span style={{ color: "#6b7280" }}>|</span>
      <span style={{ color: "#374151" }}>{subs.length} auth request{subs.length !== 1 ? "s" : ""} this episode</span>
      <span style={{ color: "#6b7280" }}>|</span>
      <span style={{ color: "#374151" }}><strong>{cumVisits}</strong> visits authorized to date</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATIONS VIEW (Phase 24)
// ─────────────────────────────────────────────────────────────────────────────
const WEBHOOK_EVENTS = ['case.submitted', 'determination.made', 'appeal.filed', 'md.cosigned'];

function IntegrationsView({ token }) {
  const [endpoints,  setEndpoints]  = React.useState([]);
  const [deliveries, setDeliveries] = React.useState([]);
  const [apiKeys,    setApiKeys]    = React.useState([]);
  const [newKey,     setNewKey]     = React.useState(null);
  const [copied,     setCopied]     = React.useState(false);
  const [loading,    setLoading]    = React.useState(true);
  const [whForm,     setWhForm]     = React.useState({ name: '', url: '', secret: '', events: [] });
  const [keyName,    setKeyName]    = React.useState('');
  const [toast,      setToast]      = React.useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      axios.get(`${API_BASE}/v1/webhooks`,           { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_BASE}/v1/webhook-deliveries`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_BASE}/v1/api-keys`,           { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(([w, d, k]) => {
      setEndpoints(w.data.endpoints || []);
      setDeliveries(d.data.deliveries || []);
      setApiKeys(k.data.keys || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchAll(); }, [token]); // eslint-disable-line

  const handleAddWebhook = async (e) => {
    e.preventDefault();
    if (!whForm.events.length) return showToast('Select at least one event.');
    try {
      await axios.post(`${API_BASE}/v1/webhooks`, whForm, { headers: { Authorization: `Bearer ${token}` } });
      setWhForm({ name: '', url: '', secret: '', events: [] });
      fetchAll(); showToast('Webhook endpoint registered.');
    } catch (err) { showToast(err.response?.data?.error || 'Failed to add webhook.'); }
  };

  const handleDeleteWebhook = async (id) => {
    await axios.delete(`${API_BASE}/v1/webhooks/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll(); showToast('Endpoint removed.');
  };

  const handleGenerateKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    try {
      const r = await axios.post(`${API_BASE}/v1/api-keys`, { name: keyName }, { headers: { Authorization: `Bearer ${token}` } });
      setNewKey(r.data.key); setKeyName(''); fetchAll();
    } catch (err) { showToast(err.response?.data?.error || 'Failed to generate key.'); }
  };

  const handleRevokeKey = async (id) => {
    await axios.delete(`${API_BASE}/v1/api-keys/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll(); showToast('API key revoked.');
  };

  const copyKey = () => {
    navigator.clipboard.writeText(newKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const inputS = { width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: "'DM Sans', sans-serif", boxSizing: 'border-box' };
  const secHead = (t) => <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #f1f5f9' }}>{t}</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>
      {toast && <div style={{ position: 'fixed', top: 20, right: 24, background: '#1e293b', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 9999, fontFamily: "'Public Sans', sans-serif" }}>{toast}</div>}

      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Integrations</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>Outbound webhooks and inbound API gateway for external system integration</div>
      </div>

      {/* Webhook Endpoints */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 24 }}>
        {secHead('Webhook Endpoints')}
        {loading ? <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div> : endpoints.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16, fontFamily: "'Public Sans', sans-serif" }}>No endpoints registered yet.</div>
        ) : endpoints.map(ep => (
          <div key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', fontFamily: "'Public Sans', sans-serif" }}>{ep.name}</div>
              <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', marginTop: 2 }}>{ep.url}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {(ep.events || []).map(ev => <span key={ev} style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', fontFamily: "'DM Sans', sans-serif" }}>{ev}</span>)}
              </div>
            </div>
            <button onClick={() => handleDeleteWebhook(ep.id)} style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
          </div>
        ))}

        <form onSubmit={handleAddWebhook} style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Name</div><input value={whForm.name} onChange={e => setWhForm(f => ({...f, name: e.target.value}))} placeholder="e.g. EHR Webhook" style={inputS} required /></div>
          <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>URL</div><input value={whForm.url} onChange={e => setWhForm(f => ({...f, url: e.target.value}))} placeholder="https://your-system.com/webhook" style={inputS} required /></div>
          <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Secret</div><input value={whForm.secret} onChange={e => setWhForm(f => ({...f, secret: e.target.value}))} placeholder="Signing secret" style={inputS} required /></div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>Events</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {WEBHOOK_EVENTS.map(ev => (
                <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  <input type="checkbox" checked={whForm.events.includes(ev)} onChange={e => setWhForm(f => ({ ...f, events: e.target.checked ? [...f.events, ev] : f.events.filter(x => x !== ev) }))} />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: '1 / 3', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" style={{ padding: '8px 18px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Public Sans', sans-serif" }}>Register Endpoint</button>
          </div>
        </form>

        {/* Recent deliveries */}
        {deliveries.length > 0 && (
          <div style={{ marginTop: 18, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>Recent Deliveries</div>
            {deliveries.slice(0, 5).map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#6b7280', fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: d.status === 'delivered' ? '#16a34a' : '#dc2626' }}>{d.status === 'delivered' ? '✓' : '✗'}</span>
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>{d.event_type}</span>
                <span>{d.endpoint_name}</span>
                <span style={{ marginLeft: 'auto' }}>{d.response_code || '—'} · {d.delivered_at ? new Date(d.delivered_at).toLocaleTimeString() : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* API Keys */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
        {secHead('API Keys')}
        <div style={{ marginBottom: 12, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Gateway Endpoint</div>
          <code style={{ fontSize: 11, color: '#1e293b' }}>POST https://rapidnote-backend.onrender.com/v1/gateway/submit</code>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, fontFamily: 'monospace' }}>Header: X-API-Key: {'<your-key>'}</div>
        </div>

        {newKey && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>New API Key — copy now, it won't be shown again</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ fontSize: 11, color: '#166534', wordBreak: 'break-all', flex: 1 }}>{newKey}</code>
              <button onClick={copyKey} style={{ flexShrink: 0, padding: '4px 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{copied ? 'Copied!' : 'Copy'}</button>
              <button onClick={() => setNewKey(null)} style={{ flexShrink: 0, padding: '4px 10px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Dismiss</button>
            </div>
          </div>
        )}

        {apiKeys.map(k => (
          <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', fontFamily: "'Public Sans', sans-serif" }}>{k.name}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: "'DM Sans', sans-serif" }}>Created {new Date(k.created_at).toLocaleDateString()} · Last used: {k.last_used ? new Date(k.last_used).toLocaleDateString() : 'never'}</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: k.is_active ? '#f0fdf4' : '#f1f5f9', color: k.is_active ? '#16a34a' : '#9ca3af' }}>{k.is_active ? 'Active' : 'Revoked'}</span>
            {k.is_active && <button onClick={() => handleRevokeKey(k.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Revoke</button>}
          </div>
        ))}

        <form onSubmit={handleGenerateKey} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="Key name (e.g. EHR System)" style={{ ...inputS, flex: 1 }} required />
          <button type="submit" style={{ flexShrink: 0, padding: '8px 16px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Public Sans', sans-serif" }}>Generate Key</button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK IMPORT VIEW (Phase 25)
// ─────────────────────────────────────────────────────────────────────────────
const BULK_TEMPLATE = `provider_name,provider_npi,member_name,member_id,dob,member_state,discipline,diagnosis_codes,requested_visits,plan_id,provider_notes
Springfield PT Clinic,1234567890,Jane Smith,MBR-001,1978-04-12,CA,PT,M54.5;M47.816,12,BCBS-STD,Lower back pain with radiculopathy
Lakeside OT Associates,0987654321,Marcus Lee,MBR-002,1990-07-22,NY,OT,F84.0,16,,Sensory processing and ADL goals`;

function BulkImportView({ token }) {
  const [csv,     setCsv]     = React.useState('');
  const [result,  setResult]  = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error,   setError]   = React.useState('');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsv(ev.target.result);
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!csv.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await axios.post(`${API_BASE}/v1/bulk-import`, { csv }, { headers: { Authorization: `Bearer ${token}` } });
      setResult(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed.');
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([BULK_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'cogentcr-bulk-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const inputS = { padding: '8px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: "'DM Sans', sans-serif" };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Bulk Case Import</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>Upload a CSV to batch-submit multiple cases at once</div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={downloadTemplate} style={{ ...inputS, background: '#f8fafc', color: '#1a3a5c', border: '1px solid #cbd5e1', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Download Template CSV</button>
          <label style={{ ...inputS, background: '#f8fafc', color: '#1a3a5c', border: '1px solid #cbd5e1', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            Upload CSV <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>CSV Content</div>
        <textarea
          value={csv} onChange={e => setCsv(e.target.value)}
          placeholder="Paste CSV here or upload a file above…"
          style={{ width: '100%', minHeight: 160, padding: '10px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af', fontFamily: "'DM Sans', sans-serif" }}>
          Columns: provider_name, provider_npi, member_name, member_id, dob, member_state, discipline, diagnosis_codes (semicolon-separated), requested_visits, plan_id, provider_notes
        </div>

        {error && <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, color: '#dc2626', fontFamily: "'Public Sans', sans-serif" }}>{error}</div>}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSubmit} disabled={loading || !csv.trim()}
            style={{ padding: '9px 20px', background: loading ? '#94a3b8' : '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'Public Sans', sans-serif" }}>
            {loading ? 'Importing…' : 'Run Import'}
          </button>
        </div>
      </div>

      {result && (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
            {[['Imported', result.imported, '#16a34a', '#f0fdf4'], ['Skipped', result.skipped, '#d97706', '#fffbeb'], ['Errors', result.errors, '#dc2626', '#fef2f2']].map(([label, val, color, bg]) => (
              <div key={label} style={{ padding: '12px 20px', background: bg, borderRadius: 8, textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                <div style={{ fontSize: 11, color, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {result.results.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontFamily: "'DM Sans', sans-serif", alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: r.status === 'imported' ? '#16a34a' : r.status === 'skipped' ? '#d97706' : '#dc2626' }}>{r.status === 'imported' ? '✓' : '!'}</span>
                <span style={{ color: '#374151' }}>Row {r.row} — {r.memberName || '(no name)'}</span>
                {r.submissionId && <span style={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: 11 }}>{r.submissionId}</span>}
                {r.reason && <span style={{ color: '#dc2626' }}>{r.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT VIEW (Phase 27)
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = ['reviewer', 'provider', 'master', 'medical_director'];
const DISCS = ['PT', 'OT', 'ST'];

function UserManagementView({ token }) {
  const [users,   setUsers]   = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [form,    setForm]    = React.useState({ email: '', password: '', fullName: '', role: 'reviewer', discipline: 'PT', allowedDisciplines: ['PT'] });
  const [editing, setEditing] = React.useState(null);
  const [toast,   setToast]   = React.useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const fetchUsers = () => {
    axios.get(`${API_BASE}/v1/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setUsers(r.data.users || []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  React.useEffect(() => { fetchUsers(); }, [token]); // eslint-disable-line

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/v1/admin/users`, form, { headers: { Authorization: `Bearer ${token}` } });
      setForm({ email: '', password: '', fullName: '', role: 'reviewer', discipline: 'PT', allowedDisciplines: ['PT'] });
      fetchUsers(); showToast('User created.');
    } catch (err) { showToast(err.response?.data?.error || 'Failed to create user.'); }
  };

  const handleToggleActive = async (u) => {
    await axios.patch(`${API_BASE}/v1/admin/users/${u.id}`, { isActive: !u.is_active }, { headers: { Authorization: `Bearer ${token}` } });
    fetchUsers(); showToast(u.is_active ? 'User deactivated.' : 'User reactivated.');
  };

  const handleSaveEdit = async () => {
    try {
      await axios.patch(`${API_BASE}/v1/admin/users/${editing.id}`, { role: editing.role, discipline: editing.discipline, allowedDisciplines: editing.allowed_disciplines, fullName: editing.full_name }, { headers: { Authorization: `Bearer ${token}` } });
      setEditing(null); fetchUsers(); showToast('User updated.');
    } catch (err) { showToast(err.response?.data?.error || 'Failed to update.'); }
  };

  const roleColor = (r) => ({ reviewer: '#1d4ed8', provider: '#15803d', master: '#0d1b2a', medical_director: '#7c3aed' }[r] || '#374151');
  const inputS = { padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, fontFamily: "'DM Sans', sans-serif", width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 24px' }}>
      {toast && <div style={{ position: 'fixed', top: 20, right: 24, background: '#1e293b', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 9999, fontFamily: "'Public Sans', sans-serif" }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>User Management</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>Create accounts, assign roles and disciplines, activate/deactivate users</div>
      </div>

      {/* User list */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 140px 80px', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: "'DM Sans', sans-serif" }}>
          <span>User</span><span>Role</span><span>Disc.</span><span>Disciplines</span><span>Status</span>
        </div>
        {loading ? <div style={{ padding: 20, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>Loading…</div> :
          users.map(u => (
            <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 140px 80px', padding: '11px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 12, fontFamily: "'DM Sans', sans-serif', opacity: u.is_active ? 1 : 0.5" }}>
              <div>
                <div style={{ fontWeight: 600, color: '#1e293b', fontFamily: "'Public Sans', sans-serif" }}>{u.full_name || '—'}</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{u.email}</div>
              </div>
              {editing?.id === u.id ? (
                <>
                  <select value={editing.role} onChange={e => setEditing(x => ({...x, role: e.target.value}))} style={{ ...inputS, width: 'auto' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={editing.discipline || ''} onChange={e => setEditing(x => ({...x, discipline: e.target.value || null}))} style={{ ...inputS, width: 'auto' }}>
                    <option value="">—</option>{DISCS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {DISCS.map(d => <label key={d} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}><input type="checkbox" checked={(editing.allowed_disciplines||[]).includes(d)} onChange={e => setEditing(x => ({ ...x, allowed_disciplines: e.target.checked ? [...(x.allowed_disciplines||[]), d] : (x.allowed_disciplines||[]).filter(v => v !== d) }))} />{d}</label>)}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={handleSaveEdit} style={{ padding: '3px 8px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditing(null)} style={{ padding: '3px 8px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ padding: '2px 8px', borderRadius: 10, background: '#f0f4ff', color: roleColor(u.role), fontWeight: 700, fontSize: 10, width: 'fit-content' }}>{u.role}</span>
                  <span>{u.discipline || '—'}</span>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{(u.allowed_disciplines||[]).map(d => <span key={d} style={{ padding: '1px 5px', background: '#eff6ff', color: '#1a3a5c', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{d}</span>)}</div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: u.is_active ? '#16a34a' : '#9ca3af', fontSize: 10 }}>{u.is_active ? 'Active' : 'Inactive'}</span>
                    <button onClick={() => setEditing({...u})} style={{ padding: '2px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => handleToggleActive(u)} style={{ padding: '2px 7px', background: u.is_active ? '#fef2f2' : '#f0fdf4', color: u.is_active ? '#dc2626' : '#16a34a', border: `1px solid ${u.is_active ? '#fca5a5' : '#86efac'}`, borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </>
              )}
            </div>
          ))}
      </div>

      {/* Create user form */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #f1f5f9' }}>Create New User</div>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 14px' }}>
          {[['Email', 'email', 'email', 'reviewer@example.com'], ['Password', 'password', 'password', 'Min 8 chars'], ['Full Name', 'fullName', 'text', 'Dr. Jane Doe']].map(([label, key, type, ph]) => (
            <div key={key}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
              <input type={type} value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} placeholder={ph} style={inputS} required={key !== 'fullName'} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Role</div>
            <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} style={inputS}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Primary Discipline</div>
            <select value={form.discipline} onChange={e => setForm(f => ({...f, discipline: e.target.value}))} style={inputS}>
              <option value="">None</option>{DISCS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>Allowed Disciplines</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {DISCS.map(d => <label key={d} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={form.allowedDisciplines.includes(d)} onChange={e => setForm(f => ({ ...f, allowedDisciplines: e.target.checked ? [...f.allowedDisciplines, d] : f.allowedDisciplines.filter(v => v !== d) }))} />{d}</label>)}
            </div>
          </div>
          <div style={{ gridColumn: '1 / 4', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="submit" style={{ padding: '9px 20px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Public Sans', sans-serif" }}>Create User</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EXPORT & COMPLIANCE VIEW (Phase 28)
// ─────────────────────────────────────────────────────────────────────────────
function AuditExportView({ token }) {
  const [summary, setSummary] = React.useState(null);
  const [startDate, setStartDate] = React.useState('');
  const [endDate,   setEndDate]   = React.useState('');
  const [loading,   setLoading]   = React.useState(true);

  const fetchSummary = (s, e) => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/compliance-summary`, {
      params: { ...(s ? { startDate: s } : {}), ...(e ? { endDate: e } : {}) },
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => { setSummary(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchSummary('', ''); }, [token]); // eslint-disable-line

  const handleExport = async () => {
    const params = new URLSearchParams({ ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
    const r = await axios.get(`${API_BASE}/v1/audit-export?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob',
    });
    const blob = new Blob([r.data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cogentcr-audit-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputS = { padding: '7px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: "'DM Sans', sans-serif" };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Audit Export & Compliance</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>HIPAA-ready audit trail export and compliance metrics</div>
      </div>

      {/* Date filter + export */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>From</div><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputS} /></div>
        <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>To</div><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputS} /></div>
        <button onClick={() => fetchSummary(startDate, endDate)} style={{ ...inputS, background: '#f8fafc', color: '#1a3a5c', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>Update</button>
        <button onClick={handleExport} style={{ ...inputS, background: '#1a3a5c', color: '#fff', fontWeight: 600, cursor: 'pointer', border: 'none', fontSize: 12 }}>Download Audit CSV</button>
      </div>

      {/* Compliance summary cards */}
      {loading ? <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</div> : summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
            {[
              ['Total Cases',     summary.totalCases,    '#1a3a5c', '#eff6ff'],
              ['Approved',        summary.totalApproved, '#16a34a', '#f0fdf4'],
              ['Adverse',         summary.totalAdverse,  '#dc2626', '#fef2f2'],
              ['Avg TAT (hrs)',   summary.avgTatHours,   '#d97706', '#fffbeb'],
            ].map(([label, val, color, bg]) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: '16px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                <div style={{ fontSize: 11, color, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              ['Adverse Rate',    `${summary.adverseRate}%`,  '#dc2626', '#fef2f2'],
              ['Appeals Filed',   summary.totalAppeals,       '#6d28d9', '#f5f3ff'],
              ['Overturned',      summary.overturned,         '#d97706', '#fffbeb'],
              ['Audit Entries',   summary.auditEntries,       '#374151', '#f8fafc'],
            ].map(([label, val, color, bg]) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: '16px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                <div style={{ fontSize: 11, color, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE RULES BAR + VIEW (Phase 23)
// ─────────────────────────────────────────────────────────────────────────────
const RULE_TYPE_META = {
  direct_access:       { label: "Direct Access",    color: "#15803d", bg: "#f0fdf4", border: "#86efac" },
  appeal_std_days:     { label: "Std Appeal",       color: "#1d4ed8", bg: "#eff6ff", border: "#93c5fd" },
  urgent_appeal_hours: { label: "Urgent Appeal",    color: "#6d28d9", bg: "#f5f3ff", border: "#c4b5fd" },
  autism_mandate:      { label: "Autism Mandate",   color: "#c2410c", bg: "#fff7ed", border: "#fdba74" },
  telehealth_parity:   { label: "Telehealth",       color: "#0e7490", bg: "#ecfeff", border: "#67e8f9" },
  visit_limit:         { label: "Visit Limit",      color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
};

function StateRulesBar({ state, discipline, token }) {
  const [rules, setRules] = React.useState([]);

  React.useEffect(() => {
    if (!state || state === "—") return;
    axios.get(`${API_BASE}/v1/state-rules`, {
      params: { state, discipline },
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => setRules(r.data.rules || []))
      .catch(() => {});
  }, [state, discipline, token]); // eslint-disable-line

  if (!rules.length) return null;

  // Show up to 3 most relevant rules
  const priority = ["direct_access","appeal_std_days","urgent_appeal_hours","autism_mandate","telehealth_parity"];
  const sorted = [...rules].sort((a, b) => {
    const ai = priority.indexOf(a.rule_type); const bi = priority.indexOf(b.rule_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  }).slice(0, 3);

  return (
    <div style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "7px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>{state} Rules</span>
      {sorted.map(r => {
        const m = RULE_TYPE_META[r.rule_type] || { label: r.rule_type, color: "#374151", bg: "#f1f5f9", border: "#cbd5e1" };
        const detail = r.rule_type === "appeal_std_days" ? ` · ${r.value_days}d` : r.rule_type === "urgent_appeal_hours" ? ` · ${r.value_hours}h` : "";
        return (
          <span key={r.id} title={r.summary} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: m.bg, color: m.color, border: `1px solid ${m.border}`, fontFamily: "'DM Sans', sans-serif", cursor: "default" }}>
            {m.label}{detail}
          </span>
        );
      })}
    </div>
  );
}

function StateRulesView({ token }) {
  const [stateFilter, setStateFilter] = React.useState("");
  const [discFilter,  setDiscFilter]  = React.useState("");
  const [rules,       setRules]       = React.useState([]);
  const [loading,     setLoading]     = React.useState(false);

  const STATES = ["AZ","CA","CO","FL","GA","IL","MA","MI","NC","NJ","NY","OH","PA","TX","WA"];

  const fetchRules = (s, d) => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/state-rules`, {
      params: { ...(s ? { state: s } : {}), ...(d ? { discipline: d } : {}) },
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { setRules(r.data.rules || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchRules("", ""); }, [token]); // eslint-disable-line

  const handleState = (v) => { setStateFilter(v); fetchRules(v, discFilter); };
  const handleDisc  = (v) => { setDiscFilter(v);  fetchRules(stateFilter, v); };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>State-Specific Rules</div>
        <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>Direct access laws, appeal timeframes, and coverage mandates by state</div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <select value={stateFilter} onChange={e => handleState(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", cursor: "pointer" }}>
          <option value="">All States</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={discFilter} onChange={e => handleDisc(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", cursor: "pointer" }}>
          <option value="">All Disciplines</option>
          <option value="PT">PT</option>
          <option value="OT">OT</option>
          <option value="ST">ST</option>
        </select>
      </div>

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "50px 60px 140px 1fr 200px", padding: "10px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>
          <span>State</span><span>Disc.</span><span>Rule Type</span><span>Summary</span><span>Citation</span>
        </div>
        {loading ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Loading…</div>
        ) : rules.length === 0 ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No rules found — run POST /v1/_migrate-state-rules to seed data.</div>
        ) : rules.map(r => {
          const m = RULE_TYPE_META[r.rule_type] || { label: r.rule_type, color: "#374151", bg: "#f1f5f9", border: "#cbd5e1" };
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "50px 60px 140px 1fr 200px", padding: "11px 16px", borderBottom: "1px solid #f1f5f9", alignItems: "start", fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
              <span style={{ fontWeight: 700, color: "#1e293b" }}>{r.state}</span>
              <span style={{ padding: "2px 7px", borderRadius: 5, background: "#eff6ff", color: "#1a3a5c", fontSize: 10, fontWeight: 700, width: "fit-content" }}>{r.discipline}</span>
              <span style={{ padding: "2px 8px", borderRadius: 10, background: m.bg, color: m.color, border: `1px solid ${m.border}`, fontSize: 10, fontWeight: 700, width: "fit-content" }}>{m.label}</span>
              <span style={{ color: "#374151", lineHeight: 1.5 }}>{r.summary}</span>
              <span style={{ color: "#9ca3af", fontSize: 11 }}>{r.citation || "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIA LIBRARY (Phase 20)
// ─────────────────────────────────────────────────────────────────────────────
function CriteriaLibraryView({ token }) {
  const [query,      setQuery]      = useState("");
  const [discipline, setDisc]       = useState("");
  const [results,    setResults]    = useState(null);
  const [selected,   setSelected]   = useState(null);
  const [detail,     setDetail]     = useState(null);
  const [loading,    setLoading]    = useState(false);

  const search = async () => {
    setLoading(true);
    setSelected(null);
    setDetail(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (discipline) params.set("discipline", discipline);
      const res = await axios.get(`${API_BASE}/v1/criteria?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setResults(res.data);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  const loadDetail = async (row) => {
    setSelected(row);
    setDetail(null);
    try {
      const res = await axios.get(`${API_BASE}/v1/criteria/${row.id}`, { headers: { Authorization: `Bearer ${token}` } });
      setDetail(res.data);
    } catch { setDetail(row); }
  };

  useEffect(() => { search(); }, []); // eslint-disable-line

  const DISC_TABS = [["","All"], ["PT","PT"], ["OT","OT"], ["ST","ST"]];

  const ex = detail?.criteria_json || {};
  const mcg = ex.mcg || {};
  const cpg = ex.cpg || {};
  const freqBySev = ex.frequency_by_severity || {};
  const severityRows = Object.entries(freqBySev);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 49px)", overflow: "hidden" }}>

      {/* ── Left: search + list ── */}
      <div style={{ width: 360, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
        {/* Search bar */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search()}
              placeholder="ICD-10 code or keyword…"
              style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: 7, padding: "7px 11px", fontSize: 13, fontFamily: "'Public Sans', sans-serif", outline: "none" }}
            />
            <button onClick={search} disabled={loading}
              style={{ padding: "7px 14px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
              {loading ? "…" : "Search"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {DISC_TABS.map(([v, label]) => (
              <button key={v} onClick={() => { setDisc(v); }}
                style={{ padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: "1.5px solid", fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
                  background: discipline === v ? "#1a3a5c" : "transparent",
                  color: discipline === v ? "#fff" : "#64748b",
                  borderColor: discipline === v ? "#1a3a5c" : "#d1d5db" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Results list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results === null && <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading…</div>}
          {results?.length === 0 && <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>No results. Try a different search.</div>}
          {results?.map(row => {
            const discColor = row.discipline === "OT" ? "#c2410c" : row.discipline === "ST" ? "#15803d" : "#1a3a5c";
            const isActive = selected?.id === row.id;
            return (
              <div key={row.id} onClick={() => loadDetail(row)}
                style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
                  background: isActive ? "#eff6ff" : "transparent",
                  borderLeft: isActive ? "3px solid #1a3a5c" : "3px solid transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ background: discColor, color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, fontFamily: "'DM Sans', sans-serif" }}>{row.discipline}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1a3a5c", fontFamily: "'DM Sans', sans-serif" }}>{row.code}</span>
                  {row.is_custom && <span style={{ fontSize: 9, fontWeight: 700, color: "#7c3aed", background: "#ede9fe", padding: "1px 5px", borderRadius: 4, fontFamily: "'DM Sans', sans-serif" }}>CUSTOM</span>}
                </div>
                <div style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", lineHeight: 1.4 }}>{row.condition_label || row.description}</div>
                {(row.typical_visits_min || row.typical_visits_max) && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontFamily: "'Public Sans', sans-serif" }}>
                    Typical: {row.typical_visits_min}–{row.typical_visits_max} visits
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {results !== null && <div style={{ padding: "8px 16px", fontSize: 11, color: "#9ca3af", borderTop: "1px solid #f1f5f9", fontFamily: "'Public Sans', sans-serif" }}>{results.length} result{results.length !== 1 ? "s" : ""}</div>}
      </div>

      {/* ── Right: detail panel ── */}
      <div style={{ flex: 1, overflowY: "auto", background: "#f8fafc", padding: selected ? "24px 28px" : 0 }}>
        {!selected && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <div style={{ fontSize: 36 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", fontFamily: "'Fraunces', Georgia, serif" }}>Select a criteria entry</div>
            <div style={{ fontSize: 13, color: "#cbd5e1", fontFamily: "'Public Sans', sans-serif" }}>Search for a diagnosis code or condition</div>
          </div>
        )}
        {selected && !detail && <div style={{ padding: 32, color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading…</div>}
        {selected && detail && (() => {
          const discColor = selected.discipline === "OT" ? "#c2410c" : selected.discipline === "ST" ? "#15803d" : "#1a3a5c";
          const SectionHead = ({ children }) => (
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280", fontFamily: "'DM Sans', sans-serif", marginBottom: 8, marginTop: 20 }}>{children}</div>
          );
          const Card = ({ children, style }) => (
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "14px 18px", ...style }}>{children}</div>
          );
          return (
            <div style={{ maxWidth: 760 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ background: discColor, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, fontFamily: "'DM Sans', sans-serif" }}>{selected.discipline}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'DM Sans', sans-serif" }}>{selected.code}</span>
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>{selected.source}</span>
                    {selected.is_custom && <span style={{ fontSize: 10, color: "#7c3aed", background: "#ede9fe", padding: "1px 6px", borderRadius: 4, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>CUSTOM</span>}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.2 }}>{selected.condition_label || selected.description}</div>
                  {ex.description && ex.description !== selected.condition_label && (
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>{ex.description}</div>
                  )}
                </div>
              </div>

              {/* MCG benchmarks */}
              {(mcg.typical_visits || mcg.median_visits) && (
                <>
                  <SectionHead>MCG Visit Benchmarks</SectionHead>
                  <Card>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px 0" }}>
                      {[
                        ["Typical", mcg.typical_visits],
                        ["Median",  mcg.median_visits],
                        ["P75",     mcg.p75_visits],
                        ["Episode Max", mcg.max_visits_episode],
                      ].filter(([,v]) => v).map(([label, val]) => (
                        <div key={label} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                          <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    {mcg.notes && <div style={{ marginTop: 12, fontSize: 12, color: "#4b5563", fontFamily: "'Public Sans', sans-serif", lineHeight: 1.6, borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>{mcg.notes}</div>}
                  </Card>
                </>
              )}

              {/* Frequency by severity */}
              {severityRows.length > 0 && (
                <>
                  <SectionHead>Frequency by Severity</SectionHead>
                  <Card style={{ padding: 0, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'Public Sans', sans-serif" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          {["Severity","Frequency","Duration","Total Visits"].map(h => (
                            <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {severityRows.map(([sev, data], i) => (
                          <tr key={sev} style={{ borderBottom: i < severityRows.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                            <td style={{ padding: "8px 14px", fontWeight: 600, color: "#374151", textTransform: "capitalize" }}>{sev.replace(/_/g, " ")}</td>
                            <td style={{ padding: "8px 14px", color: "#1a3a5c", fontWeight: 600 }}>{data.max_freq} {data.unit}</td>
                            <td style={{ padding: "8px 14px", color: "#374151" }}>{data.duration_weeks} wks</td>
                            <td style={{ padding: "8px 14px", color: "#374151" }}>{data.total_visits}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </>
              )}

              {/* CPG info */}
              {(cpg.primary || cpg.key_recommendations) && (
                <>
                  <SectionHead>Clinical Practice Guideline</SectionHead>
                  <Card>
                    {cpg.primary && <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif", marginBottom: 6 }}>{cpg.primary}</div>}
                    {cpg.evidence_level && <span style={{ fontSize: 11, background: "#dcfce7", color: "#15803d", borderRadius: 5, padding: "2px 8px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>{cpg.evidence_level}</span>}
                    {cpg.key_recommendations?.length > 0 && (
                      <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px" }}>
                        {cpg.key_recommendations.map((r, i) => <li key={i} style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5 }}>{r}</li>)}
                      </ul>
                    )}
                    {cpg.citation && <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif", fontStyle: "italic" }}>{cpg.citation}</div>}
                  </Card>
                </>
              )}

              {/* Red flags */}
              {ex.red_flags?.length > 0 && (
                <>
                  <SectionHead>Red Flags</SectionHead>
                  <Card style={{ background: "#fff7ed", borderColor: "#fed7aa" }}>
                    <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
                      {ex.red_flags.map((f, i) => <li key={i} style={{ fontSize: 12, color: "#c2410c", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5, fontWeight: 500 }}>{f}</li>)}
                    </ul>
                  </Card>
                </>
              )}

              {/* Skilled care indicators */}
              {ex.skilled_care_indicators?.length > 0 && (
                <>
                  <SectionHead>Skilled Care Indicators</SectionHead>
                  <Card>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ex.skilled_care_indicators.map((s, i) => (
                        <span key={i} style={{ background: "#eff6ff", color: "#1a3a5c", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{s}</span>
                      ))}
                    </div>
                  </Card>
                </>
              )}

              {/* LOS triggers */}
              {ex.los_triggers?.length > 0 && (
                <>
                  <SectionHead>Discharge / LOS Triggers</SectionHead>
                  <Card>
                    <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
                      {ex.los_triggers.map((t, i) => <li key={i} style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5 }}>{t}</li>)}
                    </ul>
                  </Card>
                </>
              )}

              {/* Special considerations */}
              {ex.special_considerations?.length > 0 && (
                <>
                  <SectionHead>Special Considerations</SectionHead>
                  <Card>
                    <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
                      {ex.special_considerations.map((s, i) => <li key={i} style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5 }}>{s}</li>)}
                    </ul>
                  </Card>
                </>
              )}

              <div style={{ height: 40 }} />
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER SHELL
// ─────────────────────────────────────────────────────────────────────────────
function ReviewerShell({ user, token, onLogout }) {
  const [revView, setRevView]               = useState("home");
  const [assignedCase, setAssignedCase]     = useState(null);
  const [queueStats, setQueueStats]         = useState(null);
  const [getCaseLoading, setGetCaseLoading] = useState(false);
  const [getCaseError, setGetCaseError]     = useState("");
  const [toolsOpen, setToolsOpen]           = useState(false);
  const [exitModal, setExitModal]           = useState(false); // "hold"|"release"|false
  const [exitReason, setExitReason]         = useState("");
  const [exitLoading, setExitLoading]       = useState(false);
  const [exitError, setExitError]           = useState("");
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
          memberState:    sub.member_state || null,
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
      const serverMsg = err.response?.data?.error;
      const status    = err.response?.status;
      if (serverMsg) {
        setGetCaseError(`Server error (${status}): ${serverMsg}`);
      } else if (err.request) {
        setGetCaseError("Could not reach server — check your connection or try again.");
      } else {
        setGetCaseError(`Unexpected error: ${err.message}`);
      }
    } finally {
      setGetCaseLoading(false);
    }
  };

  const handleCaseDone = () => {
    setAssignedCase(null);
    setRevView("home");
    setExitModal(false);
    setExitReason("");
    setExitError("");
  };

  const handleOpenSearchCase = (sub) => {
    const diags = Array.isArray(sub.diagnosis_codes) ? sub.diagnosis_codes : [];
    setAssignedCase({
      caseId:         sub.submission_id,
      memberName:     sub.member_name    || "Unknown Member",
      memberId:       sub.member_id      || "—",
      memberState:    sub.member_state   || null,
      dob:            sub.dob            || "—",
      discipline:     sub.discipline     || user.discipline || "PT",
      reviewType:     "initial",
      submittedAt:    sub.submitted_at,
      receivedAt:     sub.received_at    || sub.submitted_at,
      reviewPriority: sub.review_priority || "standard",
      rmiSentAt:      sub.rmi_sent_at    || null,
      rmiRespondedAt: sub.rmi_responded_at || null,
      documents:      sub.document_list  || [],
      metrics: {
        primaryDiagnosisCode: diags[0]    || null,
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
  };

  const handleHoldCase = async () => {
    if (!exitReason.trim()) { setExitError("Please enter a hold reason."); return; }
    setExitLoading(true); setExitError("");
    try {
      await axios.patch(
        `${API_BASE}/v1/submissions/${assignedCase.caseId}/hold`,
        { reason: exitReason.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      handleCaseDone();
    } catch (err) {
      setExitError(err.response?.data?.error || "Failed to hold case.");
      setExitLoading(false);
    }
  };

  const handleReleaseCase = async () => {
    if (!exitReason.trim()) { setExitError("Please enter a reason."); return; }
    setExitLoading(true); setExitError("");
    try {
      await axios.patch(
        `${API_BASE}/v1/submissions/${assignedCase.caseId}/release`,
        { reason: exitReason.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      handleCaseDone();
    } catch (err) {
      setExitError(err.response?.data?.error || "Failed to release case.");
      setExitLoading(false);
    }
  };

  const discLabel = user.discipline || "PT";
  const pendingCount = queueStats
    ? (queueStats.byDiscipline || []).filter(d => d.discipline === discLabel).reduce((s, r) => s + parseInt(r.count), 0)
    : null;

  // ── shared nav items ──
  const PRIMARY_TABS = [
    assignedCase ? ["cockpit", "★ Case Review"] : ["home", "Get Case"],
    ["search", "Search"],
    ["my_stats", "My Stats"],
    ["p2p", "P2P"],
    ["appeals", "Appeals"],
    ["criteria", "Criteria"],
    ["state_rules", "State Rules"],
  ];

  const NavBar = () => (
    <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", alignItems: "center", gap: 0, flexShrink: 0, position: "relative" }}>
      {PRIMARY_TABS.map(([v, label]) => (
        <button key={v} onClick={() => setRevView(v)} style={{
          padding: "12px 18px", fontSize: 13,
          fontWeight: revView === v ? 700 : 500,
          color: v === "cockpit" ? (revView === v ? "#1a3a5c" : "#c2410c") : (revView === v ? "#1a3a5c" : "#6b7280"),
          background: "none", border: "none",
          borderBottom: revView === v ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
          cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
          whiteSpace: "nowrap",
        }}>{label}</button>
      ))}
      <div style={{ flex: 1 }} />
      {/* Tools dropdown */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setToolsOpen(o => !o)}
          style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#6b7280", background: toolsOpen ? "#f1f5f9" : "none", border: "1px solid " + (toolsOpen ? "#e2e8f0" : "transparent"), borderRadius: 7, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", display: "flex", alignItems: "center", gap: 5 }}
        >
          Tools <span style={{ fontSize: 10 }}>▾</span>
        </button>
        {toolsOpen && (
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 200, minWidth: 180, overflow: "hidden" }}
            onMouseLeave={() => setToolsOpen(false)}>
            {[["ur_form", "UR Review Form"], ["criteria", "Criteria Library"], ["state_rules", "State Rules"]].map(([v, label]) => (
              <button key={v} onClick={() => { setRevView(v); setToolsOpen(false); }} style={{
                display: "block", width: "100%", textAlign: "left", padding: "11px 18px",
                fontSize: 13, color: "#374151", background: revView === v ? "#f1f5f9" : "#fff",
                border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif",
                fontWeight: revView === v ? 700 : 400,
                borderBottom: "1px solid #f1f5f9",
              }}>{label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const Header = () => (
    <div style={{ background: "#1a3a5c", padding: "12px 28px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.02em" }}>CogentCR</span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>|</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.75)", fontFamily: "'Public Sans', sans-serif" }}>Reviewer Portal</span>
      <div style={{ flex: 1 }} />
      {assignedCase && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 8, background: "rgba(251,191,36,0.18)", border: "1px solid rgba(251,191,36,0.4)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", display: "inline-block", animation: "rsPulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", fontFamily: "'Public Sans', sans-serif" }}>Case in review</span>
          <span style={{ fontSize: 11, color: "rgba(251,191,36,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{assignedCase.memberName}</span>
        </div>
      )}
      <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12, background: DISC_COLOR, color: "#fff", border: "1.5px solid rgba(255,255,255,0.3)" }}>{discLabel}</span>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
      <NotificationBell token={token} />
      <button onClick={onLogout} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Logout</button>
    </div>
  );

  // ── Exit-case modal (Hold / Release) ──
  const ExitModal = () => exitModal && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 6 }}>
          {exitModal === "hold" ? "Place Case on Hold" : "Return Case to Queue"}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 18, fontFamily: "'Public Sans', sans-serif", lineHeight: 1.5 }}>
          {exitModal === "hold"
            ? "Case will be held for 1 business day then automatically returned to the queue."
            : "Case will be returned to the queue immediately and available for any reviewer."}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Public Sans', sans-serif" }}>
          {exitModal === "hold" ? "Reason for hold" : "Reason for return"}
          <span style={{ color: "#dc2626" }}> *</span>
        </div>
        <textarea
          autoFocus
          value={exitReason}
          onChange={e => { setExitReason(e.target.value); setExitError(""); }}
          placeholder={exitModal === "hold"
            ? "e.g. Awaiting additional documentation from provider before completing review..."
            : "e.g. Outside scope of reviewer's discipline — returning to general queue..."}
          rows={3}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.5 }}
        />
        {exitError && <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626", fontFamily: "'Public Sans', sans-serif" }}>{exitError}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={exitModal === "hold" ? handleHoldCase : handleReleaseCase}
            disabled={exitLoading}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 8, border: "none",
              background: exitModal === "hold" ? "#1d4ed8" : "#dc2626",
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: exitLoading ? "not-allowed" : "pointer",
              fontFamily: "'Public Sans', sans-serif", opacity: exitLoading ? 0.6 : 1,
            }}
          >{exitLoading ? "Saving..." : exitModal === "hold" ? "Confirm Hold" : "Return to Queue"}</button>
          <button
            onClick={() => { setExitModal(false); setExitReason(""); setExitError(""); }}
            style={{ padding: "11px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── Cockpit view (kept mounted while case active to preserve state) ──
  const cockpitVisible = revView === "cockpit" && !!assignedCase;

  // ── single unified return ──
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Public Sans', system-ui, sans-serif", background: "#f1f5f9" }}>
      <style>{`
        @keyframes rsPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
      <Header />
      <NavBar />
      <ExitModal />

      {/* Cockpit — kept mounted while case is active; hidden when on another tab */}
      {assignedCase && (
        <div style={{ display: cockpitVisible ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <EpisodeContextBar memberId={assignedCase.memberId} discipline={assignedCase.discipline} token={token} />
          <StateRulesBar state={assignedCase.memberState} discipline={assignedCase.discipline} token={token} />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Cockpit
              user={user}
              liveCase={assignedCase}
              hideQueueNav={true}
              onCaseDone={handleCaseDone}
              onHoldCase={() => { setExitReason(""); setExitError(""); setExitModal("hold"); }}
              onReleaseCase={() => { setExitReason(""); setExitError(""); setExitModal("release"); }}
            />
          </div>
        </div>
      )}

      {/* All other views */}
      <div style={{ display: cockpitVisible ? "none" : "flex", flex: 1, flexDirection: "column", overflow: "auto" }}>

        {/* Home / Get Case */}
        {revView === "home" && (
          <div style={{ maxWidth: 520, margin: "60px auto", padding: "0 24px", width: "100%" }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "52px 40px 44px", boxShadow: "0 4px 24px rgba(26,58,92,0.13)", border: "1px solid #dde4ef", textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280", marginBottom: 12 }}>{discLabel} Reviewer</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.1, marginBottom: 10 }}>Ready to review?</div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 36, lineHeight: 1.5 }}>Cases are assigned by priority and submission age.<br />Click below to get your next case.</div>
              <button onClick={handleGetCase} disabled={getCaseLoading} style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "16px 56px", borderRadius: 12, background: getCaseLoading ? "#94a3b8" : "#1a3a5c", color: "#fff", fontSize: 18, fontWeight: 700, border: "none", cursor: getCaseLoading ? "not-allowed" : "pointer", boxShadow: getCaseLoading ? "none" : "0 6px 20px rgba(26,58,92,0.38)", transition: "all 0.15s", letterSpacing: "-0.01em" }}>
                {getCaseLoading ? "Finding case…" : "Get Case"}
              </button>
              {getCaseError && <div style={{ marginTop: 18, fontSize: 13, color: "#dc2626" }}>{getCaseError}</div>}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { label: "Pending in your queue", value: pendingCount !== null ? pendingCount : "—", color: pendingCount > 0 ? "#1a3a5c" : "#9ca3af" },
                { label: "Completed today", value: queueStats?.casesToday ?? "—", color: "#15803d" },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: s.color, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 5 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {revView === "search"      && <CaseSearchView token={token} onOpenCase={handleOpenSearchCase} />}
        {revView === "my_stats"    && <ReviewerDashboard token={token} user={user} />}
        {revView === "p2p"         && <><div style={{ padding: "18px 24px 0" }}><ReviewerScheduleSettings token={token} /></div><P2PQueueView token={token} /></>}
        {revView === "appeals"     && <AppealsQueueView token={token} />}
        {revView === "criteria"    && <CriteriaLibraryView token={token} />}
        {revView === "state_rules" && <StateRulesView token={token} />}
        {revView === "ur_form"     && <URFormEmbed user={user} token={token} />}

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
function CaseSearchView({ token, onOpenCase }) {
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 130px 110px 60px 90px", gap: 0, padding: "8px 20px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                {["Member", "Case ID", "Disc.", "Status", "Submitted", "Score", ""].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif" }}>{h}</span>
                ))}
              </div>
              {results.map(r => {
                const sc = statusColor(r.status);
                const dc = discColor(r.discipline);
                return (
                  <div key={r.submission_id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 130px 110px 60px 90px", gap: 0, padding: "10px 20px", borderBottom: "1px solid #f1f5f9", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{r.member_name || "—"}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1, fontFamily: "'DM Sans', monospace" }}>{r.member_id || "—"}</div>
                    </div>
                    <span style={{ fontSize: 11, color: "#374151", fontFamily: "monospace" }}>{r.submission_id?.slice(0,12)}…</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: dc.bg, color: dc.text, width: "fit-content", fontFamily: "'DM Sans', sans-serif" }}>{r.discipline || "—"}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: sc.bg, color: sc.text, width: "fit-content", textTransform: "capitalize", fontFamily: "'DM Sans', sans-serif" }}>
                      {(r.status || "submitted").replace(/_/g, " ")}
                    </span>
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: r.completeness_score >= 80 ? "#15803d" : r.completeness_score >= 50 ? "#92400e" : "#6b7280" }}>
                      {r.completeness_score != null ? r.completeness_score + "%" : "—"}
                    </span>
                    {onOpenCase ? (
                      <button onClick={() => onOpenCase(r)} style={{ padding: "5px 12px", borderRadius: 6, background: "#1a3a5c", color: "#fff", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", whiteSpace: "nowrap" }}>
                        Review
                      </button>
                    ) : <span />}
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
  const [memberState,     setMemberState]     = useState("");
  const [discipline,      setDiscipline]      = useState("PT");
  const [diagInput,       setDiagInput]       = useState("");
  const [diagnosisCodes,  setDiagnosisCodes]  = useState([]);
  const [requestedVisits, setRequestedVisits] = useState("");
  const [planId,          setPlanId]          = useState("");
  const [documentNames,   setDocumentNames]   = useState([""]);
  const [providerNotes,   setProviderNotes]   = useState("");
  const [uploadedFiles,   setUploadedFiles]   = useState([]);  // File objects
  const [dragOver,        setDragOver]        = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState("");
  const [plans,           setPlans]           = useState([]);

  useEffect(() => {
    axios.get(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlans(r.data.plans || [])).catch(() => {});
  }, [token]); // eslint-disable-line

  const docList = documentNames.filter(d => d.trim());
  const fields = [
    !!providerName.trim(), !!memberName.trim(), !!memberId.trim(), !!dob, !!discipline,
    diagnosisCodes.length > 0,
    parseInt(requestedVisits) > 0,
    docList.length > 0 || uploadedFiles.length > 0,
  ];
  const completeness = Math.round(fields.filter(Boolean).length / 8 * 100);

  const addDiagCode = () => {
    const code = diagInput.trim().toUpperCase();
    if (code && !diagnosisCodes.includes(code)) setDiagnosisCodes(prev => [...prev, code]);
    setDiagInput("");
  };

  const addFiles = (fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    setUploadedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const newFiles = pdfs.filter(f => !existing.has(f.name));
      return [...prev, ...newFiles].slice(0, 5);
    });
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      let res;
      if (uploadedFiles.length > 0) {
        // Multipart with file upload → AI extraction endpoint
        const fd = new FormData();
        fd.append("providerName", providerName);
        fd.append("providerNpi",  providerNpi);
        fd.append("memberName",   memberName);
        fd.append("memberId",     memberId);
        fd.append("dob",          dob);
        fd.append("memberState",  memberState);
        fd.append("discipline",   discipline);
        fd.append("diagnosisCodes", JSON.stringify(diagnosisCodes));
        fd.append("requestedVisits", requestedVisits);
        fd.append("planId",       planId || "");
        fd.append("documentList", JSON.stringify(docList));
        fd.append("providerNotes", providerNotes);
        uploadedFiles.forEach(f => fd.append("documents", f));
        res = await axios.post(`${API_BASE}/v1/submit-with-docs`, fd, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        // Plain JSON path
        res = await axios.post(`${API_BASE}/v1/submit`, {
          providerName, providerNpi, memberName, memberId, dob, memberState,
          discipline, diagnosisCodes,
          requestedVisits: parseInt(requestedVisits) || 0,
          planId: planId || null, documentList: docList, providerNotes,
        }, { headers: { Authorization: `Bearer ${token}` } });
      }
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
          <div style={{ fontSize: 11, color: "#15803d", marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>Complete — eligible for auto-review on submission</div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: "24px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>

        {/* ── AI Document Upload ── */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
          Clinical Documents
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" }}>AI EXTRACTION</span>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{ border: `2px dashed ${dragOver ? "#1a3a5c" : "#93c5fd"}`, borderRadius: 10, padding: "24px 20px", textAlign: "center", background: dragOver ? "#eff6ff" : "#f8fafc", marginBottom: 12, transition: "all 0.15s", cursor: "pointer" }}
          onClick={() => document.getElementById("doc-upload-input").click()}
        >
          <input id="doc-upload-input" type="file" accept=".pdf,application/pdf" multiple style={{ display: "none" }}
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
          <div style={{ fontSize: 22, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a3a5c", fontFamily: "'Public Sans', sans-serif" }}>
            Drop PDF files here or click to upload
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Clinical notes, evaluations, progress notes — Claude AI extracts diagnosis codes, ROM, goals, and more
          </div>
        </div>
        {uploadedFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {uploadedFiles.map((f, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, background: "#eff6ff", border: "1px solid #93c5fd", fontSize: 12, color: "#1a3a5c" }}>
                📄 {f.name}
                <button onClick={() => setUploadedFiles(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
        )}
        {uploadedFiles.length > 0 && (
          <div style={{ padding: "8px 12px", background: "#f0fdf4", borderRadius: 7, border: "1px solid #86efac", fontSize: 11, color: "#15803d", marginBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>
            ✦ AI will extract diagnosis codes, visit count, clinical findings, and documentation quality on submit. You can still fill fields manually below.
          </div>
        )}

        {/* Provider info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Provider Information</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
          <div>{labelS("Practice / Provider Name")}<input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="e.g. Springfield PT Clinic" style={inputS} /></div>
          <div>
            {labelS("NPI (optional)")}
            <input value={providerNpi} onChange={e => setProviderNpi(e.target.value)} placeholder="1234567890" style={inputS} />
            <NpiLookupWidget npi={providerNpi} token={token} onVerified={name => { if (!providerName) setProviderName(name); }} />
          </div>
        </div>

        {/* Member info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Member Information</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
          <div style={{ gridColumn: "1 / 3" }}>{labelS("Member Name")}<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="First Last (or let AI fill from document)" style={inputS} /></div>
          <div>{labelS("Date of Birth")}<input type="date" value={dob} onChange={e => setDob(e.target.value)} style={inputS} /></div>
          <div>{labelS("Member ID")}<input value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="e.g. XYZ123456" style={inputS} /></div>
          <div>{labelS("Member State")}<input value={memberState} onChange={e => setMemberState(e.target.value.toUpperCase().slice(0,2))} placeholder="e.g. CA" maxLength={2} style={{ ...inputS, textTransform: "uppercase" }} /></div>
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
              placeholder={uploadedFiles.length ? "Leave blank — AI will extract" : "e.g. M54.5 then Enter"} style={{ ...inputS, flex: 1 }} />
            <button onClick={addDiagCode} style={{ padding: "8px 14px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", flexShrink: 0 }}>Add</button>
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
          <div>{labelS("Requested Visits")}<input type="number" min="1" value={requestedVisits} onChange={e => setRequestedVisits(e.target.value)} placeholder={uploadedFiles.length ? "Leave blank — AI will extract" : "e.g. 16"} style={inputS} /></div>
        </div>
        <div style={{ marginBottom: 20 }}>
          {labelS("Clinical Notes (optional)")}
          <textarea value={providerNotes} onChange={e => setProviderNotes(e.target.value)} rows={3} placeholder="Brief clinical context or special circumstances..." style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} />
        </div>

        {/* Additional document names */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Additional Document References</div>
        <div style={{ marginBottom: 20 }}>
          {documentNames.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={d} onChange={e => { const next = [...documentNames]; next[i] = e.target.value; setDocumentNames(next); }}
                placeholder={`e.g. X-ray report, lab results`} style={{ ...inputS, flex: 1 }} />
              {documentNames.length > 1 && (
                <button onClick={() => setDocumentNames(prev => prev.filter((_, j) => j !== i))}
                  style={{ padding: "8px 10px", borderRadius: 7, background: "#fee2e2", color: "#991b1b", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}>×</button>
              )}
            </div>
          ))}
          <button onClick={() => setDocumentNames(prev => [...prev, ""])}
            style={{ fontSize: 12, color: "#1a3a5c", background: "none", border: "1px dashed #93c5fd", borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", marginTop: 2 }}>
            + Add reference
          </button>
        </div>

        {error && <div style={{ marginBottom: 12, padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 7, fontSize: 13, color: "#991b1b" }}>{error}</div>}

        <button onClick={handleSubmit} disabled={loading} style={{
          width: "100%", padding: "13px 0", borderRadius: 9,
          background: loading ? "#94a3b8" : "#1a3a5c",
          color: "#fff", fontSize: 14, fontWeight: 700, border: "none",
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "'Public Sans', sans-serif",
          boxShadow: loading ? "none" : "0 4px 14px rgba(26,58,92,0.25)",
        }}>
          {loading
            ? (uploadedFiles.length ? "Uploading & extracting with AI…" : "Submitting…")
            : `Submit Authorization Request (${completeness}% complete)`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P2P REQUEST MODAL (provider)
// ─────────────────────────────────────────────────────────────────────────────
function P2PRequestModal({ submissionId, memberName, token, onClose, onSuccess }) {
  const [slots, setSlots]       = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [noSchedule, setNoSchedule] = useState(false);
  const [primarySlot, setPrimary]   = useState(null);
  const [secondarySlot, setSecondary] = useState(null);
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState(null);

  const NAVY = "#1a2e4a";

  useEffect(() => {
    fetch(`${API_BASE}/v1/p2p-slots/${submissionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setLoadingSlots(false);
        if (!d.hasSchedule || !d.slots?.length) { setNoSchedule(true); return; }
        setSlots(d.slots);
      })
      .catch(() => { setLoadingSlots(false); setNoSchedule(true); });
  }, [submissionId, token]); // eslint-disable-line

  // Group ISO slots by local date label
  const grouped = slots.reduce((acc, iso) => {
    const d = new Date(iso);
    const key = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(iso);
    return acc;
  }, {});

  const handleSlotClick = (iso) => {
    if (iso === primarySlot) { setPrimary(null); setSecondary(null); return; }
    if (iso === secondarySlot) { setSecondary(null); return; }
    if (!primarySlot) { setPrimary(iso); return; }
    setSecondary(iso);
  };

  const slotLabel = (iso) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const submit = () => {
    if (!primarySlot) { setErr("Please select a primary time slot."); return; }
    setSaving(true); setErr(null);
    fetch(`${API_BASE}/v1/p2p-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ submissionId, primarySlot, secondarySlot: secondarySlot || undefined, clinicalNotes: notes }),
    })
      .then(r => r.json())
      .then(d => {
        setSaving(false);
        if (d.p2pId) onSuccess();
        else setErr(d.error || "Request failed.");
      })
      .catch(() => { setSaving(false); setErr("Network error."); });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 560, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, color: NAVY }}>Request Peer-to-Peer Review</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{memberName}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", padding: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: "#475569", background: "#eff6ff", borderRadius: 8, padding: "10px 14px", marginTop: 14 }}>
            You will speak directly with the reviewing clinician. Select a time from their available schedule — their identity remains confidential.
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "18px 24px", flex: 1 }}>
          {loadingSlots ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Loading available times...</div>
          ) : noSchedule ? (
            <div style={{ textAlign: "center", padding: "32px 16px" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>No schedule available</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>The reviewing clinician has not posted their availability yet. Contact your clinical coordinator to request a peer-to-peer review.</div>
            </div>
          ) : (
            <>
              {/* Selected summary */}
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `2px solid ${primarySlot ? "#1a2e4a" : "#e2e8f0"}`, background: primarySlot ? "#eff6ff" : "#fafafa" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 3 }}>Primary (required)</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: primarySlot ? NAVY : "#94a3b8" }}>
                    {primarySlot ? new Date(primarySlot).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not selected"}
                  </div>
                </div>
                <div style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `2px solid ${secondarySlot ? "#059669" : "#e2e8f0"}`, background: secondarySlot ? "#f0fdf4" : "#fafafa" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 3 }}>Secondary (optional)</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: secondarySlot ? "#059669" : "#94a3b8" }}>
                    {secondarySlot ? new Date(secondarySlot).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not selected"}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
                Click a time to set as primary · Click a second time to set as secondary fallback · Click again to deselect
              </div>
              {/* Slot grid by day */}
              {Object.entries(grouped).map(([date, daySlots]) => (
                <div key={date} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 7 }}>{date}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {daySlots.map(iso => {
                      const isPrimary   = iso === primarySlot;
                      const isSecondary = iso === secondarySlot;
                      return (
                        <button key={iso} onClick={() => handleSlotClick(iso)} style={{
                          padding: "5px 13px", borderRadius: 20, fontSize: 12, fontWeight: isPrimary || isSecondary ? 700 : 400,
                          border: `1.5px solid ${isPrimary ? NAVY : isSecondary ? "#059669" : "#d1d5db"}`,
                          background: isPrimary ? NAVY : isSecondary ? "#059669" : "#fff",
                          color: isPrimary || isSecondary ? "#fff" : "#374151",
                          cursor: "pointer",
                        }}>
                          {slotLabel(iso)}{isPrimary ? " ★" : isSecondary ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* Clinical notes */}
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Clinical Argument (optional but recommended)</div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                  placeholder="Summarize the clinical evidence supporting medical necessity..."
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              </div>
            </>
          )}
          {err && <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{err}</div>}
        </div>

        {/* Footer */}
        {!noSchedule && !loadingSlots && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", cursor: "pointer", fontSize: 13 }}>Cancel</button>
            <button onClick={submit} disabled={saving || !primarySlot}
              style={{ padding: "9px 20px", borderRadius: 7, border: "none", background: NAVY, color: "#fff", cursor: saving || !primarySlot ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, opacity: saving || !primarySlot ? 0.6 : 1 }}>
              {saving ? "Submitting..." : "Submit P2P Request"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER SCHEDULE SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
const TZ_OPTIONS = [
  { value: "America/New_York",    label: "Eastern (ET)" },
  { value: "America/Chicago",     label: "Central (CT)" },
  { value: "America/Denver",      label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Phoenix",     label: "Arizona (no DST)" },
  { value: "America/Anchorage",   label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HST)" },
];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7 AM–7 PM
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function ReviewerScheduleSettings({ token }) {
  const [avail, setAvail]     = useState([]);
  const [tz, setTz]           = useState("America/New_York");
  const [saved, setSaved]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [open, setOpen]       = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/v1/reviewer-schedule`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setAvail(d.availability || []); setTz(d.timezone || "America/New_York"); })
      .catch(() => {});
  }, [token]); // eslint-disable-line

  const toggleDay = (day) => {
    setAvail(prev => {
      const has = prev.find(a => a.day === day);
      return has ? prev.filter(a => a.day !== day) : [...prev, { day, startHour: 9, endHour: 17 }];
    });
  };
  const updateHour = (day, field, val) => {
    setAvail(prev => prev.map(a => a.day === day ? { ...a, [field]: parseInt(val) } : a));
  };

  const save = () => {
    setSaving(true);
    fetch(`${API_BASE}/v1/reviewer-schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ availability: avail, timezone: tz }),
    })
      .then(() => { setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 3000); })
      .catch(() => setSaving(false));
  };

  const NAVY = "#1a2e4a";

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", marginBottom: 18, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "14px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>My Availability Schedule</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {avail.length === 0 ? "No schedule set — providers cannot book P2P calls until you add availability" : `${avail.length} day${avail.length !== 1 ? "s" : ""} set · ${TZ_OPTIONS.find(t => t.value === tz)?.label || tz}`}
          </div>
        </div>
        <span style={{ fontSize: 14, color: "#94a3b8" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 20px 20px", borderTop: "1px solid #f1f5f9" }}>
          <div style={{ marginTop: 14, marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Your Timezone
              <select value={tz} onChange={e => setTz(e.target.value)}
                style={{ display: "block", marginTop: 4, padding: "7px 10px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, background: "#fff" }}>
                {TZ_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Available Days + Hours</div>
          {[1,2,3,4,5,6,0].map(day => {
            const entry = avail.find(a => a.day === day);
            return (
              <div key={day} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, width: 90, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!entry} onChange={() => toggleDay(day)} />
                  {DAY_NAMES[day].slice(0, 3)}
                </label>
                {entry && (
                  <>
                    <select value={entry.startHour} onChange={e => updateHour(day, "startHour", e.target.value)}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}>
                      {HOURS.map(h => <option key={h} value={h}>{h % 12 || 12} {h < 12 ? "AM" : "PM"}</option>)}
                    </select>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>to</span>
                    <select value={entry.endHour} onChange={e => updateHour(day, "endHour", e.target.value)}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}>
                      {HOURS.filter(h => h > entry.startHour).map(h => <option key={h} value={h}>{h % 12 || 12} {h < 12 ? "AM" : "PM"}</option>)}
                    </select>
                  </>
                )}
              </div>
            );
          })}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={save} disabled={saving}
              style={{ padding: "9px 22px", borderRadius: 8, background: NAVY, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving..." : "Save Schedule"}
            </button>
            {saved && <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>✓ Saved — available slots will update immediately</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P2P QUEUE VIEW (reviewer / master)
// ─────────────────────────────────────────────────────────────────────────────
function P2PQueueView({ token }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [panel, setPanel]       = useState(null); // "complete"
  const [outcome, setOutcome]   = useState("upheld");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [newDet, setNewDet]     = useState("Approved");
  const [newVisits, setNewVisits] = useState("");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);

  const NAVY = "#1a2e4a";

  const fetchQueue = () => {
    setLoading(true);
    fetch(`${API_BASE}/v1/p2p-queue`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setRequests(d.requests || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchQueue(); }, []); // eslint-disable-line

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const handleAccept = (slotType) => {
    setSaving(true);
    fetch(`${API_BASE}/v1/p2p-requests/${selected.p2p_id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slot: slotType }),
    })
      .then(r => r.json())
      .then(d => {
        setSaving(false);
        if (d.ok) { showToast("Call confirmed — provider notified."); setSelected(null); fetchQueue(); }
        else showToast("Error: " + d.error);
      })
      .catch(() => { setSaving(false); showToast("Network error."); });
  };

  const handleComplete = () => {
    if (outcome !== "upheld" && !newDet) return;
    setSaving(true);
    fetch(`${API_BASE}/v1/p2p-requests/${selected.p2p_id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        outcome, outcomeNotes,
        newDetermination:  outcome !== "upheld" ? newDet    : undefined,
        newApprovedVisits: outcome !== "upheld" ? parseInt(newVisits, 10) || undefined : undefined,
      }),
    })
      .then(r => r.json())
      .then(d => {
        setSaving(false);
        if (d.ok) { showToast("P2P outcome recorded — provider notified."); setSelected(null); setPanel(null); fetchQueue(); }
        else showToast("Error: " + d.error);
      })
      .catch(() => { setSaving(false); showToast("Network error."); });
  };

  const fmtSlot = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  const pending   = requests.filter(r => r.status === "pending");
  const confirmed = requests.filter(r => r.status === "confirmed");

  return (
    <div style={{ display: "flex", height: "calc(100vh - 110px)" }}>
      {toast && (
        <div style={{ position: "fixed", top: 16, right: 16, background: NAVY, color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{toast}</div>
      )}

      {/* Sidebar list */}
      <div style={{ width: 340, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
        {loading ? (
          <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading...</div>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <div style={{ padding: "12px 20px 6px", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, background: "#fafafa", borderBottom: "1px solid #f1f5f9" }}>
                  Awaiting Your Response · {pending.length}
                </div>
                {pending.map((r, i) => {
                  const isSel = selected?.p2p_id === r.p2p_id;
                  return (
                    <div key={r.p2p_id} onClick={() => { setSelected(r); setPanel(null); setOutcomeNotes(""); setNewVisits(""); }}
                      style={{ padding: "13px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#eff6ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #3b82f6" : "3px solid transparent" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: NAVY }}>{r.member_name || "Unknown"}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: "#fee2e2", color: "#991b1b" }}>PENDING</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{r.discipline} · {r.plan_id}</div>
                      <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, marginTop: 3 }}>Det: {r.last_determination || "—"}</div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Primary: {fmtSlot(r.primary_slot)}</div>
                      {r.secondary_slot && <div style={{ fontSize: 10, color: "#94a3b8" }}>Secondary: {fmtSlot(r.secondary_slot)}</div>}
                    </div>
                  );
                })}
              </>
            )}
            {confirmed.length > 0 && (
              <>
                <div style={{ padding: "12px 20px 6px", fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: 1, background: "#f0fdf4", borderBottom: "1px solid #d1fae5" }}>
                  Upcoming Calls · {confirmed.length}
                </div>
                {confirmed.map((r, i) => {
                  const isSel = selected?.p2p_id === r.p2p_id;
                  return (
                    <div key={r.p2p_id} onClick={() => { setSelected(r); setPanel(null); setOutcomeNotes(""); setNewVisits(""); }}
                      style={{ padding: "13px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#f0fdf4" : "#fff", borderLeft: isSel ? "3px solid #059669" : "3px solid transparent" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: NAVY }}>{r.member_name || "Unknown"}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: "#d1fae5", color: "#065f46" }}>CONFIRMED</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginTop: 4 }}>{fmtSlot(r.confirmed_slot)}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{r.discipline} · {r.plan_id}</div>
                    </div>
                  );
                })}
              </>
            )}
            {requests.length === 0 && (
              <div style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📞</div>
                <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>No P2P requests</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Set your schedule above so providers can book times</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Panel */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {!selected ? (
          <div style={{ maxWidth: 440, margin: "40px auto", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📞</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Peer-to-Peer Reviews</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Select a request from the list to accept a time or record the call outcome.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            {/* Confirmed call banner */}
            {selected.status === "confirmed" && (
              <div style={{ background: "#d1fae5", borderRadius: 12, border: "1px solid #6ee7b7", padding: "18px 22px", marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Confirmed Call</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, color: "#065f46" }}>{fmtSlot(selected.confirmed_slot)}</div>
                <div style={{ fontSize: 12, color: "#065f46", marginTop: 4, opacity: 0.8 }}>Provider has been notified of this time</div>
              </div>
            )}

            {/* Case info */}
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 22, marginBottom: 16 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{selected.member_name}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {selected.discipline} · {selected.plan_id} · Requested {selected.requested_visits} visits
              </div>
              {Array.isArray(selected.diagnosis_codes) && selected.diagnosis_codes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                  {selected.diagnosis_codes.map(c => (
                    <span key={c} style={{ padding: "2px 8px", borderRadius: 5, background: "#eff6ff", color: NAVY, fontSize: 11, fontFamily: "monospace", fontWeight: 600 }}>{c}</span>
                  ))}
                </div>
              )}
              {/* Prior determination summary */}
              <div style={{ marginTop: 14, background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: "12px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Your Determination</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#c2410c" }}>{selected.last_determination || "—"}</div>
                {selected.last_approved_visits != null && <div style={{ fontSize: 12, color: "#92400e", marginTop: 2 }}>{selected.last_approved_visits} visits approved</div>}
                {selected.last_reviewer_notes && <div style={{ fontSize: 12, color: "#7c2d12", marginTop: 6, fontStyle: "italic" }}>"{selected.last_reviewer_notes}"</div>}
              </div>
              {selected.clinical_notes && (
                <div style={{ marginTop: 12, background: "#f8fafc", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#374151" }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.7 }}>Provider Clinical Argument</div>
                  {selected.clinical_notes}
                </div>
              )}
            </div>

            {/* Accept slot (pending only) */}
            {selected.status === "pending" && !panel && (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 22, marginBottom: 16 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>Provider's Requested Times</div>
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, padding: "14px 16px", background: "#eff6ff", borderRadius: 10, border: "1.5px solid #bfdbfe" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Primary</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{fmtSlot(selected.primary_slot)}</div>
                    <button onClick={() => handleAccept("primary")} disabled={saving}
                      style={{ marginTop: 10, width: "100%", padding: "8px 0", background: NAVY, color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                      Accept Primary
                    </button>
                  </div>
                  {selected.secondary_slot && (
                    <div style={{ flex: 1, padding: "14px 16px", background: "#f0fdf4", borderRadius: 10, border: "1.5px solid #bbf7d0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#065f46", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Secondary</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{fmtSlot(selected.secondary_slot)}</div>
                      <button onClick={() => handleAccept("secondary")} disabled={saving}
                        style={{ marginTop: 10, width: "100%", padding: "8px 0", background: "#059669", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                        Accept Secondary
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Record Outcome */}
            {!panel && (
              <button onClick={() => setPanel("complete")}
                style={{ width: "100%", padding: "12px 0", borderRadius: 8, background: "#059669", color: "#fff", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 16 }}>
                Record Call Outcome
              </button>
            )}

            {panel === "complete" && (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 22 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>Record P2P Outcome</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  {[
                    { key: "upheld",         label: "Upheld",        color: "#dc2626" },
                    { key: "reversed",       label: "Reversed",      color: "#059669" },
                    { key: "partial_change", label: "Partial Change", color: "#d97706" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setOutcome(opt.key)}
                      style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `2px solid ${outcome === opt.key ? opt.color : "#e2e8f0"}`, background: outcome === opt.key ? opt.color : "#fff", color: outcome === opt.key ? "#fff" : "#374151", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {outcome !== "upheld" && (
                  <div style={{ background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>Updated Determination</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {["Approved", "Partial Denial", "Full Denial", "Pend"].map(d => (
                        <button key={d} onClick={() => setNewDet(d)}
                          style={{ padding: "6px 12px", borderRadius: 6, border: `1.5px solid ${newDet === d ? "#d97706" : "#e2e8f0"}`, background: newDet === d ? "#fef3c7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: newDet === d ? 700 : 400 }}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <label style={{ fontSize: 12, color: "#7c2d12" }}>Approved visits
                      <input type="number" min={0} value={newVisits} onChange={e => setNewVisits(e.target.value)}
                        style={{ display: "block", marginTop: 4, width: 100, padding: "6px 10px", borderRadius: 6, border: "1px solid #fed7aa", fontSize: 13 }} />
                    </label>
                  </div>
                )}
                <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 14 }}>Call notes (audit trail)
                  <textarea value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} rows={3}
                    placeholder="Summarize clinical points discussed and rationale..."
                    style={{ display: "block", marginTop: 4, width: "100%", padding: "9px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setPanel(null)} style={{ padding: "9px 18px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  <button onClick={handleComplete} disabled={saving}
                    style={{ padding: "9px 18px", borderRadius: 7, background: "#059669", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                    {saving ? "Recording..." : "Record Outcome & Notify Provider"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AppealModal: provider files an appeal ────────────────────────────────────
function AppealModal({ submission, token, onClose, onSuccess }) {
  const GROUNDS_OPTIONS = [
    "Determination not supported by clinical evidence",
    "Documentation was complete; re-review requested",
    "Incorrect application of MCG/clinical criteria",
    "Benefit coverage dispute",
    "Other",
  ];
  const [grounds, setGrounds]         = useState("");
  const [notes, setNotes]             = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");

  const handleSubmit = async () => {
    if (!grounds) { setError("Please select grounds for the appeal."); return; }
    setSubmitting(true);
    setError("");
    try {
      await axios.post(`${API_BASE}/v1/appeals`, {
        submissionId: submission.submission_id,
        grounds,
        supportingNotes: notes,
        level: 1,
      }, { headers: { Authorization: `Bearer ${token}` } });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to file appeal.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 520, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>File Level 1 Appeal</div>
          <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'Public Sans', sans-serif" }}>{submission.member_name} · {submission.discipline}</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>Grounds for Appeal *</div>
          {GROUNDS_OPTIONS.map(g => (
            <label key={g} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
              <input type="radio" name="grounds" value={g} checked={grounds === g} onChange={() => setGrounds(g)} />
              <span style={{ fontSize: 13, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{g}</span>
            </label>
          ))}
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>Supporting Clinical Notes (optional)</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
            placeholder="Provide additional clinical context, citations, or documentation references..."
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
        </div>
        {error && <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#dc2626" }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting}
            style={{ padding: "10px 20px", borderRadius: 8, background: "#1a3a5c", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontFamily: "'Public Sans', sans-serif" }}>
            {submitting ? "Filing…" : "Submit Appeal"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AppealsQueueView: reviewer sees L1 appeals assigned to them ───────────────
function AppealsQueueView({ token }) {
  const [appeals, setAppeals]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("");
  const [decNotes, setDecNotes] = useState("");
  const [newDet, setNewDet]     = useState("Approved");
  const [newVisits, setNewVisits] = useState("");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);

  const fetchAppeals = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/appeals`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setAppeals(r.data.appeals || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchAppeals(); }, [token]); // eslint-disable-line

  const handleDecide = async () => {
    if (!selected || !decision) return;
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/v1/appeals/${selected.appeal_id}/decide`, {
        decision,
        decisionNotes:      decNotes,
        newDetermination:   decision !== "upheld" ? newDet : undefined,
        newApprovedVisits:  decision !== "upheld" ? (parseInt(newVisits, 10) || undefined) : undefined,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setToast("Decision recorded and provider notified.");
      setSelected(null); setDecision(""); setDecNotes(""); setNewVisits("");
      fetchAppeals();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(err.response?.data?.error || "Failed to record decision.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const statusChip = (s) => {
    const map = { filed: ["#eff6ff","#1d4ed8"], under_review: ["#fef3c7","#b45309"], decided: ["#f0fdf4","#15803d"], withdrawn: ["#f1f5f9","#64748b"] };
    const [bg, text] = map[s] || ["#f1f5f9","#374151"];
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: bg, color: text }}>{s.replace("_"," ").toUpperCase()}</span>;
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 110px)", overflow: "hidden" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: "#1a3a5c", color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{toast}</div>}
      {/* Left: appeal list */}
      <div style={{ width: 320, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Appeals Queue</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Level 1 appeals assigned to you</div>
        </div>
        {loading ? <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading…</div>
        : appeals.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>No active appeals</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Appeals assigned to you will appear here.</div>
          </div>
        ) : appeals.map((a, i) => {
          const isSel = selected?.appeal_id === a.appeal_id;
          const deadline = a.deadline_at ? new Date(a.deadline_at) : null;
          const daysLeft = deadline ? Math.ceil((deadline - Date.now()) / 86400000) : null;
          return (
            <div key={a.appeal_id} onClick={() => { setSelected(a); setDecision(""); setDecNotes(""); setNewVisits(""); }}
              style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#eff6ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #1a3a5c" : "3px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{a.member_name || "Unknown Member"}</span>
                {statusChip(a.status)}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{a.discipline} · Level {a.level}</div>
              <div style={{ fontSize: 11, color: "#374151", marginTop: 3 }}>Grounds: {a.grounds?.slice(0, 45)}{a.grounds?.length > 45 ? "…" : ""}</div>
              {daysLeft !== null && <div style={{ fontSize: 10, color: daysLeft <= 5 ? "#dc2626" : "#94a3b8", marginTop: 3, fontWeight: daysLeft <= 5 ? 700 : 400 }}>{daysLeft > 0 ? `${daysLeft}d until deadline` : "PAST DEADLINE"}</div>}
            </div>
          );
        })}
      </div>

      {/* Right: decision panel */}
      <div style={{ flex: 1, overflowY: "auto", padding: 28, background: "#f8fafc" }}>
        {!selected ? (
          <div style={{ maxWidth: 420, margin: "80px auto", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>⚖️</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 8 }}>Level 1 Appeal Review</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Select an appeal from the queue to review and issue a decision. The provider will be notified of the outcome.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700, color: "#1a3a5c", marginBottom: 4 }}>{selected.member_name}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>{selected.discipline} · {selected.plan_id} · Level {selected.level} Appeal</div>
              <div style={{ background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", padding: 16, marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Original Determination</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#dc2626" }}>{selected.original_determination || "—"}</div>
              </div>
              <div style={{ background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Provider Grounds</div>
                <div style={{ fontSize: 13, color: "#78350f" }}>{selected.grounds}</div>
                {selected.supporting_notes && <div style={{ fontSize: 12, color: "#78350f", marginTop: 8, borderTop: "1px solid #fde68a", paddingTop: 8 }}>{selected.supporting_notes}</div>}
              </div>
            </div>

            {selected.status === "decided" ? (
              <div style={{ background: "#f0fdf4", borderRadius: 12, border: "1px solid #86efac", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d", marginBottom: 4 }}>Decision: {selected.decision?.toUpperCase()}</div>
                {selected.decision_notes && <div style={{ fontSize: 13, color: "#166534" }}>{selected.decision_notes}</div>}
                {selected.new_determination && <div style={{ fontSize: 12, color: "#166534", marginTop: 6 }}>New determination: {selected.new_determination} {selected.new_approved_visits ? `(${selected.new_approved_visits} visits)` : ""}</div>}
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 700, color: "#1a3a5c", marginBottom: 16 }}>Issue Decision</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                  {[
                    { key: "upheld",     label: "Uphold",     color: "#dc2626", desc: "Maintain original denial" },
                    { key: "overturned", label: "Overturn",   color: "#16a34a", desc: "Reverse in favor of provider" },
                    { key: "modified",   label: "Modify",     color: "#d97706", desc: "Partial reversal" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setDecision(opt.key)}
                      style={{ flex: 1, padding: "12px 8px", borderRadius: 8, border: `2px solid ${decision === opt.key ? opt.color : "#e2e8f0"}`, background: decision === opt.key ? opt.color : "#fff", color: decision === opt.key ? "#fff" : "#374151", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {decision !== "upheld" && decision && (
                  <div style={{ background: "#f0fdf4", borderRadius: 8, border: "1px solid #86efac", padding: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginBottom: 10 }}>New Determination</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {["Approved", "Partial Denial", "Pend"].map(d => (
                        <button key={d} onClick={() => setNewDet(d)}
                          style={{ padding: "5px 12px", borderRadius: 6, border: `1.5px solid ${newDet === d ? "#16a34a" : "#e2e8f0"}`, background: newDet === d ? "#dcfce7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: newDet === d ? 700 : 400 }}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <input type="number" min={0} value={newVisits} onChange={e => setNewVisits(e.target.value)}
                      placeholder="Approved visits (optional)" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #86efac", fontSize: 13, width: 180 }} />
                  </div>
                )}
                {decision && (
                  <>
                    <textarea value={decNotes} onChange={e => setDecNotes(e.target.value)} rows={3}
                      placeholder="Decision rationale (will be sent to provider)..."
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", marginBottom: 14 }} />
                    <button onClick={handleDecide} disabled={saving}
                      style={{ background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, padding: "11px 28px", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
                      {saving ? "Recording…" : "Record Decision & Notify Provider"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MyCasesView({ token }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(null);
  const [decisions, setDecisions]     = useState({});
  const [p2pModal, setP2pModal]       = useState(null);
  const [p2pSuccess, setP2pSuccess]   = useState({});
  const [appealModal, setAppealModal] = useState(null);
  const [appealSuccess, setAppealSuccess] = useState({});

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

  const canRequestP2P = (sub) =>
    ["denied", "pending_md_review"].includes(sub.status) && !p2pSuccess[sub.submission_id];

  const canFileAppeal = (sub) =>
    ["denied", "partial_denial"].includes(sub.status) && !appealSuccess[sub.submission_id];

  return (
    <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 24px" }}>
      {p2pModal && (
        <P2PRequestModal
          submissionId={p2pModal.submission_id}
          memberName={p2pModal.member_name}
          token={token}
          onClose={() => setP2pModal(null)}
          onSuccess={() => {
            setP2pSuccess(prev => ({ ...prev, [p2pModal.submission_id]: true }));
            setP2pModal(null);
          }}
        />
      )}
      {appealModal && (
        <AppealModal
          submission={appealModal}
          token={token}
          onClose={() => setAppealModal(null)}
          onSuccess={() => {
            setAppealSuccess(prev => ({ ...prev, [appealModal.submission_id]: true }));
            setAppealModal(null);
          }}
        />
      )}
      {submissions.map(sub => {
        const isOpen = expanded === sub.submission_id;
        return (
          <div key={sub.submission_id} style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 14, overflow: "hidden" }}>
            <div onClick={() => handleExpand(sub)} style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{sub.member_name || "Unknown Member"}</span>
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "#9ca3af" }}>{sub.submission_id}</span>
                  {sub.review_type === "concurrent" && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 5, padding: "2px 7px" }}>CONCURRENT</span>
                  )}
                  {canRequestP2P(sub) && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 5, padding: "2px 7px" }}>P2P AVAILABLE</span>
                  )}
                  {canFileAppeal(sub) && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fef2f2", color: "#dc2626", borderRadius: 5, padding: "2px 7px" }}>APPEAL AVAILABLE</span>
                  )}
                  {appealSuccess[sub.submission_id] && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#d1fae5", color: "#065f46", borderRadius: 5, padding: "2px 7px" }}>APPEAL FILED</span>
                  )}
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
                <DecisionLetter submission={sub} decision={decisions[sub.submission_id]} />
                {/* P2P request */}
                {canRequestP2P(sub) && (
                  <div style={{ marginTop: 14, padding: "14px 16px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", fontFamily: "'Public Sans', sans-serif" }}>Disagree with this determination?</div>
                      <div style={{ fontSize: 12, color: "#78350f", marginTop: 2 }}>You may request a peer-to-peer review call with the reviewing clinician.</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setP2pModal(sub); }}
                      style={{ flexShrink: 0, marginLeft: 16, padding: "8px 16px", background: "#d97706", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                      Request P2P
                    </button>
                  </div>
                )}
                {p2pSuccess[sub.submission_id] && (
                  <div style={{ marginTop: 12, padding: "12px 16px", background: "#d1fae5", borderRadius: 8, border: "1px solid #6ee7b7", fontSize: 13, color: "#065f46", fontFamily: "'Public Sans', sans-serif" }}>
                    ✓ P2P request submitted — you will be notified when a time is confirmed.
                  </div>
                )}
                {/* Appeal filing */}
                {canFileAppeal(sub) && (
                  <div style={{ marginTop: 10, padding: "14px 16px", background: "#fef2f2", borderRadius: 8, border: "1px solid #fca5a5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", fontFamily: "'Public Sans', sans-serif" }}>Not satisfied with this outcome?</div>
                      <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 2 }}>You may file a formal Level 1 appeal within 60 days of this determination.</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setAppealModal(sub); }}
                      style={{ flexShrink: 0, marginLeft: 16, padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                      File Appeal
                    </button>
                  </div>
                )}
                {appealSuccess[sub.submission_id] && (
                  <div style={{ marginTop: 10, padding: "12px 16px", background: "#d1fae5", borderRadius: 8, border: "1px solid #6ee7b7", fontSize: 13, color: "#065f46", fontFamily: "'Public Sans', sans-serif" }}>
                    ✓ Level 1 appeal filed — you will be notified of the decision within 30 days.
                  </div>
                )}
                {!["approved","denied","pended","pending_md_review","partial_denial"].includes(sub.status) && (
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
            {confirmation.extractedData && (() => {
              const ex = confirmation.extractedData;
              const dq = ex.documentationQuality || {};
              const dqFlags = [
                ["Objective Measures", dq.hasObjectiveMeasures],
                ["Functional Limitations", dq.hasFunctionalLimitations],
                ["Goals Documented", dq.hasGoals],
                ["Plan of Care", dq.hasPOC],
              ];
              return (
                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "16px 20px", marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 16 }}>🤖</span>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>AI Extraction Complete</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
                    {ex.diagnosisCodes?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>Diagnoses Extracted</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {ex.diagnosisCodes.map(c => (
                            <span key={c} style={{ background: "#e0f2fe", color: "#0369a1", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {ex.painScore != null && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>Pain Score</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif" }}>{ex.painScore}<span style={{ fontSize: 12, fontWeight: 500, color: "#6b7280" }}>/10</span></div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>Documentation Quality</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {dqFlags.map(([label, val]) => (
                        <span key={label} style={{ display: "flex", alignItems: "center", gap: 4, background: val ? "#dcfce7" : "#f1f5f9", color: val ? "#15803d" : "#94a3b8", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                          <span>{val ? "✓" : "–"}</span>{label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
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
                  {s.review_type === "concurrent" && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>CONCURRENT</span>
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

// ── MasterAppealsView: master sees all appeals + can assign reviewers ────────
function MasterAppealsView({ token }) {
  const [appeals, setAppeals]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [reviewers, setReviewers]     = useState([]);
  const [selected, setSelected]       = useState(null);
  const [assignTo, setAssignTo]       = useState("");
  const [assigning, setAssigning]     = useState(false);
  const [toast, setToast]             = useState(null);

  const fetchAppeals = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/appeals`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setAppeals(r.data.appeals || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchAppeals();
    axios.get(`${API_BASE}/v1/search-cases?reviewersOnly=1`, { headers: { Authorization: `Bearer ${token}` } })
      .catch(() => {});
    // Fetch reviewer list from users (we'll use a simple approach)
    fetch(`${API_BASE}/v1/admin/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .catch(() => {});
  }, [token]); // eslint-disable-line

  const handleAssign = async () => {
    if (!selected || !assignTo) return;
    setAssigning(true);
    try {
      await axios.post(`${API_BASE}/v1/appeals/${selected.appeal_id}/assign`, { reviewerId: assignTo }, { headers: { Authorization: `Bearer ${token}` } });
      setToast("Reviewer assigned and notified.");
      setSelected(null); setAssignTo("");
      fetchAppeals();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(err.response?.data?.error || "Failed to assign.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setAssigning(false);
    }
  };

  const levelColor = (l) => l === 1 ? "#1d4ed8" : l === 2 ? "#7c3aed" : "#dc2626";
  const statusColor = (s) => {
    const map = { filed: "#d97706", under_review: "#2563eb", decided: "#16a34a", withdrawn: "#94a3b8" };
    return map[s] || "#94a3b8";
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 960, margin: "0 auto" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: "#0d1b2a", color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{toast}</div>}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif" }}>Appeals Management</div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>All active and decided appeals across all levels</div>
      </div>
      {loading ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading appeals…</div> : appeals.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: "40px 24px", textAlign: "center", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>No appeals filed yet</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>Appeal filings from providers will appear here.</div>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Member", "Discipline", "Level", "Status", "Grounds", "Deadline", "Decision", "Action"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appeals.map((a, i) => {
                const deadline = a.deadline_at ? new Date(a.deadline_at) : null;
                const daysLeft = deadline ? Math.ceil((deadline - Date.now()) / 86400000) : null;
                return (
                  <tr key={a.appeal_id} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1e293b" }}>{a.member_name || "—"}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>{a.discipline || "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: "#eff6ff", color: levelColor(a.level) }}>L{a.level}</span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(a.status) }}>{a.status?.replace("_"," ").toUpperCase()}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#374151", maxWidth: 200 }}>{a.grounds?.slice(0, 40)}{a.grounds?.length > 40 ? "…" : ""}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: daysLeft !== null && daysLeft <= 5 ? "#dc2626" : "#64748b", fontWeight: daysLeft !== null && daysLeft <= 5 ? 700 : 400 }}>
                      {daysLeft !== null ? (daysLeft > 0 ? `${daysLeft}d` : "PAST") : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: a.decision === "overturned" ? "#16a34a" : a.decision === "upheld" ? "#dc2626" : "#64748b" }}>
                      {a.decision?.toUpperCase() || "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {a.status === "filed" && a.level === 1 && (
                        <button onClick={() => setSelected(a)} style={{ padding: "5px 12px", borderRadius: 6, background: "#1a3a5c", color: "#fff", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Assign</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8000 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Assign Appeal Reviewer</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>{selected.member_name} · Level {selected.level}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Enter Reviewer User ID</div>
            <input value={assignTo} onChange={e => setAssignTo(e.target.value)}
              placeholder="reviewer user_id UUID"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 20, boxSizing: "border-box" }} />
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16 }}>Tip: Find reviewer IDs in the All Cases tab.</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { setSelected(null); setAssignTo(""); }} style={{ padding: "9px 18px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleAssign} disabled={!assignTo || assigning} style={{ padding: "9px 18px", borderRadius: 7, background: "#1a3a5c", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: !assignTo || assigning ? "not-allowed" : "pointer", opacity: !assignTo || assigning ? 0.6 : 1 }}>
                {assigning ? "Assigning…" : "Assign Reviewer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AdminConsole: master manages plans + white-label config ──────────────────
function AdminConsole({ token }) {
  const [plans, setPlans]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // null | plan object | "new"
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState(null);

  const fetchPlans = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/admin/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setPlans(r.data.plans || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchPlans(); }, [token]); // eslint-disable-line

  const openEdit = (plan) => {
    setEditing(plan);
    setForm({
      planName:            plan.plan_name || "",
      autoApproveThreshold: plan.auto_approve_threshold || 18,
      brandColor:          plan.brand_color || "#1a3a5c",
      logoUrl:             plan.logo_url || "",
      contactEmail:        plan.contact_email || "",
    });
  };

  const openNew = () => {
    setEditing("new");
    setForm({ planId: "", planName: "", autoApproveThreshold: 18, brandColor: "#1a3a5c", logoUrl: "", contactEmail: "" });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing === "new") {
        await axios.post(`${API_BASE}/v1/admin/plans`, {
          planId: form.planId, planName: form.planName,
          autoApproveThreshold: parseInt(form.autoApproveThreshold, 10),
          brandColor: form.brandColor, logoUrl: form.logoUrl, contactEmail: form.contactEmail,
        }, { headers: { Authorization: `Bearer ${token}` } });
      } else {
        await axios.patch(`${API_BASE}/v1/admin/plans/${editing.plan_id}`, {
          planName: form.planName,
          autoApproveThreshold: parseInt(form.autoApproveThreshold, 10),
          brandColor: form.brandColor, logoUrl: form.logoUrl, contactEmail: form.contactEmail,
        }, { headers: { Authorization: `Bearer ${token}` } });
      }
      setToast(editing === "new" ? "Plan created." : "Plan updated.");
      setEditing(null);
      fetchPlans();
      setTimeout(() => setToast(null), 3500);
    } catch (err) {
      setToast(err.response?.data?.error || "Save failed.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={{ padding: "24px 28px", maxWidth: 900, margin: "0 auto" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: "#0d1b2a", color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{toast}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif" }}>Payer Plan Console</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Configure payer plans, branding, and review rules</div>
        </div>
        <button onClick={openNew} style={{ padding: "10px 20px", background: "#0d1b2a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ New Plan</button>
      </div>

      {loading ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading plans…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {plans.map(plan => (
            <div key={plan.plan_id} style={{ background: "#fff", borderRadius: 12, border: "2px solid", borderColor: plan.brand_color || "#1a3a5c", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <div style={{ background: plan.brand_color || "#1a3a5c", padding: "16px 20px" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>{plan.plan_name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 2, fontFamily: "monospace" }}>{plan.plan_id}</div>
              </div>
              <div style={{ padding: "14px 20px" }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: "#374151" }}>Auto-approve threshold: </span>{plan.auto_approve_threshold || 18} visits
                </div>
                {plan.contact_email && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}><span style={{ fontWeight: 600, color: "#374151" }}>Contact: </span>{plan.contact_email}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: plan.brand_color || "#1a3a5c", border: "1px solid rgba(0,0,0,0.1)" }} />
                  <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{plan.brand_color || "#1a3a5c"}</span>
                </div>
                <button onClick={() => openEdit(plan)} style={{ marginTop: 14, width: "100%", padding: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>Edit Plan Config</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8000, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 480, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 20 }}>
              {editing === "new" ? "Create New Plan" : `Edit ${editing.plan_name}`}
            </div>
            {[
              editing === "new" && { key: "planId", label: "Plan ID *", placeholder: "e.g. UHC-GOLD", type: "text" },
              { key: "planName", label: "Plan Name *", placeholder: "e.g. United Health Gold", type: "text" },
              { key: "autoApproveThreshold", label: "Auto-Approve Threshold (visits)", placeholder: "18", type: "number" },
              { key: "brandColor", label: "Brand Color (hex)", placeholder: "#005a8b", type: "text" },
              { key: "logoUrl", label: "Logo URL (optional)", placeholder: "https://...", type: "text" },
              { key: "contactEmail", label: "Contact Email", placeholder: "ur@payer.com", type: "email" },
            ].filter(Boolean).map(field => (
              <div key={field.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 5 }}>{field.label}</div>
                <input type={field.type} value={form[field.key] || ""} onChange={e => f(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
                {field.key === "brandColor" && form.brandColor && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: form.brandColor, border: "1px solid rgba(0,0,0,0.1)" }} />
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>Preview</span>
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setEditing(null)} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: "10px 20px", borderRadius: 8, background: "#0d1b2a", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : editing === "new" ? "Create Plan" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ReportsView: master reporting & CSV export ───────────────────────────────
function TrendChart({ weeks }) {
  if (!weeks || weeks.length === 0) return null;
  const W = 600, H = 160, PAD = 32, BOTTOM = 28;
  const innerW = W - PAD * 2, innerH = H - BOTTOM;
  const maxVal = Math.max(1, ...weeks.map(w => Math.max(w.total, w.approved, w.denied, w.pended)));
  const pts = (key, color) => {
    const points = weeks.map((w, i) => {
      const x = PAD + (i / (weeks.length - 1 || 1)) * innerW;
      const y = innerH - (w[key] / maxVal) * (innerH - 12);
      return [x, y];
    });
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    return (
      <g key={key}>
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={color} />)}
      </g>
    );
  };
  const series = [["total","#0d1b2a"],["approved","#16a34a"],["denied","#dc2626"],["pended","#d97706"]];
  const fmtWk = (s) => { const d = new Date(s); return `${d.getMonth()+1}/${d.getDate()}`; };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {[0, 0.5, 1].map(t => {
        const y = innerH - t * (innerH - 12);
        return <line key={t} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
      })}
      {series.map(([k, c]) => pts(k, c))}
      {weeks.map((w, i) => {
        const x = PAD + (i / (weeks.length - 1 || 1)) * innerW;
        return <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="#94a3b8">{fmtWk(w.week)}</text>;
      })}
      {series.map(([k, c], i) => (
        <g key={k} transform={`translate(${PAD + i * 90}, 8)`}>
          <circle cx="5" cy="5" r="4" fill={c} />
          <text x="13" y="9" fontSize="10" fill="#374151" fontFamily="DM Sans, sans-serif">{k.charAt(0).toUpperCase()+k.slice(1)}</text>
        </g>
      ))}
    </svg>
  );
}

function ReportsView({ token }) {
  const [reportType, setReportType] = useState("cases");
  const [startDate, setStartDate]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate]       = useState(() => new Date().toISOString().split("T")[0]);
  const [planFilter, setPlanFilter] = useState("");
  const [discFilter, setDiscFilter] = useState("");
  const [plans, setPlans]           = useState([]);
  const [rows, setRows]             = useState(null);
  const [summary, setSummary]       = useState(null);
  const [trends, setTrends]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  useEffect(() => {
    axios.get(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlans(r.data.plans || [])).catch(() => {});
  }, [token]); // eslint-disable-line

  const runReport = async () => {
    setLoading(true); setError(""); setRows(null); setSummary(null); setTrends(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (planFilter) params.set("planId", planFilter);
      if (discFilter) params.set("discipline", discFilter);

      if (reportType === "cases") {
        const r = await axios.get(`${API_BASE}/v1/reports/cases?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        setRows(r.data.rows);
      } else if (reportType === "summary") {
        const r = await axios.get(`${API_BASE}/v1/reports/summary?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        setSummary(r.data);
      } else if (reportType === "appeals") {
        const r = await axios.get(`${API_BASE}/v1/reports/appeals?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        setRows(r.data.rows);
      } else if (reportType === "trends") {
        const r = await axios.get(`${API_BASE}/v1/reports/trends`, { headers: { Authorization: `Bearer ${token}` } });
        setTrends(r.data.weeks);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to generate report.");
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvLines = [
      headers.join(","),
      ...rows.map(row =>
        headers.map(h => {
          const v = row[h] == null ? "" : String(row[h]);
          return v.includes(",") || v.includes('"') || v.includes("\n")
            ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(",")
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `cogentcr_${reportType}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const REPORT_TYPES = [
    { key: "cases",   label: "Case Activity",      desc: "All submissions with determination, TAT, reviewer" },
    { key: "summary", label: "Summary Dashboard",  desc: "Aggregated rates by plan, discipline, SLA" },
    { key: "appeals", label: "Appeals Outcomes",   desc: "All appeals with level, decision, days-to-decision" },
    { key: "trends",  label: "12-Week Trends",     desc: "Weekly volume chart: total, approved, denied, pended" },
  ];

  const NAVY = "#0d1b2a";

  // Column display configs
  const CASE_COLS = [
    { key: "member_name",            label: "Member" },
    { key: "member_id",              label: "Member ID" },
    { key: "discipline",             label: "Disc." },
    { key: "plan_id",                label: "Plan" },
    { key: "status",                 label: "Status" },
    { key: "review_priority",        label: "Priority" },
    { key: "requested_visits",       label: "Req. Visits" },
    { key: "final_determination",    label: "Determination" },
    { key: "final_approved_visits",  label: "Approved" },
    { key: "tat_hours",              label: "TAT (h)" },
    { key: "had_rmi",                label: "RMI" },
    { key: "appeal_count",           label: "Appeals" },
    { key: "submitted_at",           label: "Submitted" },
    { key: "decided_at",             label: "Decided" },
    { key: "reviewer",               label: "Reviewer" },
  ];

  const APPEAL_COLS = [
    { key: "member_name",            label: "Member" },
    { key: "discipline",             label: "Disc." },
    { key: "plan_id",                label: "Plan" },
    { key: "level",                  label: "Level" },
    { key: "status",                 label: "Status" },
    { key: "grounds",                label: "Grounds" },
    { key: "original_determination", label: "Original Det." },
    { key: "decision",               label: "Decision" },
    { key: "new_determination",      label: "New Det." },
    { key: "days_to_decision",       label: "Days" },
    { key: "filed_at",               label: "Filed" },
    { key: "decided_at",             label: "Decided" },
  ];

  const cols = reportType === "appeals" ? APPEAL_COLS : CASE_COLS;
  const fmtDate = (v) => v ? new Date(v).toLocaleDateString() : "—";
  const fmtVal  = (key, v) => {
    if (v == null) return "—";
    if (key.endsWith("_at")) return fmtDate(v);
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };

  const detColor = (v) => {
    if (!v) return "#374151";
    if (/approv/i.test(v)) return "#15803d";
    if (/denial|denied/i.test(v)) return "#dc2626";
    if (/partial/i.test(v)) return "#d97706";
    return "#374151";
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, fontFamily: "'Fraunces', Georgia, serif" }}>Reports & Analytics Export</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Generate, preview, and export data for compliance, actuarial, and operations teams</div>
        </div>
        {rows && rows.length > 0 && (
          <button onClick={exportCsv} style={{ padding: "10px 22px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            ↓ Export CSV ({rows.length} rows)
          </button>
        )}
      </div>

      {/* Report type selector */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {REPORT_TYPES.map(rt => (
          <button key={rt.key} onClick={() => { setReportType(rt.key); setRows(null); setSummary(null); }}
            style={{ flex: 1, padding: "14px 16px", borderRadius: 10, border: `2px solid ${reportType === rt.key ? NAVY : "#e2e8f0"}`, background: reportType === rt.key ? NAVY : "#fff", color: reportType === rt.key ? "#fff" : "#374151", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{rt.label}</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>{rt.desc}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 20px", marginBottom: 20, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>Start Date</div>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>End Date</div>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13 }} />
        </div>
        {reportType !== "appeals" && (
          <>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>Plan</div>
              <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, minWidth: 140 }}>
                <option value="">All Plans</option>
                {plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>Discipline</div>
              <select value={discFilter} onChange={e => setDiscFilter(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13 }}>
                <option value="">All</option>
                <option>PT</option><option>OT</option><option>ST</option>
              </select>
            </div>
          </>
        )}
        <button onClick={runReport} disabled={loading}
          style={{ padding: "9px 24px", background: NAVY, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
          {loading ? "Running…" : "Run Report"}
        </button>
      </div>

      {error && <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {/* Summary report */}
      {summary && (
        <div>
          {/* Totals row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total Cases",      value: summary.totals?.total_cases   || 0, color: NAVY },
              { label: "Approved",         value: summary.totals?.approved       || 0, color: "#15803d" },
              { label: "Denied",           value: summary.totals?.denied         || 0, color: "#dc2626" },
              { label: "Avg TAT (hours)",  value: summary.totals?.avg_tat_hours  || "—", color: "#d97706" },
              { label: "Appeals Filed",    value: summary.totals?.total_appeals  || 0, color: "#7c3aed" },
              { label: "Appeals Overturned", value: summary.totals?.appeals_overturned || 0, color: "#0891b2" },
            ].map(card => (
              <div key={card.label} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "16px 18px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: card.color, fontFamily: "'Fraunces', Georgia, serif" }}>{card.value}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{card.label}</div>
              </div>
            ))}
          </div>

          {/* By Plan */}
          {summary.byPlan?.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", marginBottom: 16, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: NAVY }}>By Payer Plan</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Plan","Total","Approved","Partial Denial","Full Denial","Pended","Avg TAT (h)"].map(h => (
                    <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {summary.byPlan.map((r, i) => (
                    <tr key={r.plan_id} style={{ borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "10px 16px", fontWeight: 600, color: NAVY }}>{r.plan_id}</td>
                      <td style={{ padding: "10px 16px" }}>{r.total}</td>
                      <td style={{ padding: "10px 16px", color: "#15803d", fontWeight: 600 }}>{r.approved}</td>
                      <td style={{ padding: "10px 16px", color: "#d97706" }}>{r.partial_denial}</td>
                      <td style={{ padding: "10px 16px", color: "#dc2626" }}>{r.full_denial}</td>
                      <td style={{ padding: "10px 16px", color: "#6b7280" }}>{r.pended}</td>
                      <td style={{ padding: "10px 16px" }}>{r.avg_tat_hours ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* By Discipline */}
          {summary.byDisc?.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: NAVY }}>By Discipline</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Discipline","Total","Approved","Approval Rate"].map(h => (
                    <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {summary.byDisc.map((r, i) => (
                    <tr key={r.discipline} style={{ borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "10px 16px", fontWeight: 700, color: NAVY }}>{r.discipline}</td>
                      <td style={{ padding: "10px 16px" }}>{r.total}</td>
                      <td style={{ padding: "10px 16px", color: "#15803d", fontWeight: 600 }}>{r.approved}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 3, maxWidth: 80 }}>
                            <div style={{ height: "100%", width: `${r.approval_rate_pct || 0}%`, background: "#15803d", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#15803d" }}>{r.approval_rate_pct ?? "—"}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Trends chart */}
      {trends && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "20px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, fontFamily: "'Fraunces', Georgia, serif", marginBottom: 16 }}>Weekly Case Volume — Last 12 Weeks</div>
          <TrendChart weeks={trends} />
          {trends.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 24 }}>No data yet — submit cases to populate trends.</div>}
        </div>
      )}

      {/* Row data table (cases / appeals) */}
      {rows && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{rows.length} records</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Preview shows all rows — Export CSV for full data</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {cols.map(c => (
                    <th key={c.key} style={{ padding: "9px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    {cols.map(c => (
                      <td key={c.key} style={{ padding: "9px 14px", whiteSpace: "nowrap", color: c.key === "final_determination" || c.key === "decision" ? detColor(row[c.key]) : "#374151", fontWeight: c.key === "final_determination" || c.key === "decision" ? 600 : 400 }}>
                        {fmtVal(c.key, row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 && (
              <div style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, color: "#94a3b8", borderTop: "1px solid #f1f5f9" }}>
                Showing first 100 of {rows.length} rows — export CSV for all data
              </div>
            )}
          </div>
        </div>
      )}
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
    ["dashboard",  "Dashboard"],
    ["queue",      "All Cases"],
    ["ur_form",    "UR Form"],
    ["cockpit",    "Cockpit"],
    ["appeals",    "Appeals"],
    ["reports",    "Reports"],
    ["admin",      "Admin"],
    ["criteria",    "Criteria"],
    ["providers",   "Providers"],
    ["state_rules",    "State Rules"],
    ["integrations",   "Integrations"],
    ["bulk_import",    "Bulk Import"],
    ["users",          "Users"],
    ["audit",          "Audit"],
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
      {masterView === "appeals"   && <MasterAppealsView token={token} />}
      {masterView === "reports"   && <ReportsView token={token} />}
      {masterView === "admin"     && <AdminConsole token={token} />}
      {masterView === "criteria"   && <CriteriaLibraryView token={token} />}
      {masterView === "providers"   && <ProviderDirectoryView token={token} />}
      {masterView === "state_rules"  && <StateRulesView token={token} />}
      {masterView === "integrations" && <IntegrationsView token={token} />}
      {masterView === "bulk_import"  && <BulkImportView token={token} />}
      {masterView === "users"        && <UserManagementView token={token} />}
      {masterView === "audit"        && <AuditExportView token={token} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDICAL DIRECTOR SHELL
// ─────────────────────────────────────────────────────────────────────────────
// MD-specific L2 appeals component
function MDAppealsView({ token }) {
  const [appeals, setAppeals]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("");
  const [decNotes, setDecNotes] = useState("");
  const [newDet, setNewDet]     = useState("Approved");
  const [newVisits, setNewVisits] = useState("");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);

  const fetchAppeals = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/appeals`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setAppeals(r.data.appeals || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchAppeals(); }, [token]); // eslint-disable-line

  const handleDecide = async () => {
    if (!selected || !decision) return;
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/v1/appeals/${selected.appeal_id}/decide`, {
        decision, decisionNotes: decNotes,
        newDetermination:  decision !== "upheld" ? newDet   : undefined,
        newApprovedVisits: decision !== "upheld" ? (parseInt(newVisits, 10) || undefined) : undefined,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setToast("L2 appeal decision recorded. Provider notified.");
      setSelected(null); setDecision(""); setDecNotes(""); setNewVisits("");
      fetchAppeals();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(err.response?.data?.error || "Failed.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const NAVY = "#1a2e4a";
  return (
    <div style={{ display: "flex", height: "calc(100vh - 110px)" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: NAVY, color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{toast}</div>}
      <div style={{ width: 300, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, fontFamily: "'Fraunces', serif" }}>Level 2 Appeals</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Requires MD decision</div>
        </div>
        {loading ? <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading…</div>
        : appeals.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>No L2 appeals pending</div>
          </div>
        ) : appeals.map((a, i) => {
          const isSel = selected?.appeal_id === a.appeal_id;
          return (
            <div key={a.appeal_id} onClick={() => { setSelected(a); setDecision(""); setDecNotes(""); setNewVisits(""); }}
              style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#f5f0ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #7c3aed" : "3px solid transparent" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{a.member_name}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{a.discipline} · Level {a.level}</div>
              <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginTop: 3 }}>Original: {a.original_determination}</div>
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 28, background: "#faf8f3" }}>
        {!selected ? (
          <div style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚖️</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: NAVY }}>Level 2 Appeal Review</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>Level 1 uphold decisions escalated here for MD co-signature.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 700, color: NAVY }}>{selected.member_name}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>{selected.discipline} · Level {selected.level} Appeal</div>
              <div style={{ background: "#f5f0ff", borderRadius: 8, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6d28d9", textTransform: "uppercase", marginBottom: 5 }}>Provider Grounds</div>
                <div style={{ fontSize: 13, color: "#4c1d95" }}>{selected.grounds}</div>
                {selected.supporting_notes && <div style={{ fontSize: 12, color: "#5b21b6", marginTop: 6 }}>{selected.supporting_notes}</div>}
              </div>
              <div style={{ background: "#fff7ed", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", textTransform: "uppercase", marginBottom: 4 }}>Original Determination</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#c2410c" }}>{selected.original_determination}</div>
              </div>
            </div>
            {selected.status === "decided" ? (
              <div style={{ background: "#f0fdf4", borderRadius: 12, border: "1px solid #86efac", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d" }}>Decision: {selected.decision?.toUpperCase()}</div>
                {selected.decision_notes && <div style={{ fontSize: 13, color: "#166534", marginTop: 6 }}>{selected.decision_notes}</div>}
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>MD Decision</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  {[
                    { key: "upheld",     label: "Uphold",   color: "#dc2626" },
                    { key: "overturned", label: "Overturn", color: "#16a34a" },
                    { key: "modified",   label: "Modify",   color: "#d97706" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setDecision(opt.key)}
                      style={{ flex: 1, padding: "11px 8px", borderRadius: 8, border: `2px solid ${decision === opt.key ? opt.color : "#e2e8f0"}`, background: decision === opt.key ? opt.color : "#fff", color: decision === opt.key ? "#fff" : "#374151", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {decision !== "upheld" && decision && (
                  <div style={{ background: "#f0fdf4", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {["Approved", "Partial Denial", "Pend"].map(d => (
                        <button key={d} onClick={() => setNewDet(d)}
                          style={{ padding: "5px 12px", borderRadius: 6, border: `1.5px solid ${newDet === d ? "#16a34a" : "#e2e8f0"}`, background: newDet === d ? "#dcfce7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: newDet === d ? 700 : 400 }}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <input type="number" value={newVisits} onChange={e => setNewVisits(e.target.value)} placeholder="Approved visits" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #86efac", fontSize: 13, width: 160 }} />
                  </div>
                )}
                {decision && (
                  <>
                    <textarea value={decNotes} onChange={e => setDecNotes(e.target.value)} rows={3}
                      placeholder="MD rationale for the record…"
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", marginBottom: 14 }} />
                    <button onClick={handleDecide} disabled={saving}
                      style={{ background: NAVY, color: "#fff", border: "none", borderRadius: 8, padding: "11px 28px", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
                      {saving ? "Recording…" : "Record L2 Decision"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MDShell({ user, token, onLogout }) {
  const [mdTab, setMdTab]     = useState("md_queue"); // "md_queue" | "l2_appeals"
  const [queue, setQueue]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [action, setAction]   = useState(null); // "uphold"|"override"|"revision"
  const [mdNotes, setMdNotes] = useState("");
  const [overrideDet, setOverrideDet] = useState("Approved");
  const [overrideVisits, setOverrideVisits] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]     = useState(null);

  const NAVY  = "#1a2e4a";
  const CREAM = "#faf8f3";

  const fetchQueue = () => {
    setLoading(true);
    fetch(`${API_BASE}/v1/md-queue`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setQueue(d.cases || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchQueue(); }, []); // eslint-disable-line

  const handleSubmit = () => {
    if (!selected || !action) return;
    if (action === "override" && !overrideDet) return;
    setSubmitting(true);
    fetch(`${API_BASE}/v1/md-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        submissionId:           selected.submission_id,
        action,
        mdNotes,
        overrideDetermination:  action === "override" ? overrideDet    : undefined,
        overrideApprovedVisits: action === "override" ? parseInt(overrideVisits, 10) || undefined : undefined,
      }),
    })
      .then(r => r.json())
      .then(d => {
        setSubmitting(false);
        if (d.ok) {
          setToast(`${action.charAt(0).toUpperCase() + action.slice(1)} recorded for ${selected.member_name}.`);
          setSelected(null);
          setAction(null);
          setMdNotes("");
          setOverrideVisits("");
          fetchQueue();
          setTimeout(() => setToast(null), 4000);
        } else {
          setToast("Error: " + (d.error || "Unknown error"));
          setTimeout(() => setToast(null), 5000);
        }
      })
      .catch(() => { setSubmitting(false); setToast("Network error."); setTimeout(() => setToast(null), 5000); });
  };

  const tatColor = (s) => s === "breached" ? "#fca5a5" : s === "at_risk" ? "#fcd34d" : "#86efac";
  const tatText  = (s) => s === "breached" ? "#7f1d1d" : s === "at_risk" ? "#78350f" : "#14532d";

  return (
    <div style={{ minHeight: "100vh", background: CREAM, fontFamily: "'Public Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ background: NAVY, color: "#fff", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700 }}>CogentCR</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: "#7c3aed", color: "#fff", borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>MEDICAL DIRECTOR</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, opacity: 0.75 }}>{user.full_name || user.email}</span>
          <button onClick={onLogout} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>Sign Out</button>
        </div>
      </div>

      {/* MD Tab bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
        {[["md_queue","Co-Sign Queue"], ["l2_appeals","L2 Appeals"]].map(([v, label]) => (
          <button key={v} onClick={() => setMdTab(v)} style={{
            padding: "11px 20px", fontSize: 13, fontWeight: mdTab === v ? 700 : 500,
            color: mdTab === v ? NAVY : "#6b7280", background: "none", border: "none",
            borderBottom: mdTab === v ? `2.5px solid ${NAVY}` : "2.5px solid transparent",
            cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
          }}>{label}</button>
        ))}
      </div>

      {toast && (
        <div style={{ position: "fixed", top: 16, right: 16, background: NAVY, color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{toast}</div>
      )}

      {mdTab === "l2_appeals" && <MDAppealsView token={token} />}
      {mdTab === "md_queue" && <div style={{ display: "flex", height: "calc(100vh - 110px)" }}>
        {/* Queue Panel */}
        <div style={{ width: 340, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
          <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 700, color: NAVY }}>MD Review Queue</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{queue.length} case{queue.length !== 1 ? "s" : ""} pending co-sign</div>
          </div>
          {loading ? (
            <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading queue...</div>
          ) : queue.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>Queue cleared</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>No cases pending MD review</div>
            </div>
          ) : queue.map((c, i) => {
            const tat = c.tat || {};
            const isSel = selected?.submission_id === c.submission_id;
            return (
              <div key={c.submission_id} onClick={() => { setSelected(c); setAction(null); setMdNotes(""); setOverrideVisits(""); }}
                style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#eff6ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #3b82f6" : "3px solid transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: NAVY }}>{c.member_name || "Unknown Patient"}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: tatColor(tat.status), color: tatText(tat.status) }}>
                    {tat.status === "breached" ? "⚠ SLA" : `${tat.hoursLeft?.toFixed(0)}h left`}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{c.discipline} · {c.plan_id}</div>
                <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 4 }}>
                  Reviewer: {c.reviewer_determination}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{c.reviewer_name || "Reviewer"}</div>
              </div>
            );
          })}
        </div>

        {/* Review Panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
          {!selected ? (
            <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⚕</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Medical Director Review</div>
              <div style={{ fontSize: 14, color: "#64748b" }}>Select a case from the queue to begin co-signature review. All adverse determinations require MD sign-off before the provider is notified.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {/* Case Header */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: NAVY }}>{selected.member_name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>ID: {selected.member_id} · DOB: {selected.dob || "N/A"} · {selected.discipline} · {selected.plan_id}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>Case ID</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, fontFamily: "monospace" }}>{selected.submission_id?.slice(0, 12)}...</div>
                  </div>
                </div>
                {/* Reviewer Finding */}
                <div style={{ background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Reviewer Finding</div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#92400e" }}>Determination</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#c2410c" }}>{selected.reviewer_determination}</div>
                    </div>
                    {selected.reviewer_approved_visits != null && (
                      <div>
                        <div style={{ fontSize: 11, color: "#92400e" }}>Approved Visits</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#c2410c" }}>{selected.reviewer_approved_visits}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 11, color: "#92400e" }}>Engine Recommendation</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>{selected.engine_determination || "N/A"} ({selected.engine_confidence || "—"})</div>
                    </div>
                  </div>
                  {selected.reviewer_notes && (
                    <div style={{ marginTop: 12, fontSize: 12, color: "#7c2d12" }}>
                      <span style={{ fontWeight: 700 }}>Reviewer rationale: </span>{selected.reviewer_notes}
                    </div>
                  )}
                </div>
              </div>

              {/* MD Action Panel */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>MD Co-Signature Action</div>

                {/* Action Selector */}
                <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                  {[
                    { key: "uphold",   label: "Uphold",          desc: "Agree with reviewer",     color: "#dc2626" },
                    { key: "override", label: "Override",         desc: "Change determination",    color: "#d97706" },
                    { key: "revision", label: "Request Revision", desc: "Return to reviewer",      color: "#2563eb" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => { setAction(opt.key); setMdNotes(""); }}
                      style={{ flex: 1, padding: "12px 8px", borderRadius: 8, border: `2px solid ${action === opt.key ? opt.color : "#e2e8f0"}`, background: action === opt.key ? opt.color : "#fff", color: action === opt.key ? "#fff" : "#374151", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>

                {action === "override" && (
                  <div style={{ background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 10 }}>Override Determination</div>
                    <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                      {["Approved", "Partial Denial", "Full Denial", "Pend"].map(det => (
                        <button key={det} onClick={() => setOverrideDet(det)}
                          style={{ padding: "6px 12px", borderRadius: 6, border: `1.5px solid ${overrideDet === det ? "#d97706" : "#e2e8f0"}`, background: overrideDet === det ? "#fef3c7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: overrideDet === det ? 700 : 400 }}>
                          {det}
                        </button>
                      ))}
                    </div>
                    <label style={{ fontSize: 12, color: "#7c2d12" }}>Approved visits (if applicable)
                      <input type="number" min={0} value={overrideVisits} onChange={e => setOverrideVisits(e.target.value)}
                        placeholder="e.g. 12" style={{ display: "block", marginTop: 4, width: 120, padding: "6px 10px", borderRadius: 6, border: "1px solid #fed7aa", fontSize: 13 }} />
                    </label>
                  </div>
                )}

                {action && (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>MD Notes {action === "revision" ? "(required — explain what needs revision)" : "(optional — will appear in audit trail)"}</div>
                      <textarea value={mdNotes} onChange={e => setMdNotes(e.target.value)} rows={4}
                        placeholder={action === "revision" ? "Describe what the reviewer should reconsider or document..." : "Clinical rationale or co-signature notes..."}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                    </div>
                    <button onClick={handleSubmit} disabled={submitting || (action === "revision" && !mdNotes.trim())}
                      style={{ background: action === "revision" ? "#2563eb" : action === "override" ? "#d97706" : "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1 }}>
                      {submitting ? "Recording..." : action === "uphold" ? "Co-Sign & Uphold" : action === "override" ? "Co-Sign & Override" : "Send Back for Revision"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>}
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
  if (user.role === "medical_director") {
    return <MDShell user={user} token={token} onLogout={handleLogout} />;
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
