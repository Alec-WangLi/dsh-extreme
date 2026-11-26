/**
 * matchCount — the counting twin of lib/core/shared.mjs matchesPattern.
 *
 * Semantics are imported, not reimplemented: string patterns normalize both
 * sides with asLf (CRLF tolerance); RegExp patterns run through cloneRegExp
 * with the global flag added so matchAll never mutates the shared pattern
 * object's lastIndex. Non-overlapping counting mirrors replaceAll semantics
 * for string needles (indexOf stepped by needle length).
 *
 * Consumers: scripts/drift-audit.mjs (per-anchor occurrence evidence).
 */
import { asLf, cloneRegExp } from "./core/shared.mjs";

export function matchCount(content, pattern) {
  if (pattern instanceof RegExp) {
    return Array.from(asLf(content).matchAll(cloneRegExp(pattern, true))).length;
  }
  const hay = asLf(content);
  const needle = asLf(pattern);
  if (!needle) return 0;
  let count = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = hay.indexOf(needle, at + needle.length);
  }
  return count;
}
