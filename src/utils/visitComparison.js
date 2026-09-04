// ISSUE 3 — shared helpers for the "requested vs. recommended" visit comparison,
// used by both the main Cockpit recommendation panel and the demo UR form output.

/**
 * Parse a requested frequency/duration out of free text (a raw POC or
 * requestedFrequency string like "3x/week for 8 weeks", or a pre-formatted
 * "2x/week × 6 weeks" display string). Mirrors the regex used server-side in
 * rapidnote-backend/utils/contract.js's parseFreqWeeks — kept independent here
 * since the two consumers of this file (Cockpit.js live/fallback contracts and
 * the demo UR form) never go through that backend function.
 *
 * Returns { freqPerWeek, durationWeeks }, either or both null when not found.
 */
export function parseRequestedFreqWeeks(text) {
  const str = (text || "").toString();
  if (!str) return { freqPerWeek: null, durationWeeks: null };

  const freqMatches = [...str.matchAll(/(\d+)\s*x?\s*\/\s*(?:week|wk)\b/gi)];
  const freqPerWeek = freqMatches.length > 0
    ? Math.max(...freqMatches.map((m) => parseInt(m[1], 10)))
    : null;

  const weekMatches = str.match(/(\d+)\s*(?:week|wk)s?\b/gi) || [];
  const durationWeeks = weekMatches.length > 0
    ? parseInt(weekMatches[weekMatches.length - 1].match(/\d+/)[0], 10)
    : null;

  return { freqPerWeek, durationWeeks };
}

/**
 * Format a "N visits · Fx/wk × W wks" line. Falls back to the visit count alone
 * (never a blank or "undefined") when frequency or duration isn't available.
 */
export function formatVisitLine(visits, freqPerWeek, durationWeeks) {
  const visitsLabel = (visits != null ? visits : 0) + (visits === 1 ? " visit" : " visits");
  if (freqPerWeek == null || durationWeeks == null) return visitsLabel;
  return visitsLabel + " · " + freqPerWeek + "x/wk × " + durationWeeks + " wks";
}
