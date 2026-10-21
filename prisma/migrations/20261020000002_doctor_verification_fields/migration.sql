-- AlterTable: Add verification fields and index to doctor_profiles
ALTER TABLE "doctor_profiles" ADD COLUMN "verified_by" TEXT;
ALTER TABLE "doctor_profiles" ADD COLUMN "rejection_reason" TEXT;

-- CreateIndex
CREATE INDEX "doctor_profiles_verification_status_idx" ON "doctor_profiles"("verification_status");
