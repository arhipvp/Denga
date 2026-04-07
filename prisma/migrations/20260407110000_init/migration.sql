-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('CONFIRMED', 'NEEDS_CLARIFICATION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SourceMessageType" AS ENUM ('TELEGRAM_TEXT', 'TELEGRAM_RECEIPT', 'ADMIN_MANUAL');

-- CreateEnum
CREATE TYPE "SourceMessageStatus" AS ENUM ('RECEIVED', 'PENDING_REVIEW', 'PARSED', 'NEEDS_CLARIFICATION', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "ClarificationStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiParseAttemptType" AS ENUM ('INITIAL_PARSE', 'CLARIFICATION_REPARSE');

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL DEFAULT 'EXPENSE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "authorId" TEXT,
    "categoryId" TEXT,
    "sourceMessageId" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "comment" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceMessage" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "authorId" TEXT,
    "telegramMessageId" TEXT,
    "telegramChatId" TEXT,
    "type" "SourceMessageType" NOT NULL,
    "status" "SourceMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "text" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "telegramFileId" TEXT,
    "telegramFilePath" TEXT,
    "mimeType" TEXT,
    "originalName" TEXT,
    "localPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiParseAttempt" (
    "id" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "attemptType" "AiParseAttemptType" NOT NULL DEFAULT 'INITIAL_PARSE',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiParseAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClarificationSession" (
    "id" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "status" "ClarificationStatus" NOT NULL DEFAULT 'OPEN',
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "conversation" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClarificationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingOperationReview" (
    "id" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "authorId" TEXT,
    "status" "SourceMessageStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "draft" JSONB NOT NULL,
    "pendingField" TEXT,
    "lastBotMessageId" TEXT,
    "activePickerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingOperationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_telegramId_key" ON "TelegramAccount"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_householdId_parentId_type_name_key" ON "Category"("householdId", "parentId", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_sourceMessageId_key" ON "Transaction"("sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceMessage_telegramMessageId_key" ON "SourceMessage"("telegramMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ClarificationSession_sourceMessageId_key" ON "ClarificationSession"("sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingOperationReview_sourceMessageId_key" ON "PendingOperationReview"("sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_householdId_key_key" ON "AppSetting"("householdId", "key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramAccount" ADD CONSTRAINT "TelegramAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "SourceMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceMessage" ADD CONSTRAINT "SourceMessage_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceMessage" ADD CONSTRAINT "SourceMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "SourceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiParseAttempt" ADD CONSTRAINT "AiParseAttempt_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "SourceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationSession" ADD CONSTRAINT "ClarificationSession_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "SourceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingOperationReview" ADD CONSTRAINT "PendingOperationReview_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "SourceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingOperationReview" ADD CONSTRAINT "PendingOperationReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
