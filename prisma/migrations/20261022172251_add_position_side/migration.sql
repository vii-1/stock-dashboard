-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PaperPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "avgBuyPrice" REAL NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'LONG',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PaperPosition" ("assetClass", "avgBuyPrice", "id", "mode", "quantity", "symbol", "updatedAt") SELECT "assetClass", "avgBuyPrice", "id", "mode", "quantity", "symbol", "updatedAt" FROM "PaperPosition";
DROP TABLE "PaperPosition";
ALTER TABLE "new_PaperPosition" RENAME TO "PaperPosition";
CREATE UNIQUE INDEX "PaperPosition_mode_symbol_key" ON "PaperPosition"("mode", "symbol");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
