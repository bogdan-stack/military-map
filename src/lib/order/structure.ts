export type BlockKind =
  | "references"
  | "timezone"
  | "situation"
  | "mission"
  | "execution"
  | "sustainment"
  | "command"
  | "annex"
  | "body";

export type OrderBlock = {
  anchor: string;
  heading: string;
  text: string;
  kind: BlockKind;
};

export type OrderStructure = {
  blocks: OrderBlock[];
  paragraphCount: number;
  found: Record<"situation" | "mission" | "execution" | "sustainment" | "command", boolean>;
  annexes: string[];
  findings: string[];
};

const PARAGRAPH_KINDS = ["situation", "mission", "execution", "sustainment", "command"] as const;

function kindFromHeading(heading: string): BlockKind | null {
  const name = heading.trim().toLowerCase();
  if (/^situation\b/.test(name)) return "situation";
  if (/^mission\b/.test(name)) return "mission";
  if (/^execution\b/.test(name)) return "execution";
  if (/^(service support|sustainment|admin)/.test(name)) return "sustainment";
  if (/^command and signal\b/.test(name)) return "command";
  return null;
}

function lineMarker(line: string): { depth: number; token: string; rest: string } | null {
  const numbered = line.match(/^(\d{1,2})\.\s+(.*)$/);
  if (numbered) return { depth: 0, token: numbered[1], rest: numbered[2] };
  const letter = line.match(/^([a-z])\.\s+(.*)$/i);
  if (letter) return { depth: 1, token: letter[1].toLowerCase(), rest: letter[2] };
  const item = line.match(/^\((\d{1,2})\)\s+(.*)$/);
  if (item) return { depth: 2, token: item[1], rest: item[2] };
  const sub = line.match(/^\(([a-z])\)\s+(.*)$/i);
  if (sub) return { depth: 3, token: sub[1].toLowerCase(), rest: sub[2] };
  return null;
}

function formatStack(stack: Array<string | undefined>) {
  let anchor = "";
  stack.forEach((token, depth) => {
    if (!token) return;
    if (depth === 0) anchor = token;
    else if (depth === 1) anchor += `${anchor ? "." : ""}${token}`;
    else if (depth === 2) anchor += `.(${token})`;
    else anchor += `(${token})`;
  });
  return anchor;
}

/**
 * Split order text on military numbering.
 * `fileAnnex` is the annex letter when the whole file is one annex, so anchors read `ANX-C/2.a`.
 */
export function analyseOrder(text: string, fileAnnex?: string | null): OrderStructure {
  const blocks: OrderBlock[] = [];
  const annexes = new Set<string>();
  let section: BlockKind = "body";
  let annexPrefix = fileAnnex ? `ANX-${fileAnnex.toUpperCase()}` : "";
  if (fileAnnex) annexes.add(fileAnnex.toUpperCase());
  const stack: Array<string | undefined> = [];
  let current: OrderBlock | null = null;

  const open = (anchor: string, heading: string, kind: BlockKind) => {
    const qualified = annexPrefix && !anchor.startsWith("ref.") ? `${annexPrefix}/${anchor}` : anchor;
    const block = { anchor: qualified, heading: heading.trim(), text: "", kind };
    blocks.push(block);
    current = block;
    return block;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const annex = line.match(/^annex\s+([a-z])\b(.*)$/i);
    if (annex && !fileAnnex) {
      const letter = annex[1].toUpperCase();
      annexes.add(letter);
      annexPrefix = `ANX-${letter}`;
      section = "annex";
      stack.length = 0;
      open("", annex[2].replace(/^[-–—:\s]+/, "") || `Annex ${letter}`, "annex");
      continue;
    }
    if (/^references\b/i.test(line)) {
      section = "references";
      if (!fileAnnex) annexPrefix = "";
      stack.length = 0;
      open("references", "References", "references");
      continue;
    }
    if (/^time\s*zone\b/i.test(line)) {
      section = "timezone";
      stack.length = 0;
      open("timezone", line, "timezone");
      continue;
    }
    const marker = lineMarker(line);
    if (!marker) {
      const block = current ?? open("", "", section);
      block.text = `${block.text} ${line}`.trim();
      continue;
    }
    stack.length = marker.depth;
    stack[marker.depth] = marker.token;
    if (marker.depth === 0 && !fileAnnex && section !== "annex") {
      section = kindFromHeading(marker.rest) ?? "body";
    }
    const kind = fileAnnex || section === "annex" ? "annex" : section;
    const anchor = section === "references" && marker.depth === 1 ? `ref.${marker.token}` : formatStack(stack);
    open(anchor, marker.rest, kind);
  }

  const found = {
    situation: blocks.some((block) => block.kind === "situation"),
    mission: blocks.some((block) => block.kind === "mission"),
    execution: blocks.some((block) => block.kind === "execution"),
    sustainment: blocks.some((block) => block.kind === "sustainment"),
    command: blocks.some((block) => block.kind === "command"),
  };
  const findings = PARAGRAPH_KINDS.filter((kind) => !found[kind]).map((kind) => {
    const label = { situation: "Situation", mission: "Mission", execution: "Execution", sustainment: "Service support", command: "Command and signal" }[kind];
    return `${label} was not in the order.`;
  });
  return {
    blocks,
    paragraphCount: PARAGRAPH_KINDS.filter((kind) => found[kind]).length,
    found,
    annexes: [...annexes],
    findings,
  };
}

export function annexLetterFromName(fileName: string) {
  const match = fileName.match(/(?:annex|anx)[\s._-]*([a-z])\b/i);
  return match ? match[1].toUpperCase() : null;
}
