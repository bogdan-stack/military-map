import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import mammoth from "mammoth";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OcrWord } from "./reading";

const SCAN_THRESHOLD = 24;

export type FileKind = "pdf" | "docx" | "png" | "jpeg" | "other";

export type ExtractedFile = {
  name: string;
  sha256: string;
  kind: FileKind;
  status: "read" | "failed" | "unsupported";
  detail: string;
  pages: number | null;
  ocrPages: number;
  text: string;
  words: OcrWord[];
};

type OcrResult = { text: string; words: OcrWord[] };

let workerPromise: Promise<import("tesseract.js").Worker> | null = null;

async function recognize(image: Buffer): Promise<OcrResult> {
  if (!workerPromise) {
    const { createWorker } = await import("tesseract.js");
    workerPromise = createWorker("eng");
  }
  const worker = await workerPromise;
  const result = await worker.recognize(image, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  for (const block of result.data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word.text.trim()) words.push({ text: word.text, confidence: word.confidence });
        }
      }
    }
  }
  if (!words.length && result.data.text.trim()) {
    for (const text of result.data.text.split(/\s+/)) {
      if (text.trim()) words.push({ text, confidence: result.data.confidence });
    }
  }
  return { text: result.data.text || "", words };
}

export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpeg";
  return "other";
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function unsupportedDetail(name: string) {
  if (name.toLowerCase().endsWith(".doc")) return "Legacy Word .doc is not read yet. Save it as .docx.";
  return "This format is not read yet. Use PDF, Word (.docx), PNG, or JPEG.";
}

export async function extractUpload(name: string, bytes: Buffer): Promise<ExtractedFile> {
  const kind = fileKind(name);
  const sha256 = hash(bytes);
  const base = { name, sha256, kind, pages: null as number | null, ocrPages: 0, text: "", words: [] as OcrWord[] };
  if (kind === "other") return { ...base, status: "unsupported", detail: unsupportedDetail(name) };
  try {
    if (kind === "docx") {
      const result = await mammoth.extractRawText({ buffer: bytes });
      return { ...base, status: "read", detail: "Word document", text: result.value || "" };
    }
    if (kind === "png" || kind === "jpeg") {
      const ocr = await recognize(bytes);
      return { ...base, status: "read", detail: "Image", pages: 1, ocrPages: 1, text: ocr.text, words: ocr.words };
    }
    const pdf = await readPdf(bytes);
    const scanned = pdf.ocrPages ? ` · ${pdf.ocrPages} scanned` : "";
    return { ...base, status: "read", detail: `${pdf.pages} pages${scanned}`, pages: pdf.pages, ocrPages: pdf.ocrPages, text: pdf.text, words: pdf.words };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file could not be read.";
    return { ...base, status: "failed", detail: message };
  }
}

async function readPdf(bytes: Buffer) {
  const doc = await openPdf(bytes);
  const pages: string[] = [];
  const words: OcrWord[] = [];
  let ocrPages = 0;
  const pageCount = doc.numPages;
  try {
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const digital = itemsToText(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      if (digital.replace(/\s+/g, "").length >= SCAN_THRESHOLD) {
        pages.push(digital);
        continue;
      }
      const image = await renderPage(page);
      const ocr = await recognize(image);
      pages.push(ocr.text);
      words.push(...ocr.words);
      ocrPages += 1;
    }
  } finally {
    const closable = doc as PDFDocumentProxy & { destroy?: () => Promise<void> | void };
    if (typeof closable.destroy === "function") await closable.destroy();
  }
  return { text: pages.join("\n"), pages: pageCount, ocrPages, words };
}

async function openPdf(bytes: Buffer): Promise<PDFDocumentProxy> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  return task.promise;
}

function itemsToText(items: Array<{ str?: string; hasEOL?: boolean }>) {
  let text = "";
  for (const item of items) {
    if (!item.str) continue;
    text += item.str;
    text += item.hasEOL ? "\n" : " ";
  }
  return text;
}

async function renderPage(page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;
  return canvas.toBuffer("image/png");
}
