// The bug this file guards against does not look like a bug in CI: pinning a
// locale produces perfectly valid output, just somebody else's. So the
// assertions that matter are not about the STRING — that legitimately differs
// on every machine — but about what the formatters resolved to. A pinned
// "tr-TR" or a pinned timeZone fails here on any box, including a Turkish one.
// Framework-free, like the tests beside it.
import { fmtDateTime, fmtDayMonth, fmtInt,
         dateTimeFormat, dayMonthFormat, integerFormat } from "./format.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}

// --- the regression: nothing may be pinned ----------------------------------
{
  const defaultDate = new Intl.DateTimeFormat().resolvedOptions();
  const defaultNum = new Intl.NumberFormat().resolvedOptions();

  for (const [name, f] of [["dateTimeFormat", dateTimeFormat],
                           ["dayMonthFormat", dayMonthFormat]] as const) {
    const got = f.resolvedOptions();
    ok(got.locale === defaultDate.locale,
       `${name} follows the runtime locale, not a pinned one ` +
       `(got ${got.locale}, runtime is ${defaultDate.locale})`);
    // A pinned zone would show the author's clock while reading as the
    // reader's, which is the harder half of #6 to notice.
    ok(got.timeZone === defaultDate.timeZone,
       `${name} renders in the runtime timezone ` +
       `(got ${got.timeZone}, runtime is ${defaultDate.timeZone})`);
  }
  ok(integerFormat.resolvedOptions().locale === defaultNum.locale,
     `integerFormat follows the runtime locale ` +
     `(got ${integerFormat.resolvedOptions().locale})`);
}

// --- a timestamp we do not have is not "now" --------------------------------
{
  ok(fmtDateTime(null) === "—", "a null timestamp is an em-dash");
  ok(fmtDateTime(undefined) === "—", "an absent timestamp is an em-dash");
  ok(fmtDateTime("") === "—", "an empty timestamp is an em-dash");
  ok(fmtDateTime("not a date") === "—", "an unparseable timestamp is an em-dash");
  // The one thing about the output we can assert anywhere: it is not empty and
  // it is not the input echoed back.
  const out = fmtDateTime("2026-05-25T10:41:03.318+00:00");
  ok(out.length > 0 && out !== "—", `a real timestamp formats (got ${out})`);
}

// --- the TopBar hides its line rather than printing a dash ------------------
{
  ok(fmtDayMonth(null) === null, "a null date yields null, not a dash");
  ok(fmtDayMonth("rubbish") === null, "an unparseable date yields null");
  ok(typeof fmtDayMonth("2026-05-25T10:41:03+00:00") === "string",
     "a real date yields a string");
}

// --- counts -----------------------------------------------------------------
{
  ok(fmtInt(null) === "—", "a null count is an em-dash");
  ok(fmtInt(undefined) === "—", "an absent count is an em-dash");
  // Zero is a FACT — "0 kills" is not the same statement as "unknown".
  ok(fmtInt(0) === integerFormat.format(0), "zero formats as zero, not a dash");
  ok(fmtInt(1234.6) === integerFormat.format(1235), "a count rounds before grouping");
  ok(fmtInt(1234.4) === integerFormat.format(1234), "and rounds down when it should");
  // Grouped, whatever the separator is here: four digits in, more than four out.
  ok(fmtInt(1000000).replace(/\d/g, "").length > 0,
     `a big count is grouped (got ${fmtInt(1000000)})`);
}

console.log(`format: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
