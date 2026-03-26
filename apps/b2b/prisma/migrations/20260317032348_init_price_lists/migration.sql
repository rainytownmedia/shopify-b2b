/*
  Warnings:

  - You are about to drop the `PriceList` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PriceListItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Shop` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PriceList" DROP CONSTRAINT "PriceList_shopId_fkey";

-- DropForeignKey
ALTER TABLE "PriceListItem" DROP CONSTRAINT "PriceListItem_priceListId_fkey";

-- DropTable
DROP TABLE "PriceList";

-- DropTable
DROP TABLE "PriceListItem";

-- DropTable
DROP TABLE "Session";

-- DropTable
DROP TABLE "Shop";

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "access_token" TEXT NOT NULL,
    "user_id" BIGINT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "account_owner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "email_verified" BOOLEAN DEFAULT false,
    "refresh_token" TEXT,
    "refresh_token_expires" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "domain" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "b2b_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_item" (
    "id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_list_shop_id_customer_tag_key" ON "price_list"("shop_id", "customer_tag");

-- CreateIndex
CREATE INDEX "price_list_item_product_id_idx" ON "price_list_item"("product_id");

-- CreateIndex
CREATE INDEX "price_list_item_variant_id_idx" ON "price_list_item"("variant_id");

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;
