// Protection periods, and how long is left.
//
// The wire format is hours: the frontend sends ?hours=N and the backend computes
// now + N * time.Hour. That is not changing -- protections already granted keep
// working, and no backend deploy is coupled to this.
//
// What changed is that nobody protects a file for a number of hours. A survivor
// keeping evidence is thinking in months and years, and "87600" is not a number a
// person should have to reach for, or check. Offering a short list of real periods
// removes the arithmetic and, more importantly, removes the mis-typed zero.
//
// 730 hours to the month and 8760 to the year. They agree exactly at twelve months,
// so the two units cannot drift apart.
export const HOURS_PER_MONTH = 730;
export const HOURS_PER_YEAR = 8760;

// Ordered shortest to longest. `key` names an i18n string; `hours` is what is sent.
export const PROTECT_PERIODS = [
  { key: "threeMonths", hours: 3 * HOURS_PER_MONTH },
  { key: "sixMonths", hours: 6 * HOURS_PER_MONTH },
  { key: "oneYear", hours: HOURS_PER_YEAR },
  { key: "twoYears", hours: 2 * HOURS_PER_YEAR },
  { key: "fiveYears", hours: 5 * HOURS_PER_YEAR },
  { key: "tenYears", hours: 10 * HOURS_PER_YEAR },
];

// One year. Long enough to be useful without anyone having to choose, and it is the
// value someone gets if they click straight through the dialog.
export const DEFAULT_PROTECT_HOURS = HOURS_PER_YEAR;

const MS_PER_MINUTE = 60000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// How much protection is left, in the largest unit that still tells the truth.
//
// The previous version always answered in days and hours, so a five-year protection
// read "1826d 0h remaining". Accurate, and no help at all to someone checking whether
// their evidence is still safe. Days are the right unit for the last stretch, when it
// starts to matter exactly; years are the right unit for the rest.
export function formatProtectionRemaining(msLeft, expiredLabel = "Expired") {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return expiredLabel;

  const totalMinutes = Math.floor(msLeft / MS_PER_MINUTE);
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  if (days >= 365) {
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    return months > 0
      ? `${plural(years, "year")} ${plural(months, "month")} remaining`
      : `${plural(years, "year")} remaining`;
  }
  if (days >= 60) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    return remainingDays > 0
      ? `${plural(months, "month")} ${plural(remainingDays, "day")} remaining`
      : `${plural(months, "month")} remaining`;
  }
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}
