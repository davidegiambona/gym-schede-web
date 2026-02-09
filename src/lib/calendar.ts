// src/lib/calendar.ts
export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const jsDay = x.getDay(); // 0=Sun..6=Sat
  const monIndex = (jsDay + 6) % 7; // 0=Mon..6=Sun
  x.setDate(x.getDate() - monIndex);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatDDMM(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// ritorna 0..6 (Mon..Sun)
export function weekdayIndexMon0(d: Date): number {
  const js = d.getDay(); // 0 Sun..6 Sat
  return (js + 6) % 7;
}
