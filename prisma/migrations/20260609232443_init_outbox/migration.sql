-- CreateTable
CREATE TABLE "outbox_entries" (
    "id" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "outbox_entries_pkey" PRIMARY KEY ("id")
);
