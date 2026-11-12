import { formatInstant } from "./dtg";

/** Receipt-of-mission brief in the worked example is 12:30, 2 h 30 min after 10:00. That leaves 52 h 10 min. */
export const RECEIPT_BRIEF_MS = 150 * 60_000;

export const VERIFIED_ORDER_KEY = "military-order-verified";

const NIGHT_START = 20 * 60;
const DAYLIGHT_START = 7 * 60;
const SUGGESTED_MINUTE = 8 * 60;

export type ClockTime = {
  id: string;
  raw: string;
  phrase: string;
  anchor: string;
  context: string;
  qualifierLabel: string | null;
  utcMs: number | null;
};

export type VerifiedOrder = {
  verifiedAt: string;
  operationName: string;
  ownUnit: string;
  fromUnit: string;
  zoneLetter: string;
  offsetHours: number;
  files: { name: string; sha256: string }[];
  times: ClockTime[];
  deferredReferences: string[];
};

export type StaffPresetId = "arrc" | "atp";

export type BriefId = "missionAnalysis" | "coa" | "decision";

/** ARRC worked split of the time after the receipt brief. ATP midpoints are Table 2-3's refined ranges. */
export const STAFF_PRESETS: Record<StaffPresetId, { label: string; detail: string; weights: [number, number, number, number] }> = {
  arrc: { label: "ARRC handbook", detail: "30 / 30 / 20 / 20", weights: [0.3, 0.3, 0.2, 0.2] },
  atp: { label: "ATP 5-0.2-1", detail: "32.5 / 17.5 / 32.5 / 17.5", weights: [0.325, 0.175, 0.325, 0.175] },
};

const EXECUTION = /h[-\s]?hour|execution start|line of departure|\battacks?\b|\bseize\b/i;
const RECEIPT = /order received|\breceipt of (?:the )?mission|\breceived\b/i;

export function formatDuration(ms: number) {
  const sign = ms < 0 ? "-" : "";
  const total = Math.abs(Math.round(ms / 60_000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${sign}${hours} h ${String(minutes).padStart(2, "0")} min`;
}

export function formatWhen(utcMs: number, offsetHours: number) {
  return formatInstant(utcMs, offsetHours);
}

/** A brief before 07:00 or after 20:00 local. 07:00 and 20:00 themselves are daylight. */
export function daylightSuggestion(utcMs: number, offsetHours: number): number | null {
  const local = new Date(utcMs + offsetHours * 3_600_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (minutes >= DAYLIGHT_START && minutes <= NIGHT_START) return null;
  let morning = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 8, 0);
  if (minutes > NIGHT_START) morning += 24 * 3_600_000;
  return morning - offsetHours * 3_600_000;
}

export function chooseEnds(times: ClockTime[]) {
  const dated = times.filter((time): time is ClockTime & { utcMs: number } => time.utcMs != null);
  const markedExecution = dated.filter((time) => EXECUTION.test(`${time.context} ${time.phrase}`));
  const unqualified = dated.filter((time) => !time.qualifierLabel);
  const hPool = markedExecution.length ? markedExecution : unqualified;
  const hHour = latest(hPool);
  const markedReceipt = dated.filter((time) => RECEIPT.test(`${time.context} ${time.phrase}`));
  const receipt = earliest(markedReceipt.length ? markedReceipt : dated);
  const same = receipt && hHour && receipt.id === hHour.id;
  const chosenReceipt = receipt;
  const chosenH = same ? null : hHour;
  const constraints = times.filter((time) => time.id !== chosenReceipt?.id && time.id !== chosenH?.id);
  return { receipt: chosenReceipt, hHour: chosenH, constraints };
}

export type MissionClock =
  | { ready: false; missingReceipt: boolean; missingHHour: boolean; constraints: ClockTime[] }
  | {
      ready: true;
      receipt: ClockTime;
      hHour: ClockTime;
      constraints: ClockTime[];
      availableMs: number;
      ownMs: number;
      subordinateMs: number;
      opordUtc: number;
      offsetHours: number;
    };

export function missionClock(times: ClockTime[], offsetHours: number): MissionClock {
  const ends = chooseEnds(times);
  if (!ends.receipt?.utcMs || !ends.hHour?.utcMs || ends.hHour.utcMs <= ends.receipt.utcMs) {
    return {
      ready: false,
      missingReceipt: !ends.receipt?.utcMs,
      missingHHour: !ends.hHour?.utcMs || Boolean(ends.receipt?.utcMs && ends.hHour?.utcMs && ends.hHour.utcMs <= ends.receipt.utcMs),
      constraints: ends.constraints,
    };
  }
  const availableMs = ends.hHour.utcMs - ends.receipt.utcMs;
  const ownMs = Math.round(availableMs / 3);
  return {
    ready: true,
    receipt: ends.receipt,
    hHour: ends.hHour,
    constraints: ends.constraints,
    availableMs,
    ownMs,
    subordinateMs: availableMs - ownMs,
    opordUtc: ends.receipt.utcMs + ownMs,
    offsetHours,
  };
}

export type StaffBrief = {
  id: BriefId;
  step: string;
  name: string;
  shareLabel: string;
  rawUtc: number;
  utcMs: number;
  durationMs: number;
  dark: boolean;
  suggestedUtcMs: number | null;
  accepted: boolean;
};

export type StaffClock = {
  preset: StaffPresetId;
  romUtc: number;
  opordUtc: number;
  stepOneMs: number;
  briefs: StaffBrief[];
  ordersMs: number;
};

const BRIEF_META: Record<BriefId, { step: string; name: string }> = {
  missionAnalysis: { step: "Step 2 · Mission analysis", name: "Mission analysis brief" },
  coa: { step: "Step 3 · COA development", name: "COA brief" },
  decision: { step: "Steps 4–6 · Analyse and decide", name: "Decision brief" },
};

export function staffClock(
  receiptUtc: number,
  opordUtc: number,
  offsetHours: number,
  preset: StaffPresetId,
  accepted: Partial<Record<BriefId, boolean>> = {},
): StaffClock | null {
  const romUtc = receiptUtc + RECEIPT_BRIEF_MS;
  const remaining = opordUtc - romUtc;
  if (remaining <= 0) return null;
  const weights = STAFF_PRESETS[preset].weights;
  let cursor = romUtc;
  const raw: Record<BriefId, number> = { missionAnalysis: romUtc, coa: romUtc, decision: romUtc };
  (["missionAnalysis", "coa", "decision"] as const).forEach((id, index) => {
    cursor += Math.round(remaining * weights[index]);
    raw[id] = cursor;
  });
  const briefs: StaffBrief[] = [];
  let previous = romUtc;
  for (const id of ["missionAnalysis", "coa", "decision"] as const) {
    const suggestion = daylightSuggestion(raw[id], offsetHours);
    const useSuggestion = Boolean(accepted[id] && suggestion != null);
    const utcMs = useSuggestion ? suggestion! : raw[id];
    briefs.push({
      id,
      ...BRIEF_META[id],
      shareLabel: percentLabel(weights[["missionAnalysis", "coa", "decision"].indexOf(id)]),
      rawUtc: raw[id],
      utcMs,
      durationMs: utcMs - previous,
      dark: suggestion != null,
      suggestedUtcMs: suggestion,
      accepted: useSuggestion,
    });
    previous = utcMs;
  }
  return {
    preset,
    romUtc,
    opordUtc,
    stepOneMs: RECEIPT_BRIEF_MS,
    briefs,
    ordersMs: opordUtc - previous,
  };
}

export function readVerifiedOrder(raw: string | null): VerifiedOrder | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VerifiedOrder>;
    if (!parsed || !Array.isArray(parsed.times) || typeof parsed.zoneLetter !== "string") return null;
    const times = parsed.times.filter((time) => time && typeof time.raw === "string" && typeof time.utcMs === "number");
    if (!times.length) return null;
    return {
      verifiedAt: String(parsed.verifiedAt ?? ""),
      operationName: String(parsed.operationName ?? ""),
      ownUnit: String(parsed.ownUnit ?? ""),
      fromUnit: String(parsed.fromUnit ?? ""),
      zoneLetter: parsed.zoneLetter,
      offsetHours: Number(parsed.offsetHours ?? 0),
      files: Array.isArray(parsed.files) ? parsed.files : [],
      times,
      deferredReferences: Array.isArray(parsed.deferredReferences) ? parsed.deferredReferences.map(String) : [],
    };
  } catch {
    return null;
  }
}

function percentLabel(weight: number) {
  const value = weight * 100;
  return `${Number.isInteger(value) ? value : value}%`;
}

function latest<T extends { utcMs: number }>(items: T[]): T | null {
  return items.reduce<T | null>((best, item) => (!best || item.utcMs > best.utcMs ? item : best), null);
}

function earliest<T extends { utcMs: number }>(items: T[]): T | null {
  return items.reduce<T | null>((best, item) => (!best || item.utcMs < best.utcMs ? item : best), null);
}
