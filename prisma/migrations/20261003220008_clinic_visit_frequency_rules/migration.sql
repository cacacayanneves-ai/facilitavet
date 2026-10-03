-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "allowedWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "fixedVisitDate" DATE,
ADD COLUMN     "monthlyVisits" INTEGER,
ADD COLUMN     "oneVisitWeekday" INTEGER,
ADD COLUMN     "preferredWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "visitRule" TEXT;
