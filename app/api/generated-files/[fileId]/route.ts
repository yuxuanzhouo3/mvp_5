import { readGeneratedFile } from "@/lib/generated-files";

type RouteContext = {
  params: Promise<{ fileId: string }> | { fileId: string };
};

export async function GET(req: Request, context: RouteContext) {
  const params = await Promise.resolve(context.params);
  const fileId = params.fileId;
  const record = readGeneratedFile(fileId);

  if (!record) {
    return new Response("File not found or expired.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const url = new URL(req.url);
  const requestedName = url.searchParams.get("downloadName")?.trim();
  const fileName = requestedName && requestedName.length > 0 ? requestedName : record.fileName;
  const disposition = url.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

  return new Response(Uint8Array.from(record.bytes), {
    status: 200,
    headers: {
      "Content-Type": record.mimeType,
      "Content-Length": String(record.bytes.byteLength),
      "Cache-Control": "no-store",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
