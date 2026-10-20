-- AlterTable: Add Token Family and Rotation Tracking to refresh_sessions
ALTER TABLE "refresh_sessions" ADD COLUMN "family_id" TEXT NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "refresh_sessions" ADD COLUMN "replaced_by_token_hash" TEXT;
ALTER TABLE "refresh_sessions" ADD COLUMN "revoked_at" TIMESTAMP(3);
ALTER TABLE "refresh_sessions" ADD COLUMN "revocation_reason" TEXT;
ALTER TABLE "refresh_sessions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions"("family_id");
