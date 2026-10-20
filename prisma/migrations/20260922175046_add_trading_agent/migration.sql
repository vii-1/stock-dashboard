-- CreateTable
CREATE TABLE "PaperAccount" (
    "mode" TEXT NOT NULL PRIMARY KEY,
    "cash" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PaperPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "avgBuyPrice" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "killSwitchActive" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "tradesToday" INTEGER NOT NULL DEFAULT 0,
    "realizedLossToday" REAL NOT NULL DEFAULT 0,
    "lastResetDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DecisionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "executed" BOOLEAN NOT NULL,
    "blockReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperPosition_mode_symbol_key" ON "PaperPosition"("mode", "symbol");
