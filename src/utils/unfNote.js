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
 * @param {string|null} input.hpi
 * @param {string|null} input.clinicalSummary
 * @param {string|null} input.poc — raw/verbatim POC text (cleaned/formatted here)
 * @param {number|null} input.requestedVisits
 * @param {string|null} input.determinationLine — full "<Label> — <rationale>" prose
 * @param {number|null} input.approvedVisits
 * @returns {string}
 */
export function buildUNFNote({ hpi, clinicalSummary, poc, requestedVisits, determinationLine, approvedVisits }) {
  const pocFormatted = formatPoc(cleanPoc(poc));
  return [
    "HPI/Care History:",
    (hpi || "").trim() || "[No HPI provided]",
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
