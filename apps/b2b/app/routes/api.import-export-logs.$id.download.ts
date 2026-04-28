import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { ImportExportLog } from "@prisma/client";

type ImportExportLogDelegate = {
  findFirst: (args: unknown) => Promise<ImportExportLog | null>;
};

function getImportExportLogDelegate(dbClient: unknown): ImportExportLogDelegate | null {
  const d = dbClient as { importExportLog?: unknown };
  const delegate = d?.importExportLog as Partial<ImportExportLogDelegate> | undefined;
  if (typeof delegate?.findFirst === "function") return delegate as ImportExportLogDelegate;
  return null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;

  if (!id) return new Response("Missing id", { status: 400 });

  const delegate = getImportExportLogDelegate(db);
  if (!delegate) return new Response("Logs not available", { status: 503 });

  const log = await delegate.findFirst({ where: { id, shopId: session.shop } });

  if (!log) return new Response("Not found", { status: 404 });

  return new Response(log.content, {
    headers: {
      "Content-Type": `${log.mimeType || "text/csv"}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${log.filename}"`,
      "Cache-Control": "no-store",
    },
  });
};

