/*
  Warnings:

  - You are about to drop the column `installedAt` on the `Shop` table. All the data in the column will be lost.
  - You are about to drop the column `uninstalledAt` on the `Shop` table. All the data in the column will be lost.
  - You are about to drop the `WholesalePrice` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "WholesalePrice" DROP CONSTRAINT "WholesalePrice_shopId_fkey";

-- AlterTable
ALTER TABLE "Shop" DROP COLUMN "installedAt",
DROP COLUMN "uninstalledAt";

-- DropTable
DROP TABLE "WholesalePrice";

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_shopId_customerTag_key" ON "PriceList"("shopId", "customerTag");

-- CreateIndex
CREATE INDEX "PriceListItem_productId_idx" ON "PriceListItem"("productId");

-- CreateIndex
CREATE INDEX "PriceListItem_variantId_idx" ON "PriceListItem"("variantId");

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
