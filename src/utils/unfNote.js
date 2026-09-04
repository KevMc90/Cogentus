// Universal Note Format (UNF) — the ONE shared note-builder used by both the
// main cockpit's UNF panel (Cockpit.js) and the demo UR form output (App.js),
// so the two surfaces can never drift apart. Every value is passed in already
// resolved (requestedVisits/approvedVisits already merged to their final
// number, determinationLine already the full "<Label> — <rationale>" prose
// straight off the ruling object) — this module only cleans/standardizes the
// POC text and assembles the six-section template.

/**
 * Strip structured field labels Claude may echo verbatim from a formatted POC
 * table (e.g. "Frequency: 2x/week | Duration: 4 weeks | Visits: 8" -> "2x/week").
 * Ported from rapidnote-backend/index.js's cleanPoc (pre-UNF-panel), which this
 * replaces on both surfaces — kept behaviorally identical.
 */
export function cleanPoc(poc) {
  if (!poc) return null;
  return poc
    .replace(/^Frequency:\s*/i, "")
    .replace(/\bDuration:\s*/i, "")
    .replace(/\s*Visits:\s*\d+\b/i, "")
    .replace(/\s*Treatment:\s*.+/i, "")
    .replace(/\s*[:\-]\s*\d+\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim() || null;
}

/**
 * Format a POC string into standardized "Nx/week × Y weeks" form. Ported from
 * rapidnote-backend/index.js's formatPoc, kept behaviorally identical.
 */
export function formatPoc(raw) {
  if (!raw) return raw;
  const s = String(raw).trim();

  const biw = s.match(/^BIW\s*(?:[xX×]|for|x)?\s*(\d+)\s*weeks?$/i);
  if (biw) return "2x/week × " + biw[1] + " weeks";

  const tiw = s.match(/^TIW\s*(?:[xX×]|for|x)?\s*(\d+)\s*weeks?$/i);
  if (tiw) return "3x/week × " + tiw[1] + " weeks";

  const ehFmt = s.match(/^(\d+)\s*times?\s*(?:per|\/)\s*week[,\s]+(\d+)\s*weeks?/i);
  if (ehFmt) return ehFmt[1] + "x/week × " + ehFmt[2] + " weeks";

  if (/\d+\s*x\s*\/\s*week/i.test(s)) {
    return s
      .replace(/(\d+\s*x\s*\/\s*week)\s+[xX×]\s+/i, "$1 × ")
      .replace(/weeks?/gi, "weeks");
  }

  const compact = s.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (compact) return compact[1] + "x/week × " + compact[2] + " weeks";

  const withWeeks = s.match(/^(\d+)\s*[xX×]\s*(\d+)\s*weeks?$/i);
  if (withWeeks) return withWeeks[1] + "x/week × " + withWeeks[2] + " weeks";

  const wordy = s.match(
    /^(\d+)\s*(?:times?|x)\s*(?:per|\/)\s*week\s+(?:[xX×]|for)\s+(\d+)\s*weeks?$/i
  );
  if (wordy) return wordy[1] + "x/week × " + wordy[2] + " weeks";

  return s;
}

/**
 * Auto-generate the HPI/Care History sentence from structured data, for when
 * no HPI text was entered manually. All inputs are already-resolved values
 * (age as a number, diagnosisDescription as lowercased text, ieDate as
 * MM/DD/YYYY) — computing them from raw extraction/episode data is backend
 * work (age math, the ICD reference table, episode lookups; see
 * rapidnote-backend/utils/hpiData.js and GET /v1/episode-context) attached to
 * the contract/response, never duplicated here. This function only assembles
 * the sentence, so it's identical on the cockpit and the demo form.
 *
 * Format: "[age] year old [sex], [diagnosis], IE [date]." — and, only for a
 * subsequent review with a known total, " Total Approved [N] visits." Any
 * missing piece is dropped gracefully (no "undefined", no dangling comma);
 * returns null (never an empty string) when nothing at all is available, so
 * the caller can fall back to "[No HPI provided]".
 *
 * @param {object} input
 * @param {number|null} input.age
 * @param {string|null} input.sex
 * @param {string|null} input.diagnosisDescription
 * @param {string|null} input.ieDate
 * @param {number|null} input.totalApprovedVisits
 * @param {boolean} input.isSubsequent
 * @returns {string|null}
 */
export function buildAutoHpi({ age, sex, diagnosisDescription, ieDate, totalApprovedVisits, isSubsequent } = {}) {
  const ageSexParts = [];
  if (typeof age === "number" && Number.isFinite(age) && age >= 0) {
    ageSexParts.push(`${age} year old`);
  }
  if (typeof sex === "string" && sex.trim()) {
    ageSexParts.push(sex.trim());
  }

  const clauses = [];
  if (ageSexParts.length > 0) clauses.push(ageSexParts.join(" "));
  if (typeof diagnosisDescription === "string" && diagnosisDescription.trim()) {
    clauses.push(diagnosisDescription.trim());
  }

  let sentence = clauses.join(", ");

  const ieDateClean = typeof ieDate === "string" && ieDate.trim() ? ieDate.trim() : null;
  if (ieDateClean) {
    sentence = sentence ? `${sentence}, IE ${ieDateClean}.` : `IE ${ieDateClean}.`;
  } else if (sentence) {
    sentence = `${sentence}.`;
  }

  if (isSubsequent && typeof totalApprovedVisits === "number" && Number.isFinite(totalApprovedVisits)) {
    const visitsClause = `Total Approved ${totalApprovedVisits} visit${totalApprovedVisits === 1 ? "" : "s"}.`;
    sentence = sentence ? `${sentence} ${visitsClause}` : visitsClause;
  }

  return sentence || null;
}

/**
 * Build the Universal Note Format text block:
 *
 *   HPI/Care History:
 *   ...
 *
 *   Clinical Summary:
 *   ...
 *
 *   POC:
 *   ...
 *
 *   Requested Visits:
 *   ...
 *
 *   Determination and Rationale:
 *   ...
 *
 *   Approved Visits:
 *   ...
 *
 * @param {object} input
 * @param {string|null} input.hpi — manually-entered HPI text; takes precedence
 *   verbatim over autoHpiData whenever non-empty (reviewer/provider always wins)
 * @param {object|null} input.autoHpiData — passed to buildAutoHpi() when `hpi`
 *   is empty/whitespace-only; see that function for shape
 * @param {string|null} input.clinicalSummary
 * @param {string|null} input.poc — raw/verbatim POC text (cleaned/formatted here)
 * @param {number|null} input.requestedVisits
 * @param {string|null} input.determinationLine — full "<Label> — <rationale>" prose
 * @param {number|null} input.approvedVisits
 * @returns {string}
 */
export function buildUNFNote({ hpi, autoHpiData, clinicalSummary, poc, requestedVisits, determinationLine, approvedVisits }) {
  const pocFormatted = formatPoc(cleanPoc(poc));
  const manualHpi = typeof hpi === "string" ? hpi.trim() : "";
  const hpiText = manualHpi || buildAutoHpi(autoHpiData || {}) || "[No HPI provided]";
  return [
    "HPI/Care History:",
    hpiText,
    "",
    "Clinical Summary:",
    clinicalSummary || "[Unable to extract clinical summary from document]",
    "",
    "POC:",
    pocFormatted || "Not specified",
    "",
    "Requested Visits:",
    requestedVisits != null ? String(requestedVisits) : "—",
    "",
    "Determination and Rationale:",
    determinationLine || "—",
    "",
    "Approved Visits:",
    approvedVisits != null ? String(approvedVisits) : "—",
  ].join("\n");
}
