-- CreateTable
CREATE TABLE IF NOT EXISTS "import_export_logs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'text/csv',
    "row_count" INTEGER,
    "error" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_export_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_export_logs_shop_id_type_created_at_idx"
ON "import_export_logs"("shop_id", "type", "created_at");

