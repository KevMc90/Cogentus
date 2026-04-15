import React, { useState } from "react";
import axios from "axios";

const NAVY = "#1e3a5f";
const MINT = "#3eb489";

const SECTION_LABELS = [
  "HPI/Care History",
  "Clinical Summary",
  "POC",
  "Requested Visits",
  "Determination and Rationale",
  "Approved Visits",
];

function parseReview(text) {
  const escaped = SECTION_LABELS.map((l) =>
    l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(
    `(${escaped.join("|")}):\\s*([\\s\\S]*?)(?=(?:${escaped.join("|")}):|\s*$)`,
    "g"
  );
  const sections = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    sections.push({ label: match[1], content: match[2].trim() });
  }
  return sections.length > 0 ? sections : null;
}

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://rapidnote-backend.onrender.com";

function App() {
  const [reviewType, setReviewType] = useState("initial");
  const [hpi, setHpi] = useState("");
  const [careHistory, setCareHistory] = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [poc, setPoc] = useState("");
  const [file, setFile] = useState(null);
  const [priorNote, setPriorNote] = useState("");
  const [review, setReview] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const buildFormData = () => {
    const formData = new FormData();

    formData.append("document", file);

    // IMPORTANT: send fields as multipart form fields (not query params)
    formData.append("reviewType", reviewType);
    formData.append("hpi", hpi.trim());
    formData.append("careHistory", careHistory.trim());
    formData.append("requestedVisits", String(parseInt(requestedVisits || "0", 10)));
    formData.append("poc", poc.trim());

    if (reviewType === "subsequent") {
      formData.append("priorNote", priorNote.trim());
    }

    return formData;
  };

  const handleSubmit = async () => {
    setError("");
    setReview("");
    setMetrics(null);

    if (!file) {
      setError("PDF is required.");
      return;
    }
    if (!requestedVisits) {
      setError("Requested Visits is required.");
      return;
    }
    if (!poc.trim()) {
      setError("Plan of Care is required (example: 2x6).");
      return;
    }

    setLoading(true);
    try {
      const formData = buildFormData();

      const response = await axios.post(
        `${API_BASE}/api/generate-review`,
        formData
      );

      setReview(response.data.review || "");
    } catch (err) {
      // Show friendly backend message if present
      const backendMsg = err?.response?.data?.error;
      setError(backendMsg ? backendMsg : `Error generating review: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    setError("");
    setMetrics(null);

    if (!file) {
      setError("PDF is required to preview metrics.");
      return;
    }

    // NOTE: Your backend code you pasted does NOT include /api/preview-metrics.
    // This keeps the button but shows a clear message if endpoint is missing.
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("document", file);

      const res = await axios.post(
        `${API_BASE}/api/preview-metrics`,
        formData
      );

      setMetrics(res.data.metrics);
    } catch (err) {
      const backendMsg = err?.response?.data?.error;
      setError(
        backendMsg
          ? backendMsg
          : "Preview endpoint not available yet. (Backend needs /api/preview-metrics implemented.)"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">RapidNote Review Generator</h1>

      <div className="mb-3">
        <label className="block font-semibold">Review Type</label>
        <select
          value={reviewType}
          onChange={(e) => setReviewType(e.target.value)}
          className="border px-2 py-1"
        >
          <option value="initial">Initial</option>
          <option value="subsequent">Subsequent</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input
          placeholder="HPI"
          value={hpi}
          onChange={(e) => setHpi(e.target.value)}
          className="border p-2"
        />
        <input
          placeholder="Care History"
          value={careHistory}
          onChange={(e) => setCareHistory(e.target.value)}
          className="border p-2"
        />
        <input
          placeholder="Requested Visits"
          type="number"
          value={requestedVisits}
          onChange={(e) => setRequestedVisits(e.target.value)}
          className="border p-2"
        />
        <input
          placeholder="Plan of Care (e.g. 2x6)"
          value={poc}
          onChange={(e) => setPoc(e.target.value)}
          className="border p-2"
        />
      </div>

      <div className="my-3">
        <label className="block font-semibold">Attach Supporting Documents (PDF) *</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="block"
        />
      </div>

      {reviewType === "subsequent" && (
        <textarea
          placeholder="Paste prior reviewer note here"
          value={priorNote}
          onChange={(e) => setPriorNote(e.target.value)}
          className="w-full border p-2 h-32 mb-3"
        />
      )}

      {error && (
        <div className="my-3 border border-red-300 bg-red-50 text-red-800 p-3 rounded">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="bg-blue-600 disabled:opacity-50 text-white px-4 py-2 rounded"
        >
          {loading ? "Working..." : "Generate Review"}
        </button>

        <button
          onClick={handlePreview}
          disabled={loading}
          className="bg-gray-600 disabled:opacity-50 text-white px-4 py-2 rounded"
        >
          {loading ? "Working..." : "Preview Metrics"}
        </button>
      </div>

      {metrics && (
        <div className="mt-6 border p-4 bg-gray-100 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-2">Parsed Metrics Preview</h2>

          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold">ROM</h3>
              <ul className="list-disc list-inside">
                {Object.entries(metrics.rom).map(([k, v]) => (
                  <li key={k}>{k}: {v}°</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="font-semibold">MMT</h3>
              <ul className="list-disc list-inside">
                {Object.keys(metrics.mmt).map((grade) => (
                  <li key={grade}>{grade}/5</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="font-semibold">Pain</h3>
              <p>{metrics.pain}/10</p>
            </div>

            <div className="col-span-2">
              <h3 className="font-semibold">Functional Limitations</h3>
              <p>{metrics.function || "None detected"}</p>
            </div>

            <div className="col-span-2">
              <h3 className="font-semibold">Goals</h3>
              <ul className="list-disc list-inside">
                {metrics.goals?.length > 0
                  ? metrics.goals.map((g, i) => <li key={i}>{g}</li>)
                  : <li>No goals extracted</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {review && (() => {
        const sections = parseReview(review);
        return (
          <div className="mt-6 border rounded-lg overflow-hidden shadow">
            {/* Card header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ backgroundColor: NAVY }}
            >
              <h2 className="text-white font-semibold text-base">Generated Review</h2>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(review);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{ color: copied ? MINT : "white", border: `1px solid ${copied ? MINT : "white"}` }}
                className="text-sm px-3 py-1 rounded transition-colors duration-200"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* Sections */}
            {sections ? (
              <div className="bg-gray-50">
                {sections.map((sec, i) => (
                  <div
                    key={sec.label}
                    className="px-4 py-3"
                    style={i < sections.length - 1 ? { borderBottom: "2px solid #e5e7eb" } : {}}
                  >
                    <span
                      className="font-bold"
                      style={{ color: NAVY, fontSize: "15px" }}
                    >
                      {sec.label}:
                    </span>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{sec.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-3 bg-gray-50 whitespace-pre-wrap text-sm text-gray-800">
                {review}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default App;
