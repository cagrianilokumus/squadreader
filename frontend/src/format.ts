/* Dates and counts in the VIEWER's conventions, not the author's.
 *
 * Every formatter here is built with `undefined` as the locale, which is the one
 * value Intl reads as "whatever this browser is set to". Three call sites used
 * to name a locale instead — Home and PlayerStats said "tr-TR", TopBar said
 * "en-GB" — so every reader got Turkish month names and a British field order
 * no matter where they were (issue #6). A named locale formats for somebody who
 * is not the person looking at the screen.
 *
 * The timezone was never the problem, despite how the symptom reads. Intl
 * renders in the runtime's own zone unless told otherwise, and the API's
 * timestamps are tz-aware ISO strings (`recorder.py` writes them from
 * `datetime.now(timezone.utc)`, and falls back to `.replace(tzinfo=utc)`), so
 * the clock was always the reader's. Only the language was ours.
 *
 * `formatMetres` in canvas/ruler.ts is deliberately NOT routed through here. A
 * map ruler groups thousands with a space on purpose — a comma or a dot there
 * reads as a decimal point to half the audience — so that one is pinned by
 * design rather than by accident. It is the exception, and the only one.
 *
 * The formatters are constructed once, at module load. `Intl.DateTimeFormat` is
 * expensive enough to matter when it would otherwise be rebuilt per row, and
 * every caller here renders lists.
 */

/** Day, month and time of day — a recording's "when". */
export const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

/** Day and month alone — the "what am I watching" line. */
export const dayMonthFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric", month: "short",
});

/** A whole number, grouped the way the viewer groups numbers. */
export const integerFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

/** An em-dash, not a guess: a timestamp we do not have is not "now". */
export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : dateTimeFormat.format(d);
}

/** `null` rather than a dash: callers hide the line instead of printing one. */
export function fmtDayMonth(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : dayMonthFormat.format(d);
}

/** Rounded before formatting, so a half lands where Math.round puts it. */
export function fmtInt(n: number | null | undefined): string {
  return n == null ? "—" : integerFormat.format(Math.round(n));
}
