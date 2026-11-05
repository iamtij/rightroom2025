const MANILA = "Asia/Manila";

export function manilaParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: MANILA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatLongDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatMoney(cents, currency) {
  const amount = cents / 100;
  if (currency === "USD") {
    return `USD ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

export function daysLabel(daysBefore) {
  if (daysBefore === 0) return "due today";
  if (daysBefore === 1) return "due tomorrow";
  return `due in ${daysBefore} days`;
}
