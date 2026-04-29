import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://cogentus-backend.onrender.com";

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

// --- ReviewSection ----------------------------------------------------------
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

  return (
    <div
      style={{
        borderBottom: "1px solid #e5e7eb",
        background: isExpanded ? "#f8fafc" : "#fff",
      }}
    >
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
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    marginBottom: 20,
    boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
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
          background: "#1e3a5f",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
              style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}
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
        background: "#f3f4f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 48,
              height: 48,
              background: "#1e3a5f",
              borderRadius: 12,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 12,
            }}
          >
            <span style={{ color: "#fff", fontSize: 24, fontWeight: 700 }}>C</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#1e3a5f", letterSpacing: "-0.01em" }}>
            Cogentus
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Clinical Review</p>
        </div>

        {/* Card */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "32px 28px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <h2 style={{ margin: "0 0 24px", fontSize: 17, fontWeight: 700, color: "#111827" }}>
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
                background: loading ? "#93c5fd" : "#1e3a5f",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                padding: "11px",
                fontSize: 15,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.2s",
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
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };
  const cardHeader = {
    padding: "12px 20px",
    background: "#1e3a5f",
  };
  const cardTitle = {
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6b7280", fontSize: 14 }}>Loading analytics...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
        background: "#f3f4f6",
        padding: "32px 16px 60px",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      }}
    >
      <div style={{ maxWidth: 740, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, background: "#1e3a5f", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>C</span>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1e3a5f", letterSpacing: "-0.01em" }}>
                My Dashboard
              </h1>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{user?.name || user?.email}</p>
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
            <div key={label} style={{ ...card, padding: "18px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 6 }}>
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
                  <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, marginTop: 4 }}>{label}</div>
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

// --- App --------------------------------------------------------------------
function App() {
  // Auth state — initialised from localStorage
  const [token, setToken] = useState(() => localStorage.getItem("cogentus_token") || "");
  const [user, setUser]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("cogentus_user") || "null"); }
    catch { return null; }
  });

  // View state
  const [view, setView] = useState("reviews"); // "reviews" | "dashboard"

  // Review form state
  const [reviewType, setReviewType]           = useState("initial");
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

  const buildFormData = () => {
    const fd = new FormData();
    files.forEach(f => fd.append("pdfs", f));
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
      "Generated by Cogentus Clinical Intelligence",
      "This determination is based on submitted clinical documentation and published evidence-based guidelines.",
      "For questions contact your utilization review supervisor.",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `Cogentus_Review_${icd10}_${fileDateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sections = review ? parseReview(review) : null;

  // Shared style tokens
  const card = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    marginBottom: 20,
    boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };
  const fieldWrap = { marginBottom: 18 };
  const labelEl = (text) => (
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
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      }}
    >
      <div style={{ maxWidth: 740, margin: "0 auto" }}>

        {/* -- Page header -- */}
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
              <span style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>C</span>
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
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Clinical Review</p>
            </div>
          </div>

          {/* Reviewer info + dashboard + logout */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => setView("dashboard")}
              style={{
                background: "none",
                border: "1px solid #1e3a5f",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 13,
                fontWeight: 600,
                color: "#1e3a5f",
                cursor: "pointer",
              }}
            >
              Dashboard
            </button>
            <span style={{ fontSize: 13, color: "#4b5563" }}>
              {user.name || user.email}
            </span>
            <button
              onClick={handleLogout}
              style={{
                background: "none",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                cursor: "pointer",
              }}
            >
              Log out
            </button>
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
                placeholder="Paste the prior reviewer note here — Cogentus will use it to compare against the current documentation."
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
                gap: 10,
                padding: "9px 14px",
                border: "1px dashed #d1d5db",
                borderRadius: 7,
                cursor: "pointer",
                background: "#f9fafb",
                fontSize: 14,
                color: files.length > 0 ? "#1e3a5f" : "#6b7280",
              }}
            >
              <span>
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 24px",
                background: "#1e3a5f",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Generated Review
              </span>
              <div style={{ display: "flex", gap: 8 }}>
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
