import { readOrderFiles } from "@/lib/order/upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const incoming = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (!incoming.length) return Response.json({ error: "Drop at least one file." }, { status: 400 });
  const files = await Promise.all(incoming.map(async (file) => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) })));
  const report = await readOrderFiles(files);
  return Response.json(report);
}
