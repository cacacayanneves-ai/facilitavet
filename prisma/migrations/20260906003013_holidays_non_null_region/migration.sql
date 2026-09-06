/*
  Warnings:

  - Made the column `state` on table `Holiday` required. This step will fail if there are existing NULL values in that column.
  - Made the column `city` on table `Holiday` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Holiday" ALTER COLUMN "state" SET NOT NULL,
ALTER COLUMN "state" SET DEFAULT '',
ALTER COLUMN "city" SET NOT NULL,
ALTER COLUMN "city" SET DEFAULT '';
