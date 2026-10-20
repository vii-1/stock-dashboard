-- CreateTable
CREATE TABLE "BrokerSession" (
    "broker" TEXT NOT NULL PRIMARY KEY,
    "accessToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);
