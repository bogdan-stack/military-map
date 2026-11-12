import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractUpload } from "./extract";
import { readOrderFiles } from "./upload";

const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 73>>stream
BT /F1 12 Tf 20 80 Td (OPORD 04-26 121000B NOV 26) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
0000000225 00000 n 
0000000348 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
416
%%EOF`;

async function docx(paragraphs: string[]) {
  const body = paragraphs.map((line) => `<w:p><w:r><w:t xml:space="preserve">${line.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractUpload", () => {
  it("reads a digital PDF", async () => {
    const file = await extractUpload("OPORD-04-26.pdf", Buffer.from(PDF));
    expect(file.status).toBe("read");
    expect(file.pages).toBe(1);
    expect(file.text).toContain("121000B NOV 26");
    expect(file.sha256).toHaveLength(64);
  });

  it("reads a Word order", async () => {
    const bytes = await docx(["OPORD 04-26", "2. MISSION", "2 MN BDE attacks NLT 190600B NOV 26."]);
    const file = await extractUpload("OPORD.docx", bytes);
    expect(file.status).toBe("read");
    expect(file.text).toContain("190600B NOV 26");
  });

  it("reads a time from an image", async () => {
    const canvas = createCanvas(480, 90);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 480, 90);
    ctx.fillStyle = "#000";
    ctx.font = "28px sans-serif";
    ctx.fillText("not earlier than 180200B NOV 26", 12, 54);
    const file = await extractUpload("overlay.png", canvas.toBuffer("image/png"));
    expect(file.status).toBe("read");
    expect(file.ocrPages).toBe(1);
    expect(file.text.toUpperCase()).toContain("180200B");
  }, 30000);

  it("turns the Word order into the reading checks", async () => {
    const bytes = await docx([
      "OPERATION STEEL MERIDIAN",
      "References:",
      "f. 1 MN DIV Signal Instructions",
      "2. MISSION",
      "2 MN BDE attacks NLT 190600B NOV 26.",
    ]);
    const report = await readOrderFiles([{ name: "OPORD-04-26.docx", bytes }]);
    expect(report.identity.operationName).toBe("Steel Meridian");
    expect(report.timezone?.letter).toBe("B");
    expect(report.missingReferences.map((item) => item.letter)).toContain("F");
    expect(report.files[0].status).toBe("read");
  });

  it("refuses a legacy .doc file", async () => {
    const file = await extractUpload("order.doc", Buffer.from("not a doc"));
    expect(file.status).toBe("unsupported");
  });
});
