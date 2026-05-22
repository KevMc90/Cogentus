import React, { useState, useEffect, useCallback, useRef } from "react";

// ── DESIGN TOKENS ──────────────────────────────────────────────────────────────
const NAVY      = "#1a3a5c";
const NAVY_DARK = "#0d1b2a";
const NAVY_MID  = "#2d5a8e";
const FONTS     = { heading: "'Fraunces', Georgia, serif", body: "'Public Sans', system-ui, sans-serif" };

// ── SYNTHETIC QUEUE ────────────────────────────────────────────────────────────
// All names/IDs/dates are fictitious. No PHI.
const QUEUE = [
  {
    caseId: "SYNTH-001",
    memberName: "Alex Rivera",
    memberId: "MBR-10042",
    dob: "03/15/1978",
    discipline: "PT",
    reviewType: "initial",
    submittedAt: "2026-05-22T09:15:00Z",
    documents: [{ name: "Initial_Eval_Rivera_05022026.pdf", type: "Initial Evaluation", date: "05/02/2026" }],
    contract: {
      extraction: {
        rom: { "Shldr Flex": 110, "Shldr Abd": 95, "Shldr ER": 55 },
        romNormals: { "Shldr Flex": 180, "Shldr Abd": 180, "Shldr ER": 90 },
        mmt: { Supraspinatus: "3/5", Deltoid: "4−/5", Biceps: "4/5" },
        painCurrent: "6/10 rest, 9/10 overhead",
        functionalOutcomeScore: null,
        goals: ["Increase shoulder flex to 150° within 6 wks", "Return to overhead reaching for ADLs"],
        poc: "2x/week × 6 weeks",
        diagnosisCodes: ["M25.561"],
        primaryDiagnosisCode: "M25.561",
        primaryDiagnosis: "Left shoulder pain — rotator cuff",
        requestedVisits: 12,
        requestedFrequency: "2x/week × 6 weeks",
        severity: "severe",
        functionalLimitations: ["Unable to reach overhead", "Difficulty with dressing", "Cannot lift above shoulder"],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: true, hasPOC: true,
          hasStandardizedOutcomeMeasure: false, goalsMeasurable: true,
          goalsFunctional: true, goalsHaveTimeframes: true, hasHEP: false,
        },
        sopIndicators: ["Manual therapy", "Therapeutic exercise", "Neuromuscular re-education"],
        goalsTotal: 2, goalsMet: 0, visitsToDate: 0,
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "Clinical deficits present; skilled care criteria met." },
        d2: { finding: "FULLY_ALIGNED", supportedFreq: 2, supportedDuration: 8, supportedVisits: 16, pocMaxVisits: 12, reasoning: "" },
        d3: { finding: "COMPLETE", gaps: [], notes: ["No standardized outcome measure documented."] },
      },
      recommendation: {
        determination: "Approved",
        approvedVisits: 12, frequency: 2, durationWeeks: 6,
        criteria: [
          "Pain 6/10; ROM: Flex 110°/180°, Abd 95°/180°, ER 55°/90°",
          "MMT: Supraspinatus 3/5, Deltoid 4−/5, Biceps 4/5",
          "Skilled: Manual therapy, Therapeutic exercise, NMR",
          "APTA CPG Shoulder (2021): MCG typical 10 visits (p75: 16)",
        ],
        rationale: "Approved — Skilled PT is supported for Left shoulder pain (M25.561) with pain of 6/10, significant ROM deficits, and MMT averaging 3.7/5. Per APTA CPG, 2x/week is supported for severe presentation. Approving 12 visits at 2x/week × 6 weeks. Goals are functional, measurable with objective baselines, and demonstrate skilled rehabilitation need.",
        confidence: "high",
        autoApprovalEligible: true,
      },
      cpgInfo: { diagCode: "M25.561", conditionLabel: "Shoulder pain — non-operative", mcgTypical: 10, mcgP75: 16, mcgMax: 28, cpgCitation: "APTA CPG Shoulder (2021)" },
    },
  },
  {
    caseId: "SYNTH-002",
    memberName: "Sam Lewis",
    memberId: "MBR-20811",
    dob: "07/28/1965",
    discipline: "PT",
    reviewType: "subsequent",
    submittedAt: "2026-05-22T09:42:00Z",
    documents: [{ name: "Progress_Note_Lewis_05102026.pdf", type: "Progress Note", date: "05/10/2026" }],
    contract: {
      extraction: {
        rom: { "Knee Flex": 108, "Knee Ext": -5 },
        romNormals: { "Knee Flex": 135, "Knee Ext": 0 },
        mmt: { Quadriceps: "3+/5", Hamstrings: "4/5", "Hip Abd": "3/5" },
        painCurrent: "4/10",
        functionalOutcomeScore: "KOOS 52/100",
        goals: ["Knee flex to 120° within 4 wks", "Ascend/descend stairs independently"],
        poc: "3x/week × 6 weeks",
        diagnosisCodes: ["M17.11"],
        primaryDiagnosisCode: "M17.11",
        primaryDiagnosis: "Primary osteoarthritis, right knee",
        requestedVisits: 18,
        requestedFrequency: "3x/week × 6 weeks",
        severity: "moderate",
        functionalLimitations: ["Unable to ascend stairs without rail", "Difficulty with prolonged walking"],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: true, hasPOC: true,
          hasStandardizedOutcomeMeasure: true, goalsMeasurable: true,
          goalsFunctional: true, goalsHaveTimeframes: true, hasHEP: true,
        },
        sopIndicators: ["Therapeutic exercise", "Manual therapy", "Gait training"],
        goalsTotal: 2, goalsMet: 0, visitsToDate: 8,
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "Functional deficits persist; skilled care criteria met." },
        d2: { finding: "FREQUENCY_MISALIGNED", supportedFreq: 2, supportedDuration: 6, supportedVisits: 12, pocMaxVisits: 18, reasoning: "3x/week exceeds CPG max of 2x/week for moderate knee OA." },
        d3: { finding: "COMPLETE", gaps: [], notes: [] },
      },
      recommendation: {
        determination: "Partial Denial — Unsupported Frequency",
        approvedVisits: 11, frequency: 2, durationWeeks: 6,
        criteria: [
          "ROM: Knee Flex 108°/135°, Ext -5°/0°; KOOS 52/100",
          "Pain 4/10; 2 functional limitations; 8 VTD",
          "Requested 3x/week > CPG max 2x/week for moderate presentation",
          "APTA CPG Knee OA (2021): MCG typical 8 visits (p75: 12)",
        ],
        rationale: "Partial Denial — Unsupported Frequency: Skilled PT is supported for right knee OA (M17.11). Requested 3x/week exceeds the evidence-supported maximum of 2x/week per APTA CPG for moderate knee OA. Approving 11 visits at 2x/week × 6 weeks. Provider may resubmit with a revised plan of care.",
        confidence: "high",
        autoApprovalEligible: false,
      },
      cpgInfo: { diagCode: "M17.11", conditionLabel: "Knee osteoarthritis — non-operative", mcgTypical: 8, mcgP75: 12, mcgMax: 20, cpgCitation: "APTA CPG Knee OA (2021)" },
    },
  },
  {
    caseId: "SYNTH-003",
    memberName: "Casey Martinez",
    memberId: "MBR-31567",
    dob: "11/03/1988",
    discipline: "PT",
    reviewType: "initial",
    submittedAt: "2026-05-22T10:10:00Z",
    documents: [{ name: "IE_Martinez_05152026.pdf", type: "Initial Evaluation", date: "05/15/2026" }],
    contract: {
      extraction: {
        rom: { "Lumbar Flex": "fingertips to knees (limited)", "Lumbar Ext": "limited" },
        romNormals: {},
        mmt: {},
        painCurrent: "7/10 LBP, 5/10 left leg",
        functionalOutcomeScore: null,
        goals: [],
        poc: null,
        diagnosisCodes: ["M51.16"],
        primaryDiagnosisCode: "M51.16",
        primaryDiagnosis: "IVD degeneration, lumbar region",
        requestedVisits: 16,
        requestedFrequency: null,
        severity: "moderate",
        functionalLimitations: ["Unable to sit >20 min", "Cannot perform lifting tasks at work"],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: false, hasPOC: false,
          hasStandardizedOutcomeMeasure: false, goalsMeasurable: false,
          goalsFunctional: false, goalsHaveTimeframes: false, hasHEP: false,
        },
        sopIndicators: ["Therapeutic exercise", "Manual therapy"],
        goalsTotal: 0, goalsMet: null, visitsToDate: 0,
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "Pain and functional deficits documented; skilled indicators present." },
        d2: { finding: "VOLUME_MISALIGNED", supportedFreq: null, supportedDuration: null, supportedVisits: null, pocMaxVisits: null, reasoning: "No POC frequency or duration identified." },
        d3: { finding: "INCOMPLETE", gaps: ["goals", "poc"], notes: ["Treatment goals not identified in submitted documentation.", "Plan of care frequency not identified."] },
      },
      recommendation: {
        determination: "Pend",
        approvedVisits: 0, frequency: null, durationWeeks: null,
        criteria: [
          "Pain 7/10 LBP, 5/10 left leg; 2 functional limitations",
          "Missing: treatment goals (required per APTA standards)",
          "Missing: plan of care — frequency and duration not specified",
        ],
        rationale: "Pend — Insufficient Clinical Documentation: The following elements are required to complete this review: treatment goals, plan of care (frequency and duration). Please resubmit with complete documentation.",
        confidence: "low",
        autoApprovalEligible: false,
      },
      cpgInfo: { diagCode: "M51.16", conditionLabel: "Lumbar disc degeneration — non-operative", mcgTypical: 10, mcgP75: 14, mcgMax: 20, cpgCitation: "APTA CPG Lumbar Spine (2021)" },
    },
  },
];

// ── HELPERS ────────────────────────────────────────────────────────────────────
function detColors(determination) {
  if (!determination) return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db", glow: "transparent" };
  const d = determination.toLowerCase();
  if (d.startsWith("approved"))     return { bg: "#dcfce7", text: "#15803d", border: "#86efac", glow: "#22c55e33" };
  if (d.startsWith("partial"))      return { bg: "#fef3c7", text: "#92400e", border: "#fcd34d", glow: "#f59e0b33" };
  if (d.startsWith("full denial"))  return { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5", glow: "#ef444433" };
  if (d.startsWith("pend"))         return { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd", glow: "#3b82f633" };
  return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db", glow: "transparent" };
}

function domainColors(finding) {
  if (!finding || finding === "UNKNOWN") return { bg: "#f3f4f6", text: "#374151" };
  if (finding.startsWith("FULLY") || finding === "COMPLETE") return { bg: "#dcfce7", text: "#166534" };
  if (finding.includes("ESTABLISHED") || finding.includes("ALIGNED")) return { bg: "#dcfce7", text: "#166534" };
  if (finding === "INCOMPLETE" || finding.includes("PARTIALLY")) return { bg: "#fef3c7", text: "#92400e" };
  return { bg: "#fee2e2", text: "#991b1b" };
}

function domainLabel(key, finding) {
  const short = finding
    .replace("FULLY_", "").replace("NOT_ESTABLISHED_", "").replace("_", " ")
    .toLowerCase().replace(/^\w/, c => c.toUpperCase());
  const labels = { d1: "D1 Clinical", d2: "D2 Evidence", d3: "D3 Docs" };
  return { key: labels[key] || key.toUpperCase(), finding: short };
}

function confidenceStyle(c) {
  if (c === "high")     return { color: "#15803d", label: "HIGH" };
  if (c === "moderate") return { color: "#92400e", label: "MED" };
  return { color: "#6b7280", label: "LOW" };
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function disciplineLabel(d, rt) {
  const disc = d || "PT";
  const type = rt === "subsequent" ? "SUB" : "IE";
  return `${disc} · ${type}`;
}

// ── KEYBOARD HINT CHIP ──────────────────────────────────────────────────────────
function KbdChip({ k, label, style }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, ...style }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, borderRadius: 4,
        background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.3)",
        fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: FONTS.body, flexShrink: 0,
      }}>{k}</span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontFamily: FONTS.body }}>{label}</span>
    </span>
  );
}

// ── ZONE HEADER ────────────────────────────────────────────────────────────────
function ZoneHeader({ title }) {
  return (
    <div style={{
      padding: "12px 20px 11px",
      borderBottom: "1px solid #e2e8f0",
      background: "#f8fafc",
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
        textTransform: "uppercase", color: "#64748b",
        fontFamily: FONTS.body,
      }}>{title}</span>
    </div>
  );
}

// ── EVIDENCE ZONE ──────────────────────────────────────────────────────────────
function EvidenceZone({ kase }) {
  const ex  = kase.contract.extraction;
  const rec = kase.contract.recommendation;
  const hasROM = ex.rom && Object.keys(ex.rom).length > 0;
  const hasMMT = ex.mmt && Object.keys(ex.mmt).length > 0;

  const sevColor = rec.confidence === "high" ? "#15803d"
    : rec.determination.toLowerCase().startsWith("pend") ? "#1d4ed8" : "#92400e";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <ZoneHeader title="Clinical Evidence" />
      <div style={{ padding: "16px 20px", flex: 1 }}>

        {/* Member header */}
        <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: NAVY, fontFamily: FONTS.heading, lineHeight: 1.2 }}>
            {kase.memberName}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>DOB {kase.dob}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1" }}>·</span>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>{kase.memberId}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1" }}>·</span>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>{disciplineLabel(kase.discipline, kase.reviewType)}</span>
          </div>
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, fontFamily: "monospace" }}>
              {ex.primaryDiagnosisCode}
            </span>
            <span style={{ fontSize: 12, color: "#374151", fontFamily: FONTS.body }}>{ex.primaryDiagnosis}</span>
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
              background: sevColor + "18", color: sevColor, fontFamily: FONTS.body,
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>
              {ex.severity || "—"}
            </span>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: FONTS.body }}>
              {ex.visitsToDate || 0} VTD
            </span>
          </div>
        </div>

        {/* Pain */}
        {ex.painCurrent && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4, fontFamily: FONTS.body }}>Pain</div>
            <div style={{ fontSize: 14, color: "#1e293b", fontFamily: FONTS.body }}>{ex.painCurrent}</div>
          </div>
        )}

        {/* ROM table */}
        {hasROM && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>ROM</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Movement", "Measured", "Normal"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "4px 6px", fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(ex.rom).map(([joint, val]) => {
                  const norm = ex.romNormals && ex.romNormals[joint];
                  const numVal = typeof val === "number" ? val : parseFloat(val);
                  const pctDef = (norm && !isNaN(numVal)) ? Math.round(((norm - numVal) / norm) * 100) : null;
                  return (
                    <tr key={joint} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "5px 6px", color: "#374151", fontFamily: FONTS.body }}>{joint}</td>
                      <td style={{ padding: "5px 6px", fontWeight: 600, color: pctDef && pctDef > 15 ? "#dc2626" : "#1e293b", fontFamily: FONTS.body }}>
                        {typeof val === "number" ? `${val}°` : val}
                        {pctDef !== null && pctDef > 5 && <span style={{ fontSize: 10, color: "#dc2626", marginLeft: 4 }}>{pctDef}%↓</span>}
                      </td>
                      <td style={{ padding: "5px 6px", color: "#9ca3af", fontFamily: FONTS.body }}>
                        {norm != null ? `${norm}°` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* MMT table */}
        {hasMMT && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>MMT</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {Object.entries(ex.mmt).map(([muscle, grade]) => (
                  <tr key={muscle} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "5px 6px", color: "#374151", fontFamily: FONTS.body }}>{muscle}</td>
                    <td style={{ padding: "5px 6px", fontWeight: 600, fontFamily: "monospace", color: parseFloat(grade) < 4 ? "#dc2626" : "#1e293b" }}>
                      {grade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Functional outcome */}
        {ex.functionalOutcomeScore && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4, fontFamily: FONTS.body }}>Outcome Score</div>
            <div style={{ fontSize: 13, color: "#1e293b", fontFamily: FONTS.body, fontWeight: 600 }}>{ex.functionalOutcomeScore}</div>
          </div>
        )}

        {/* Functional limitations */}
        {ex.functionalLimitations && ex.functionalLimitations.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Functional Limitations</div>
            {ex.functionalLimitations.map((lim, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
                <span style={{ color: "#dc2626", fontSize: 11, marginTop: 2, flexShrink: 0 }}>✕</span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>{lim}</span>
              </div>
            ))}
          </div>
        )}

        {/* Goals */}
        {ex.goals && ex.goals.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>
              Goals — {ex.goalsMet || 0}/{ex.goalsTotal || ex.goals.length} met
            </div>
            {ex.goals.map((g, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
                <span style={{ color: "#22c55e", fontSize: 11, marginTop: 2, flexShrink: 0 }}>◎</span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>{g}</span>
              </div>
            ))}
          </div>
        )}
        {ex.goalsTotal === 0 && (
          <div style={{ marginBottom: 14, padding: "8px 10px", background: "#fef3c7", borderRadius: 6, border: "1px solid #fcd34d" }}>
            <span style={{ fontSize: 12, color: "#92400e", fontFamily: FONTS.body }}>No treatment goals documented</span>
          </div>
        )}

        {/* Doc quality gaps */}
        {ex.documentationQuality && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Doc Quality</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {Object.entries(ex.documentationQuality).filter(([k]) => k !== "missingElements").map(([key, val]) => {
                const labels = {
                  hasEvalDate: "Date", hasDiagnosisCodes: "Dx", hasObjectiveMeasures: "Obj",
                  hasFunctionalLimitations: "FxLim", hasGoals: "Goals", hasPOC: "POC",
                  hasStandardizedOutcomeMeasure: "Outcome", goalsMeasurable: "Measurable",
                  goalsFunctional: "Functional", goalsHaveTimeframes: "Timeframes", hasHEP: "HEP",
                };
                const label = labels[key];
                if (!label) return null;
                return (
                  <span key={key} style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                    background: val ? "#dcfce7" : "#fee2e2",
                    color: val ? "#166534" : "#991b1b",
                    fontFamily: FONTS.body, letterSpacing: "0.04em",
                  }}>
                    {val ? "✓" : "✗"} {label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── RECOMMENDATION ZONE ────────────────────────────────────────────────────────
function RecommendationZone({ kase }) {
  const rec  = kase.contract.recommendation;
  const asmn = kase.contract.assessment;
  const cpg  = kase.contract.cpgInfo;
  const dc   = detColors(rec.determination);
  const cs   = confidenceStyle(rec.confidence);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <ZoneHeader title="Recommendation" />
      <div style={{ padding: "16px 20px", flex: 1 }}>

        {/* Determination badge */}
        <div style={{
          padding: "12px 16px", borderRadius: 8, border: `1px solid ${dc.border}`,
          background: dc.bg, marginBottom: 16,
          boxShadow: `0 0 0 3px ${dc.glow}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: dc.text, fontFamily: FONTS.heading, lineHeight: 1.3 }}>
            {rec.determination}
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: dc.text, fontFamily: FONTS.body, opacity: 0.85 }}>
              <strong>{rec.approvedVisits}</strong> visits
            </span>
            {rec.frequency && rec.durationWeeks && (
              <span style={{ fontSize: 12, color: dc.text, fontFamily: FONTS.body, opacity: 0.85 }}>
                {rec.frequency}x/wk × {rec.durationWeeks} wks
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, color: cs.color, fontFamily: FONTS.body }}>
              {cs.label} confidence
            </span>
          </div>
          {rec.autoApprovalEligible && (
            <div style={{
              marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 4, background: "#166534", color: "#fff",
              fontSize: 10, fontWeight: 700, fontFamily: FONTS.body, letterSpacing: "0.05em",
            }}>
              ✓ Auto-approval eligible
            </div>
          )}
        </div>

        {/* Domain findings */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: FONTS.body }}>Three Domain Assessment</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {["d1", "d2", "d3"].map(key => {
              const domain = asmn[key];
              const dc2    = domainColors(domain.finding);
              const lbl    = domainLabel(key, domain.finding);
              return (
                <div key={key} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "7px 10px", borderRadius: 6, border: "1px solid #f1f5f9", background: "#fafafa",
                }}>
                  <span style={{
                    flex: "0 0 72px", fontSize: 10, fontWeight: 700, color: "#374151",
                    fontFamily: FONTS.body, paddingTop: 1,
                  }}>{lbl.key}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                    background: dc2.bg, color: dc2.text, fontFamily: FONTS.body,
                    letterSpacing: "0.04em", flex: "0 0 auto",
                  }}>{lbl.finding}</span>
                  {domain.reasoning && (
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: FONTS.body, lineHeight: 1.3, flex: 1 }}>
                      {domain.reasoning}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Criteria bullets */}
        {rec.criteria && rec.criteria.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Criteria</div>
            {rec.criteria.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 7, marginBottom: 5, alignItems: "flex-start" }}>
                <span style={{ color: NAVY_MID, fontSize: 10, marginTop: 2, flexShrink: 0, fontWeight: 700 }}>▸</span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>{c}</span>
              </div>
            ))}
          </div>
        )}

        {/* CPG reference */}
        {cpg && (
          <div style={{ marginBottom: 16, padding: "8px 10px", background: "#eff6ff", borderRadius: 6, border: "1px solid #bfdbfe" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", fontFamily: FONTS.body, marginBottom: 2 }}>CPG Reference</div>
            <div style={{ fontSize: 11, color: "#1e3a5f", fontFamily: FONTS.body }}>
              {cpg.cpgCitation} · MCG typical: <strong>{cpg.mcgTypical}</strong> · p75: <strong>{cpg.mcgP75}</strong>
            </div>
          </div>
        )}

        {/* Rationale */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Rationale</div>
          <div style={{
            fontSize: 12, lineHeight: 1.7, color: "#374151", fontFamily: FONTS.body,
            background: "#f8fafc", padding: "10px 12px", borderRadius: 6, border: "1px solid #e2e8f0",
          }}>
            {rec.rationale}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── ACTION BUTTON ──────────────────────────────────────────────────────────────
function ActionBtn({ kbd, label, color, bg, border, onClick, disabled, style }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "11px 14px",
        border: `1.5px solid ${disabled ? "#e2e8f0" : border}`,
        borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? "#f8fafc" : hover ? bg + "dd" : bg,
        transition: "all 0.12s",
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      <span style={{
        width: 24, height: 24, borderRadius: 5,
        background: disabled ? "#e2e8f0" : border,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 800, color: disabled ? "#9ca3af" : color,
        fontFamily: FONTS.body, flexShrink: 0,
      }}>{kbd}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: disabled ? "#9ca3af" : color, fontFamily: FONTS.body }}>{label}</span>
    </button>
  );
}

// ── DETERMINATION ZONE ─────────────────────────────────────────────────────────
function DeterminationZone({ kase, cursor, total, decisions, actionState, partialVisits,
  onAction, onPartialVisitsChange, onPartialSubmit, onDenyConfirm, onCancelAction,
  onNavigate, onToggleDocs, showDocs }) {

  const decided    = decisions[kase.caseId];
  const rec        = kase.contract.recommendation;
  const partialRef = useRef(null);

  useEffect(() => {
    if (actionState === "partial_input" && partialRef.current) {
      partialRef.current.focus();
    }
  }, [actionState]);

  const decColor = decided ? detColors(decided.determination) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <ZoneHeader title="Determination" />
      <div style={{ padding: "16px 20px", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Decided overlay */}
        {decided && (
          <div style={{
            padding: "12px 14px", borderRadius: 8, border: `1.5px solid ${decColor.border}`,
            background: decColor.bg, textAlign: "center",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: decColor.text, fontFamily: FONTS.heading }}>
              {decided.determination}
            </div>
            {decided.approvedVisits != null && (
              <div style={{ fontSize: 11, color: decColor.text, marginTop: 3, fontFamily: FONTS.body, opacity: 0.8 }}>
                {decided.approvedVisits} visits approved
              </div>
            )}
            <div style={{ fontSize: 10, color: decColor.text, marginTop: 4, fontFamily: FONTS.body, opacity: 0.6 }}>
              Recorded — use J/K to navigate
            </div>
          </div>
        )}

        {/* Deny confirmation banner */}
        {actionState === "deny_confirm" && !decided && (
          <div style={{
            padding: "12px 14px", borderRadius: 8, border: "1.5px solid #fca5a5",
            background: "#fef2f2", animation: "rn-fadein 0.15s ease-out",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", fontFamily: FONTS.heading, marginBottom: 4 }}>
              Confirm denial?
            </div>
            <div style={{ fontSize: 11, color: "#dc2626", fontFamily: FONTS.body, marginBottom: 8 }}>
              Press D again to confirm full denial, or Esc to cancel.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onDenyConfirm} style={{
                flex: 1, padding: "6px 0", borderRadius: 6, border: "1.5px solid #ef4444",
                background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 700,
                cursor: "pointer", fontFamily: FONTS.body,
              }}>Confirm Denial</button>
              <button onClick={onCancelAction} style={{
                flex: 1, padding: "6px 0", borderRadius: 6, border: "1.5px solid #e2e8f0",
                background: "#fff", color: "#374151", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: FONTS.body,
              }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Partial input form */}
        {actionState === "partial_input" && !decided && (
          <div style={{
            padding: "12px 14px", borderRadius: 8, border: "1.5px solid #fcd34d",
            background: "#fffbeb", animation: "rn-fadein 0.15s ease-out",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", fontFamily: FONTS.heading, marginBottom: 8 }}>
              Partial Denial — set approved visits
            </div>
            <div style={{ fontSize: 11, color: "#78350f", fontFamily: FONTS.body, marginBottom: 8 }}>
              Engine recommends {rec.approvedVisits} visits. Enter override or press Enter to accept.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                ref={partialRef}
                type="number" min="0"
                value={partialVisits}
                onChange={e => onPartialVisitsChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") onPartialSubmit(); if (e.key === "Escape") onCancelAction(); }}
                placeholder={String(rec.approvedVisits)}
                style={{
                  flex: 1, padding: "7px 10px", borderRadius: 6, border: "1.5px solid #fcd34d",
                  fontSize: 13, fontFamily: FONTS.body, outline: "none",
                  background: "#fff", color: "#1e293b",
                }}
              />
              <button onClick={onPartialSubmit} style={{
                padding: "7px 14px", borderRadius: 6, border: "1.5px solid #f59e0b",
                background: "#f59e0b", color: "#fff", fontSize: 12, fontWeight: 700,
                cursor: "pointer", fontFamily: FONTS.body, whiteSpace: "nowrap",
              }}>Record</button>
              <button onClick={onCancelAction} style={{
                padding: "7px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0",
                background: "#fff", color: "#374151", fontSize: 12,
                cursor: "pointer", fontFamily: FONTS.body,
              }}>Esc</button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!decided && actionState === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ActionBtn kbd="A" label="Approve" color="#166534" bg="#dcfce7" border="#86efac"
              onClick={() => onAction("approve")} />
            <ActionBtn kbd="P" label="Partial Denial" color="#92400e" bg="#fef3c7" border="#fcd34d"
              onClick={() => onAction("partial")} />
            <ActionBtn kbd="D" label="Full Denial" color="#991b1b" bg="#fee2e2" border="#fca5a5"
              onClick={() => onAction("deny")} />
            <ActionBtn kbd="N" label="Pend" color="#1d4ed8" bg="#eff6ff" border="#93c5fd"
              onClick={() => onAction("pend")} />
          </div>
        )}

        {/* Divider */}
        <div style={{ borderTop: "1px solid #f1f5f9" }} />

        {/* Document toggle */}
        <button
          onClick={onToggleDocs}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0",
            background: showDocs ? NAVY : "#fff", cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: showDocs ? "#fff" : "#374151", fontFamily: FONTS.body }}>
            {showDocs ? "Hide Documents" : "View Documents"}
          </span>
          <span style={{ fontSize: 10, marginLeft: "auto", color: showDocs ? "rgba(255,255,255,0.6)" : "#9ca3af", fontFamily: FONTS.body }}>V</span>
        </button>

        {/* Divider */}
        <div style={{ borderTop: "1px solid #f1f5f9" }} />

        {/* Queue list */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: FONTS.body }}>
            Queue ({total}) · J prev · K next
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {QUEUE.map((q, i) => {
              const isCurrent = i === cursor;
              const dec       = decisions[q.caseId];
              const dc2       = dec ? detColors(dec.determination) : null;
              return (
                <div
                  key={q.caseId}
                  onClick={() => onNavigate(i)}
                  style={{
                    padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                    border: `1.5px solid ${isCurrent ? NAVY_MID : "#e2e8f0"}`,
                    background: isCurrent ? "#eff6ff" : "#fff",
                    transition: "all 0.1s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: isCurrent ? NAVY_MID : "#94a3b8", fontFamily: FONTS.body, width: 14 }}>{isCurrent ? "●" : "○"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b", fontFamily: FONTS.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.memberName}</div>
                      <div style={{ fontSize: 10, color: "#6b7280", fontFamily: FONTS.body }}>{q.caseId} · {disciplineLabel(q.discipline, q.reviewType)}</div>
                    </div>
                    {dc2 && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                        background: dc2.bg, color: dc2.text, fontFamily: FONTS.body, flexShrink: 0,
                        border: `1px solid ${dc2.border}`,
                      }}>
                        {dec.determination.split(" ")[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── DOCUMENTS PANEL ────────────────────────────────────────────────────────────
function DocumentsPanel({ kase, onClose }) {
  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 360,
      background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", zIndex: 100,
      animation: "rn-slidein 0.18s ease-out",
    }}>
      <div style={{
        padding: "14px 20px", background: NAVY,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading }}>Documents</span>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.28)",
          borderRadius: 5, padding: "3px 10px", color: "#fff", fontSize: 12,
          cursor: "pointer", fontFamily: FONTS.body,
        }}>Esc / V</button>
      </div>
      <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
        {kase.documents.map((doc, i) => (
          <div key={i} style={{
            padding: "12px 14px", borderRadius: 8, border: "1px solid #e2e8f0",
            background: "#f8fafc", marginBottom: 10,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, fontFamily: FONTS.body, marginBottom: 4 }}>{doc.name}</div>
            <div style={{ fontSize: 11, color: "#6b7280", fontFamily: FONTS.body }}>
              {doc.type} · {doc.date}
            </div>
            <div style={{
              marginTop: 10, padding: "8px 10px", background: "#f0f4f8", borderRadius: 6,
              fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, textAlign: "center",
              border: "1px dashed #cbd5e1",
            }}>
              PDF viewer available in Phase 6
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── COCKPIT ROOT ───────────────────────────────────────────────────────────────
export default function Cockpit({ user, onBack }) {
  const [cursor, setCursor]               = useState(0);
  const [decisions, setDecisions]         = useState({});
  const [actionState, setActionState]     = useState("idle"); // idle | deny_confirm | partial_input
  const [partialVisits, setPartialVisits] = useState("");
  const [showDocs, setShowDocs]           = useState(false);

  const kase = QUEUE[cursor];

  const recordDecision = useCallback((determination, approvedVisits) => {
    setDecisions(prev => ({
      ...prev,
      [kase.caseId]: { determination, approvedVisits, recordedAt: new Date().toISOString() },
    }));
    setActionState("idle");
    setPartialVisits("");
  }, [kase]);

  const handleAction = useCallback((type) => {
    if (decisions[kase.caseId]) return;
    if (type === "approve") {
      recordDecision(kase.contract.recommendation.determination.startsWith("Approved") ? kase.contract.recommendation.determination : "Approved", kase.contract.recommendation.approvedVisits);
    } else if (type === "partial") {
      setPartialVisits(String(kase.contract.recommendation.approvedVisits));
      setActionState("partial_input");
    } else if (type === "deny") {
      setActionState("deny_confirm");
    } else if (type === "pend") {
      recordDecision("Pend", 0);
    }
  }, [kase, decisions, recordDecision]);

  const handleDenyConfirm = useCallback(() => {
    recordDecision("Full Denial", 0);
  }, [recordDecision]);

  const handlePartialSubmit = useCallback(() => {
    const v = parseInt(partialVisits, 10);
    recordDecision("Partial Denial", isNaN(v) ? kase.contract.recommendation.approvedVisits : v);
  }, [partialVisits, kase, recordDecision]);

  const handleNavigate = useCallback((i) => {
    setCursor(i);
    setActionState("idle");
    setPartialVisits("");
  }, []);

  // Keyboard handler
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      const key = e.key.toLowerCase();

      if (key === "escape") { setActionState("idle"); setShowDocs(false); return; }
      if (key === "v") { setShowDocs(s => !s); return; }
      if (key === "j" && cursor > 0) { handleNavigate(cursor - 1); return; }
      if (key === "k" && cursor < QUEUE.length - 1) { handleNavigate(cursor + 1); return; }

      if (decisions[kase.caseId]) return; // already decided

      if (key === "a" && actionState === "idle") { handleAction("approve"); return; }
      if (key === "p" && actionState === "idle") { handleAction("partial"); return; }
      if (key === "n" && actionState === "idle") { handleAction("pend"); return; }
      if (key === "d") {
        if (actionState === "idle") { setActionState("deny_confirm"); return; }
        if (actionState === "deny_confirm") { handleDenyConfirm(); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cursor, kase, decisions, actionState, handleAction, handleDenyConfirm, handleNavigate]);

  const decided = !!decisions[kase.caseId];
  const decidedCount = Object.keys(decisions).length;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      background: NAVY_DARK, fontFamily: FONTS.body,
    }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 52, background: NAVY,
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center",
        padding: "0 20px", gap: 20, flexShrink: 0,
        boxShadow: "0 1px 8px rgba(0,0,0,0.3)",
      }}>
        {/* Logo + nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading, letterSpacing: "-0.02em" }}>CogentCR</span>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)" }} />
          <button onClick={onBack} style={{
            background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 5, padding: "3px 10px", color: "rgba(255,255,255,0.75)",
            fontSize: 11, cursor: "pointer", fontFamily: FONTS.body, fontWeight: 600,
          }}>UR Form</button>
          <div style={{
            background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 5, padding: "3px 10px", color: "#fff",
            fontSize: 11, fontFamily: FONTS.body, fontWeight: 700,
          }}>Cockpit</div>
        </div>

        {/* Case ID */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: FONTS.body }}>
            {cursor + 1} / {QUEUE.length}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading }}>
            {kase.caseId}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: FONTS.body }}>
            {kase.memberName}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: FONTS.body }}>
            submitted {fmtTime(kase.submittedAt)}
          </span>
        </div>

        {/* Keyboard hints */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
          {decidedCount > 0 && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: FONTS.body }}>
              {decidedCount}/{QUEUE.length} decided
            </span>
          )}
          <KbdChip k="J" label="prev" />
          <KbdChip k="K" label="next" />
          <KbdChip k="V" label="docs" />
          {!decided && (
            <>
              <KbdChip k="A" label="approve" />
              <KbdChip k="P" label="partial" />
              <KbdChip k="D" label="deny" />
              <KbdChip k="N" label="pend" />
            </>
          )}
          {user && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: FONTS.body, borderLeft: "1px solid rgba(255,255,255,0.15)", paddingLeft: 14 }}>
              {user.name || user.email}
            </span>
          )}
        </div>
      </div>

      {/* ── Three-zone body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", gap: 1 }}>

        {/* Clinical Evidence */}
        <div style={{
          flex: "0 0 34%", background: "#fff",
          borderRight: "1px solid #e2e8f0", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
          <EvidenceZone kase={kase} />
        </div>

        {/* Recommendation */}
        <div style={{
          flex: "0 0 36%", background: "#fff",
          borderRight: "1px solid #e2e8f0", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
          <RecommendationZone kase={kase} />
        </div>

        {/* Determination + Queue */}
        <div style={{
          flex: 1, background: "#fff",
          overflow: "hidden", display: "flex", flexDirection: "column",
        }}>
          <DeterminationZone
            kase={kase}
            cursor={cursor}
            total={QUEUE.length}
            decisions={decisions}
            actionState={actionState}
            partialVisits={partialVisits}
            onAction={handleAction}
            onPartialVisitsChange={setPartialVisits}
            onPartialSubmit={handlePartialSubmit}
            onDenyConfirm={handleDenyConfirm}
            onCancelAction={() => setActionState("idle")}
            onNavigate={handleNavigate}
            onToggleDocs={() => setShowDocs(s => !s)}
            showDocs={showDocs}
          />
        </div>
      </div>

      {/* Documents side panel */}
      {showDocs && <DocumentsPanel kase={kase} onClose={() => setShowDocs(false)} />}
    </div>
  );
}
