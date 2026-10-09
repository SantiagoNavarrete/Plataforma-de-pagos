ALTER TABLE "User"
  ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "image" TEXT,
  ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "banReason" TEXT,
  ADD COLUMN "banExpires" TIMESTAMPTZ(3);

UPDATE "User" SET "name" = '' WHERE "name" IS NULL;
ALTER TABLE "User" ALTER COLUMN "name" SET DEFAULT '';
ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE VARCHAR(32)
  USING CASE WHEN "role" = 'ADMIN'::"UserRole" THEN 'admin' ELSE 'user' END;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'user';
DROP TYPE "UserRole";

ALTER TABLE "AuthAccount"
  ADD COLUMN "accessToken" TEXT,
  ADD COLUMN "refreshToken" TEXT,
  ADD COLUMN "idToken" TEXT,
  ADD COLUMN "accessTokenExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "refreshTokenExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "password" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AuthSession" (
  "id" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "token" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" VARCHAR(45),
  "userAgent" VARCHAR(500),
  "userId" UUID NOT NULL,
  "impersonatedBy" VARCHAR(255),
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthVerification" (
  "id" UUID NOT NULL,
  "identifier" VARCHAR(320) NOT NULL,
  "value" VARCHAR(500) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthRateLimit" (
  "id" UUID NOT NULL,
  "key" VARCHAR(255) NOT NULL,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL,
  CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");
CREATE UNIQUE INDEX "AuthRateLimit_key_key" ON "AuthRateLimit"("key");

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
