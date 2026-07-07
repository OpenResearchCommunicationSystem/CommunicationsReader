// Strips leading reply/forward markers (Re:, Fwd:, Fw:, and stacked
// combinations like "Re: Fwd: Re:"), case-insensitively, then collapses
// whitespace. Used to group communications by "the same underlying
// conversation" when header-based threading has nothing to link. Real
// Iranian mail exports observed so far keep the English "Re:"/"Fwd:"
// markers verbatim even on Farsi-subject messages (mail clients don't
// localize them), so no Farsi-specific prefix variants are handled here
// -- add them if real data ever shows a localized equivalent.
const PREFIX_RE = /^(re|fwd?)\s*:\s*/i;

export function normalizeSubject(subject) {
  if (!subject) return '';
  let s = subject.trim();
  // Repeatedly strip stacked prefixes (e.g. "Re: Fwd: Re: hello").
  while (PREFIX_RE.test(s)) {
    s = s.replace(PREFIX_RE, '').trim();
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
