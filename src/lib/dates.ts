export const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
export const dayNamesLong = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];

// ritorna 0..6 (Mon..Sun)
export function todayIndex(): number {
  const d = new Date();
  const js = d.getDay(); // 0 Sun .. 6 Sat
  return (js + 6) % 7;   // Mon=0 ... Sun=6
}

export function formatISODate(d: Date): string {
  return d.toISOString().slice(0,10);
}
