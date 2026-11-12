export type DtgQualifier = "NLT" | "NET" | "AT";

export type ParsedDtg = {
  raw: string;
  index: number;
  day: number;
  hour: number;
  minute: number;
  zone: string;
  offsetHours: number;
  month: number;
  year: number;
  qualifier: DtgQualifier | null;
  qualifierLabel: string | null;
  utcMs: number;
};

export type AmbiguousTime = {
  raw: string;
  index: number;
  qualifier: DtgQualifier | null;
  qualifierLabel: string | null;
};

export type TimeZone = { letter: string; name: string; offsetHours: number };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** NATO zone letters. J is not a zone. */
export const TIME_ZONES: TimeZone[] = [
  ["A", "ALPHA", 1],
  ["B", "BRAVO", 2],
  ["C", "CHARLIE", 3],
  ["D", "DELTA", 4],
  ["E", "ECHO", 5],
  ["F", "FOXTROT", 6],
  ["G", "GOLF", 7],
  ["H", "HOTEL", 8],
  ["I", "INDIA", 9],
  ["K", "KILO", 10],
  ["L", "LIMA", 11],
  ["M", "MIKE", 12],
  ["N", "NOVEMBER", -1],
  ["O", "OSCAR", -2],
  ["P", "PAPA", -3],
  ["Q", "QUEBEC", -4],
  ["R", "ROMEO", -5],
  ["S", "SIERRA", -6],
  ["T", "TANGO", -7],
  ["U", "UNIFORM", -8],
  ["V", "VICTOR", -9],
  ["W", "WHISKEY", -10],
  ["X", "X-RAY", -11],
  ["Y", "YANKEE", -12],
  ["Z", "ZULU", 0],
].map(([letter, name, offsetHours]) => ({ letter: letter as string, name: name as string, offsetHours: offsetHours as number }));

const ZONE_OFFSET = new Map(TIME_ZONES.map((zone) => [zone.letter, zone.offsetHours]));

const DTG = new RegExp(`\\b(\\d{2})(\\d{2})(\\d{2})([A-IK-Z])\\s+(${MONTHS.join("|")})\\s+(\\d{2}|\\d{4})\\b`, "gi");
const PARTIAL = /\b(\d{6}[A-IK-Z])\b/gi;

export function zoneByLetter(letter: string): TimeZone | null {
  return TIME_ZONES.find((zone) => zone.letter === letter.toUpperCase()) ?? null;
}

export function formatWallClock(year: number, month: number, day: number, hour: number, minute: number) {
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  return `${weekday} ${day} ${mon}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatInstant(utcMs: number, offsetHours: number) {
  const shifted = new Date(utcMs + offsetHours * 3_600_000);
  return formatWallClock(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), shifted.getUTCHours(), shifted.getUTCMinutes());
}

export function formatOffset(offsetHours: number) {
  if (offsetHours === 0) return "UTC+0";
  return offsetHours > 0 ? `UTC+${offsetHours}` : `UTC${offsetHours}`;
}

function expandYear(year: number) {
  if (year >= 1000) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

function qualifierBefore(text: string, index: number): { qualifier: DtgQualifier; label: string } | null {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const before = text.slice(lineStart, index).toLowerCase();
  if (/not\s+earlier\s+than\s*$/.test(before) || /\bnet\s*$/.test(before)) return { qualifier: "NET", label: "not earlier than" };
  if (/not\s+later\s+than\s*$/.test(before) || /no\s+later\s+than\s*$/.test(before) || /\bnlt\s*$/.test(before)) return { qualifier: "NLT", label: "not later than" };
  if (/\bat\s*$/.test(before)) return { qualifier: "AT", label: "at" };
  return null;
}

export function parseDtgAt(text: string, match: RegExpExecArray): ParsedDtg | null {
  const day = Number(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const zone = match[4].toUpperCase();
  const month = MONTHS.indexOf(match[5].toUpperCase()) + 1;
  const year = expandYear(Number(match[6]));
  const offsetHours = ZONE_OFFSET.get(zone);
  if (offsetHours === undefined || hour > 23 || minute > 59 || month < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const qualifier = qualifierBefore(text, match.index);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - offsetHours * 3_600_000;
  return {
    raw: match[0],
    index: match.index,
    day,
    hour,
    minute,
    zone,
    offsetHours,
    month,
    year,
    qualifier: qualifier?.qualifier ?? null,
    qualifierLabel: qualifier?.label ?? null,
    utcMs,
  };
}

export function findDtgs(text: string): ParsedDtg[] {
  const found: ParsedDtg[] = [];
  for (const match of text.matchAll(DTG)) {
    const parsed = parseDtgAt(text, match);
    if (parsed) found.push(parsed);
  }
  return found;
}

/** A zone-and-time token with no month, so it is not one instant. */
export function findAmbiguousTimes(text: string, parsed: ParsedDtg[]): AmbiguousTime[] {
  const claimed = new Set(parsed.map((item) => item.index));
  const found: AmbiguousTime[] = [];
  for (const match of text.matchAll(PARTIAL)) {
    if (claimed.has(match.index)) continue;
    const covered = parsed.some((item) => match.index >= item.index && match.index < item.index + item.raw.length);
    if (covered) continue;
    const qualifier = qualifierBefore(text, match.index);
    found.push({
      raw: match[1],
      index: match.index,
      qualifier: qualifier?.qualifier ?? null,
      qualifierLabel: qualifier?.label ?? null,
    });
  }
  return found;
}
