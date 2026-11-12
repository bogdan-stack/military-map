import mgrs from "mgrs";
import { findAmbiguousTimes, findDtgs, formatInstant, zoneByLetter, type ParsedDtg } from "./dtg";
import { analyseOrder, annexLetterFromName, type OrderBlock } from "./structure";

export const LOW_CONFIDENCE = 80;

export type OcrWord = { text: string; confidence: number };

export type SourceFile = {
  name: string;
  text: string;
  pageCount: number | null;
  ocrPages: number;
  words?: OcrWord[];
};

export type TimeHit = {
  id: string;
  raw: string;
  phrase: string;
  anchor: string;
  context: string;
  qualifierLabel: string | null;
  localLabel: string;
  utcMs: number | null;
  zone: string | null;
  offsetHours: number | null;
  uncertain: boolean;
};

export type CitedReference = {
  letter: string;
  title: string;
  anchor: string;
};

export type ReadingReport = {
  blocks: OrderBlock[];
  paragraphCount: number;
  annexes: string[];
  findings: string[];
  referenceCount: number;
  counts: { times: number; places: number; units: number };
  timezone: { letter: string; offsetHours: number; name: string; consistent: boolean } | null;
  times: TimeHit[];
  uncertainTimes: TimeHit[];
  citedReferences: CitedReference[];
  missingReferences: CitedReference[];
  identity: { operationName: string; ownUnit: string; opordLabel: string; fromUnit: string };
};

const UNIT_SOURCE = "\\b\\d+\\s+(?:(?:MN|MR|US|UK|HN)\\s+)?(?:BDE|DIV|CORPS|BN|COY|SQN|BTY|REGT|BG|MEF|MRB)\\b";
const CONTROL_SOURCE = "\\b(?:OBJ|PL|LD|TAA|AO|NAI|TAI)\\s+[A-Z][A-Z0-9-]{1,24}\\b";
const GRID_SOURCE = "\\b\\d{1,2}\\s*[A-Z]\\s*[A-Z]{2}\\s*\\d{2,5}\\s*\\d{2,5}\\b";
const REFERENCE_PHRASE = /reference\s+([a-z])(?:\s*,\s*"([^"]+)"|\s*,\s*([^,.\n]+))?/gi;

export function parseGrid(raw: string): [number, number] | null {
  try {
    const point = mgrs.toPoint(raw.replace(/\s+/g, "").toUpperCase());
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    return [point[0], point[1]];
  } catch {
    return null;
  }
}

export function citedReferences(blocks: OrderBlock[], text: string): CitedReference[] {
  const byLetter = new Map<string, CitedReference>();
  for (const block of blocks) {
    const match = block.anchor.match(/(?:^|\/)ref\.([a-z])$/i);
    if (!match) continue;
    byLetter.set(match[1].toUpperCase(), { letter: match[1].toUpperCase(), title: block.heading.trim(), anchor: block.anchor });
  }
  for (const match of text.matchAll(REFERENCE_PHRASE)) {
    const letter = match[1].toUpperCase();
    if (byLetter.has(letter)) continue;
    const title = (match[2] || match[3] || "").trim();
    byLetter.set(letter, { letter, title, anchor: "" });
  }
  return [...byLetter.values()];
}

export function fileCoversReference(fileName: string, reference: CitedReference) {
  if (annexLetterFromName(fileName) === reference.letter) return true;
  const hay = fileName.toLowerCase().replace(/[_\-.]+/g, " ");
  const words = reference.title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  if (!words.length) return false;
  const hits = words.filter((word) => hay.includes(word)).length;
  return hits >= Math.min(2, words.length);
}

export function missingReferences(cited: CitedReference[], fileNames: string[]) {
  return cited.filter((reference) => !fileNames.some((name) => fileCoversReference(name, reference)));
}

function anchorForIndex(fileText: string, index: number, blocks: OrderBlock[]) {
  const line = contextLine(fileText, index).toLowerCase();
  const byHeading = blocks.find((block) => block.heading && line.includes(block.heading.toLowerCase().slice(0, 24)));
  if (byHeading) return byHeading.anchor;
  const byText = blocks.find((block) => block.text && line && block.text.toLowerCase().includes(line.slice(0, 40)));
  return byText?.anchor ?? "";
}

function contextLine(fileText: string, index: number) {
  const start = fileText.lastIndexOf("\n", index - 1) + 1;
  const end = fileText.indexOf("\n", index);
  return fileText.slice(start, end === -1 ? undefined : end).trim();
}

function lowConfidence(raw: string, words: OcrWord[] | undefined) {
  if (!words?.length) return false;
  const digits = raw.replace(/\D/g, "").slice(0, 6);
  return words.some((word) => word.confidence < LOW_CONFIDENCE && (raw.toLowerCase().includes(word.text.toLowerCase()) || word.text.includes(digits)));
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\s+/g, " ").trim();
}

export function guessIdentity(text: string, fileNames: string[]) {
  const opord = text.match(/\bOPORD\s+\d{2}-\d{2}\b/i) ?? fileNames.join(" ").match(/\bOPORD\s+\d{2}-\d{2}\b/i);
  const operation = text.match(/\b(?:OPERATION|OP)[ \t]+([A-Z][A-Z]+(?:[ \t]+[A-Z][A-Z]+){0,3})/);
  const from = text.match(/\b\d+\s+MN\s+DIV\b/i);
  const mission = text.split(/\n/).find((line) => /^\s*2\.\s+mission\b/i.test(line));
  const missionBody = mission ? text.slice(text.indexOf(mission)) : text;
  const missionEnd = missionBody.search(/\n\s*3\.\s+/);
  const missionText = missionEnd > 0 ? missionBody.slice(0, missionEnd) : missionBody.slice(0, 500);
  const own = missionText.match(new RegExp(UNIT_SOURCE, "i"));
  return {
    operationName: operation ? titleCase(operation[1]) : "",
    ownUnit: own ? own[0].replace(/\s+/g, " ").toUpperCase() : "",
    opordLabel: opord ? opord[0].toUpperCase() : "",
    fromUnit: from ? from[0].replace(/\s+/g, " ").toUpperCase() : "",
  };
}

function timeHitsFor(fileText: string, blocks: OrderBlock[], words: OcrWord[] | undefined, idPrefix: string): TimeHit[] {
  const parsed = findDtgs(fileText);
  const ambiguous = findAmbiguousTimes(fileText, parsed);
  const hits: TimeHit[] = [];
  parsed.forEach((item, index) => hits.push(hitFromParsed(item, fileText, blocks, words, `${idPrefix}-d${index}`)));
  ambiguous.forEach((item, index) => {
    const anchor = anchorForIndex(fileText, item.index, blocks);
    const line = contextLine(fileText, item.index);
    hits.push({
      id: `${idPrefix}-a${index}`,
      raw: item.raw,
      phrase: item.qualifierLabel ? `${item.qualifierLabel} ${item.raw}` : item.raw,
      anchor,
      context: line,
      qualifierLabel: item.qualifierLabel,
      localLabel: "",
      utcMs: null,
      zone: null,
      offsetHours: null,
      uncertain: true,
    });
  });
  return hits;
}

function hitFromParsed(item: ParsedDtg, fileText: string, blocks: OrderBlock[], words: OcrWord[] | undefined, id: string): TimeHit {
  const anchor = anchorForIndex(fileText, item.index, blocks);
  const uncertain = lowConfidence(item.raw, words);
  return {
    id,
    raw: item.raw,
    phrase: item.qualifierLabel ? `${item.qualifierLabel} ${item.raw}` : item.raw,
    anchor,
    context: contextLine(fileText, item.index),
    qualifierLabel: item.qualifierLabel,
    localLabel: formatInstant(item.utcMs, item.offsetHours),
    utcMs: item.utcMs,
    zone: item.zone,
    offsetHours: item.offsetHours,
    uncertain,
  };
}

export function buildReading(files: SourceFile[]): ReadingReport {
  const blocks: OrderBlock[] = [];
  const annexes = new Set<string>();
  const findings: string[] = [];
  let paragraphCount = 0;
  const times: TimeHit[] = [];
  let places = 0;
  let units = 0;
  const texts: string[] = [];

  files.forEach((file, fileIndex) => {
    const letter = annexLetterFromName(file.name);
    const structure = analyseOrder(file.text, letter);
    blocks.push(...structure.blocks);
    structure.annexes.forEach((annex) => annexes.add(annex));
    if (!letter) {
      paragraphCount = Math.max(paragraphCount, structure.paragraphCount);
      findings.push(...structure.findings);
    }
    times.push(...timeHitsFor(file.text, structure.blocks, file.words, `f${fileIndex}`));
    for (const match of file.text.matchAll(new RegExp(GRID_SOURCE, "g"))) if (parseGrid(match[0])) places += 1;
    places += [...file.text.matchAll(new RegExp(CONTROL_SOURCE, "g"))].length;
    units += [...file.text.matchAll(new RegExp(UNIT_SOURCE, "gi"))].length;
    texts.push(file.text);
  });

  const zones = times.map((time) => time.zone).filter((zone): zone is string => Boolean(zone));
  const uniqueZones = [...new Set(zones)];
  const letter = uniqueZones.length === 1 ? uniqueZones[0] : zones[0] ?? null;
  const zone = letter ? zoneByLetter(letter) : null;
  const cited = citedReferences(blocks, texts.join("\n"));
  const identity = guessIdentity(texts.join("\n"), files.map((file) => file.name));

  return {
    blocks,
    paragraphCount,
    annexes: [...annexes],
    findings,
    referenceCount: cited.length,
    counts: { times: times.length, places, units },
    timezone: zone ? { letter: zone.letter, offsetHours: zone.offsetHours, name: zone.name, consistent: uniqueZones.length === 1 } : null,
    times,
    uncertainTimes: times.filter((time) => time.uncertain),
    citedReferences: cited,
    missingReferences: missingReferences(cited, files.map((file) => file.name)),
    identity,
  };
}
