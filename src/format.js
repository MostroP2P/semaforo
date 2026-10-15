// Numbers and times as the page shows them. The units (s, min, h, d, UTC,
// %) read the same in Spanish and English, so these need no catalogue.

/** "40 s", "7 min", "21 h 12 min", "3 d 4 h": the two largest units. */
export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** Unix seconds as "2026-10-14 16:26 UTC". */
export function utcTime(unix) {
  const iso = new Date(unix * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** A fraction such as a fee, 0.006, as "0.6 %". */
export function percent(fraction) {
  return `${Number((fraction * 100).toFixed(3))} %`;
}
