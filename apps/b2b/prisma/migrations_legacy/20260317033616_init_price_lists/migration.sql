-- AlterTable
ALTER TABLE "price_list_item" ADD COLUMN     "discount_type" TEXT NOT NULL DEFAULT 'FIXED_PRICE',
ADD COLUMN     "min_quantity" INTEGER NOT NULL DEFAULT 1;
