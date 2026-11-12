import { extractUpload } from "@/lib/order/extract";
import { buildReading, type ReadingReport, type TimeHit } from "@/lib/order/reading";

export type UploadFile = {
  name: string;
  sha256: string;
  kind: "pdf" | "docx" | "png" | "jpeg" | "other";
  status: "read" | "failed" | "unsupported";
  detail: string;
  pages: number | null;
};

export type UploadReport = {
  files: UploadFile[];
  pagesRead: number;
  ocrPages: number;
  paragraphCount: number;
  annexCount: number;
  referenceCount: number;
  findings: string[];
  counts: ReadingReport["counts"];
  timezone: ReadingReport["timezone"];
  times: TimeHit[];
  uncertainTimes: TimeHit[];
  missingReferences: ReadingReport["missingReferences"];
  identity: ReadingReport["identity"];
};

const MAX_BYTES = 20 * 1024 * 1024;

export async function readOrderFiles(files: { name: string; bytes: Buffer }[]): Promise<UploadReport> {
  const extracted = [];
  for (const file of files) {
    if (file.bytes.length > MAX_BYTES) {
      extracted.push({
        name: file.name,
        sha256: "",
        kind: "other" as const,
        status: "failed" as const,
        detail: "This file is over 20 MB.",
        pages: null,
        ocrPages: 0,
        text: "",
        words: [],
      });
      continue;
    }
    extracted.push(await extractUpload(file.name, file.bytes));
  }
  const readable = extracted.filter((file) => file.status === "read");
  const reading = buildReading(readable.map((file) => ({
    name: file.name,
    text: file.text,
    pageCount: file.pages,
    ocrPages: file.ocrPages,
    words: file.words,
  })));
  return {
    files: extracted.map(({ name, sha256, kind, status, detail, pages }) => ({ name, sha256, kind, status, detail, pages })),
    pagesRead: extracted.reduce((sum, file) => sum + (file.pages ?? 0), 0),
    ocrPages: extracted.reduce((sum, file) => sum + file.ocrPages, 0),
    paragraphCount: reading.paragraphCount,
    annexCount: reading.annexes.length,
    referenceCount: reading.referenceCount,
    findings: reading.findings,
    counts: reading.counts,
    timezone: reading.timezone,
    times: reading.times,
    uncertainTimes: reading.uncertainTimes,
    missingReferences: reading.missingReferences,
    identity: reading.identity,
  };
}
