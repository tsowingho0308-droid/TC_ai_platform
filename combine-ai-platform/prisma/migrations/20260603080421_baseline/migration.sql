-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('PASSWORD', 'GOOGLE');

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('ADMIN', 'SUPERVISOR', 'AGENT');

-- CreateEnum
CREATE TYPE "FolderId" AS ENUM ('inbox', 'starred', 'sent', 'drafts', 'archive', 'trash');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'NOTE');

-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('GMAIL');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "GmailSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "InboxKind" AS ENUM ('PRIMARY', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "AgentPolicyKind" AS ENUM ('TRIAGE', 'REPLY_SUGGESTION');

-- CreateEnum
CREATE TYPE "AgentRunKind" AS ENUM ('TRIAGE', 'REPLY_SUGGESTION', 'REPORT_EXTRACTION', 'TENDER_ANALYSIS', 'FINANCE_EXTRACTION', 'FINANCE_POLICY_CHECK', 'FINANCE_THREE_WAY_MATCH', 'HELPDESK_QA', 'WORKFLOW_EXECUTION');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "InquiryTaskStatus" AS ENUM ('PENDING', 'CLAIMED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InquiryReplyStatus" AS ENUM ('DRAFT', 'SENT');

-- CreateEnum
CREATE TYPE "DepartmentReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "InquiryTaskOrigin" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "FinanceSessionType" AS ENUM ('EXPENSE_REVIEW', 'THREE_WAY_MATCH');

-- CreateEnum
CREATE TYPE "FinanceDocType" AS ENUM ('RECEIPT', 'INVOICE', 'PURCHASE_ORDER', 'GOODS_RECEIPT');

-- CreateEnum
CREATE TYPE "HelpdeskDepartment" AS ENUM ('HR', 'IT', 'ADMIN', 'FINANCE', 'GENERAL');

-- CreateEnum
CREATE TYPE "HelpdeskTicketStatus" AS ENUM ('OPEN', 'ANSWERED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WorkflowCategory" AS ENUM ('ONBOARDING', 'OFFBOARDING', 'PROCUREMENT', 'LEAVE_APPROVAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "role" "RoleType" NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "uiLanguage" TEXT NOT NULL DEFAULT 'zh-HK',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthCodeExchange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthCodeExchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "defaultAssigneeId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "InboxKind" NOT NULL DEFAULT 'PRIMARY',
    "aiTriageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "routingDescription" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "parentConversationId" TEXT,
    "assignedToId" TEXT,
    "folderId" "FolderId" NOT NULL DEFAULT 'inbox',
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "departmentQuestionTitle" TEXT,
    "departmentQuestionBody" TEXT,
    "departmentReviewStatus" "DepartmentReviewStatus",
    "departmentSubmittedAt" TIMESTAMP(3),
    "departmentSubmittedById" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "labels" TEXT[],
    "replyTo" TEXT NOT NULL,
    "sourceProvider" "MailProvider",
    "providerThreadId" TEXT,
    "aiTriagedAt" TIMESTAMP(3),
    "aiRouteConfidence" DOUBLE PRECISION,
    "aiRouteReason" TEXT,
    "aiIntentSummary" TEXT,
    "workType" TEXT,
    "systemFinalReplyDraft" TEXT,
    "systemFinalReplyUpdatedAt" TIMESTAMP(3),
    "finalReplyDraft" TEXT,
    "finalReplyUpdatedAt" TIMESTAMP(3),
    "finalReplyEditedManuallyAt" TIMESTAMP(3),
    "finalReplyStatus" "InquiryReplyStatus" NOT NULL DEFAULT 'DRAFT',
    "finalReplySentAt" TIMESTAMP(3),
    "autoSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL DEFAULT 'INBOUND',
    "sourceProvider" "MailProvider",
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "body" TEXT NOT NULL,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "gmailLabelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "provider" "MailProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "externalEmail" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "scopes" TEXT[],
    "tokenExpiresAt" TIMESTAMP(3),
    "gmailHistoryId" TEXT,
    "lastHistorySyncedAt" TIMESTAMP(3),
    "lastFullSyncAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailSyncRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "status" "GmailSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "triggerSource" TEXT NOT NULL DEFAULT 'manual',
    "initiatedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "cursorStart" TEXT,
    "cursorEnd" TEXT,
    "error" TEXT,
    "fetchedThreads" INTEGER NOT NULL DEFAULT 0,
    "fetchedMessages" INTEGER NOT NULL DEFAULT 0,
    "conversationsCreated" INTEGER NOT NULL DEFAULT 0,
    "conversationsUpdated" INTEGER NOT NULL DEFAULT 0,
    "messagesCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AgentPolicyKind" NOT NULL DEFAULT 'REPLY_SUGGESTION',
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "policyId" TEXT,
    "kind" "AgentRunKind" NOT NULL DEFAULT 'REPLY_SUGGESTION',
    "status" "AgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT,
    "status" "AgentSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "draftReply" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "childConversationId" TEXT,
    "origin" "InquiryTaskOrigin" NOT NULL DEFAULT 'AI',
    "status" "InquiryTaskStatus" NOT NULL DEFAULT 'PENDING',
    "questionTitle" TEXT NOT NULL,
    "questionBody" TEXT NOT NULL,
    "aiDraft" TEXT,
    "approvedReply" TEXT,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "sourceQuoteStart" INTEGER,
    "sourceQuoteEnd" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "claimedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InquiryTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "description" TEXT,
    "descriptionZh" TEXT,
    "icon" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rows" JSONB,
    "draftNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportConversationTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "assistantReply" TEXT,
    "trace" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh_hk',
    "title" TEXT NOT NULL,
    "scenario" TEXT,
    "description" TEXT,
    "docxFile" TEXT NOT NULL,
    "promptFile" TEXT,
    "docxFields" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "templateId" TEXT,
    "fieldInputs" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tenderType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderComparison" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "comparisonType" TEXT NOT NULL DEFAULT 'multi_client',
    "comparisonData" JSONB,
    "comparedTenderIds" TEXT[],
    "exportedFormat" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossAgentLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossAgentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "sessionType" "FinanceSessionType" NOT NULL DEFAULT 'EXPENSE_REVIEW',
    "status" TEXT NOT NULL DEFAULT 'active',
    "extractedRows" JSONB,
    "policyResults" JSONB,
    "draftNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceDocument" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "docType" "FinanceDocType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "extractedData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceConversationTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "assistantReply" TEXT,
    "trace" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpensePolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "description" TEXT,
    "threshold" DOUBLE PRECISION,
    "unit" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpensePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "department" "HelpdeskDepartment" NOT NULL DEFAULT 'GENERAL',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'zh-HK',
    "sourceDocName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskTicket" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "question" TEXT NOT NULL,
    "aiAnswer" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiSources" JSONB,
    "status" "HelpdeskTicketStatus" NOT NULL DEFAULT 'OPEN',
    "department" "HelpdeskDepartment" NOT NULL DEFAULT 'GENERAL',
    "knowledgeBaseId" TEXT,
    "assignedToId" TEXT,
    "humanReply" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "WorkflowCategory" NOT NULL DEFAULT 'ONBOARDING',
    "steps" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "category" "WorkflowCategory" NOT NULL DEFAULT 'ONBOARDING',
    "targetPerson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStepRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "assignedToId" TEXT,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "slaHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workspace_accountId_idx" ON "Workspace"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_accountId_idx" ON "User"("accountId");

-- CreateIndex
CREATE INDEX "User_workspaceId_idx" ON "User"("workspaceId");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerAccountId_key" ON "AuthIdentity"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AuthCodeExchange_codeHash_key" ON "AuthCodeExchange"("codeHash");

-- CreateIndex
CREATE INDEX "AuthCodeExchange_userId_idx" ON "AuthCodeExchange"("userId");

-- CreateIndex
CREATE INDEX "AuthCodeExchange_expiresAt_idx" ON "AuthCodeExchange"("expiresAt");

-- CreateIndex
CREATE INDEX "Inbox_workspaceId_idx" ON "Inbox"("workspaceId");

-- CreateIndex
CREATE INDEX "Inbox_workspaceId_kind_idx" ON "Inbox"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "Inbox_workspaceId_defaultAssigneeId_idx" ON "Inbox"("workspaceId", "defaultAssigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "Inbox_workspaceId_slug_key" ON "Inbox"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_inboxId_folderId_idx" ON "Conversation"("workspaceId", "inboxId", "folderId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_createdAt_idx" ON "Conversation"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_parentConversationId_createdAt_idx" ON "Conversation"("workspaceId", "parentConversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_parentConversationId_departmentRev_idx" ON "Conversation"("workspaceId", "parentConversationId", "departmentReviewStatus");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_departmentSubmittedById_idx" ON "Conversation"("workspaceId", "departmentSubmittedById");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_inboxId_sourceProvider_providerThreadId_key" ON "Conversation"("inboxId", "sourceProvider", "providerThreadId");

-- CreateIndex
CREATE INDEX "InboxMembership_workspaceId_userId_idx" ON "InboxMembership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "InboxMembership_workspaceId_inboxId_idx" ON "InboxMembership"("workspaceId", "inboxId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMembership_userId_inboxId_key" ON "InboxMembership"("userId", "inboxId");

-- CreateIndex
CREATE INDEX "Message_workspaceId_conversationId_createdAt_idx" ON "Message"("workspaceId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_workspaceId_sourceProvider_providerThreadId_created_idx" ON "Message"("workspaceId", "sourceProvider", "providerThreadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_workspaceId_sourceProvider_providerMessageId_key" ON "Message"("workspaceId", "sourceProvider", "providerMessageId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_conversationId_createdAt_idx" ON "AuditLog"("workspaceId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "MailIntegration_workspaceId_inboxId_status_idx" ON "MailIntegration"("workspaceId", "inboxId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MailIntegration_inboxId_provider_key" ON "MailIntegration"("inboxId", "provider");

-- CreateIndex
CREATE INDEX "GmailSyncRun_workspaceId_status_createdAt_idx" ON "GmailSyncRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GmailSyncRun_integrationId_createdAt_idx" ON "GmailSyncRun"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPolicy_workspaceId_enabled_idx" ON "AgentPolicy"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "AgentPolicy_workspaceId_kind_enabled_idx" ON "AgentPolicy"("workspaceId", "kind", "enabled");

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_conversationId_createdAt_idx" ON "AgentRun"("workspaceId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_kind_status_createdAt_idx" ON "AgentRun"("workspaceId", "kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentSuggestion_workspaceId_conversationId_createdAt_idx" ON "AgentSuggestion"("workspaceId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentSuggestion_workspaceId_status_idx" ON "AgentSuggestion"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InquiryTask_childConversationId_key" ON "InquiryTask"("childConversationId");

-- CreateIndex
CREATE INDEX "InquiryTask_workspaceId_inboxId_status_createdAt_idx" ON "InquiryTask"("workspaceId", "inboxId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryTask_workspaceId_conversationId_sortOrder_idx" ON "InquiryTask"("workspaceId", "conversationId", "sortOrder");

-- CreateIndex
CREATE INDEX "InquiryTask_workspaceId_sourceMessageId_idx" ON "InquiryTask"("workspaceId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "InquiryTask_workspaceId_childConversationId_idx" ON "InquiryTask"("workspaceId", "childConversationId");

-- CreateIndex
CREATE INDEX "InquiryTask_workspaceId_claimedById_idx" ON "InquiryTask"("workspaceId", "claimedById");

-- CreateIndex
CREATE INDEX "InquiryTask_workspaceId_approvedById_idx" ON "InquiryTask"("workspaceId", "approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE INDEX "ReportSession_workspaceId_userId_updatedAt_idx" ON "ReportSession"("workspaceId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ReportConversationTurn_sessionId_createdAt_idx" ON "ReportConversationTurn"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "TenderTemplate_workspaceId_scenario_idx" ON "TenderTemplate"("workspaceId", "scenario");

-- CreateIndex
CREATE INDEX "TenderTemplate_workspaceId_locale_idx" ON "TenderTemplate"("workspaceId", "locale");

-- CreateIndex
CREATE INDEX "TenderSession_workspaceId_userId_updatedAt_idx" ON "TenderSession"("workspaceId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "TenderComparison_workspaceId_userId_createdAt_idx" ON "TenderComparison"("workspaceId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "CrossAgentLink_workspaceId_sourceType_sourceId_idx" ON "CrossAgentLink"("workspaceId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CrossAgentLink_workspaceId_targetType_targetId_idx" ON "CrossAgentLink"("workspaceId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "FinanceSession_workspaceId_userId_updatedAt_idx" ON "FinanceSession"("workspaceId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "FinanceSession_workspaceId_sessionType_status_idx" ON "FinanceSession"("workspaceId", "sessionType", "status");

-- CreateIndex
CREATE INDEX "FinanceDocument_sessionId_docType_idx" ON "FinanceDocument"("sessionId", "docType");

-- CreateIndex
CREATE INDEX "FinanceConversationTurn_sessionId_createdAt_idx" ON "FinanceConversationTurn"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ExpensePolicy_workspaceId_enabled_idx" ON "ExpensePolicy"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "KnowledgeBase_workspaceId_department_idx" ON "KnowledgeBase"("workspaceId", "department");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBase_workspaceId_slug_key" ON "KnowledgeBase"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_knowledgeBaseId_language_idx" ON "KnowledgeArticle"("knowledgeBaseId", "language");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_articleId_idx" ON "KnowledgeChunk"("articleId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_articleId_chunkIndex_idx" ON "KnowledgeChunk"("articleId", "chunkIndex");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_workspaceId_status_createdAt_idx" ON "HelpdeskTicket"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_workspaceId_department_status_idx" ON "HelpdeskTicket"("workspaceId", "department", "status");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_workspaceId_assignedToId_status_idx" ON "HelpdeskTicket"("workspaceId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_workspaceId_category_idx" ON "WorkflowTemplate"("workspaceId", "category");

-- CreateIndex
CREATE INDEX "WorkflowRun_workspaceId_status_createdAt_idx" ON "WorkflowRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_workspaceId_category_status_idx" ON "WorkflowRun"("workspaceId", "category", "status");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_workflowRunId_stepIndex_idx" ON "WorkflowStepRun"("workflowRunId", "stepIndex");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_assignedToId_status_idx" ON "WorkflowStepRun"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthCodeExchange" ADD CONSTRAINT "AuthCodeExchange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_defaultAssigneeId_fkey" FOREIGN KEY ("defaultAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_parentConversationId_fkey" FOREIGN KEY ("parentConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_departmentSubmittedById_fkey" FOREIGN KEY ("departmentSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMembership" ADD CONSTRAINT "InboxMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMembership" ADD CONSTRAINT "InboxMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMembership" ADD CONSTRAINT "InboxMembership_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailIntegration" ADD CONSTRAINT "MailIntegration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailIntegration" ADD CONSTRAINT "MailIntegration_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailSyncRun" ADD CONSTRAINT "GmailSyncRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailSyncRun" ADD CONSTRAINT "GmailSyncRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "MailIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPolicy" ADD CONSTRAINT "AgentPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AgentPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSuggestion" ADD CONSTRAINT "AgentSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSuggestion" ADD CONSTRAINT "AgentSuggestion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSuggestion" ADD CONSTRAINT "AgentSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryTask" ADD CONSTRAINT "InquiryTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryTask" ADD CONSTRAINT "InquiryTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryTask" ADD CONSTRAINT "InquiryTask_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryTask" ADD CONSTRAINT "InquiryTask_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryTask" ADD CONSTRAINT "InquiryTask_childConversationId_fkey" FOREIGN KEY ("childConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryTask" ADD CONSTRAINT "InquiryTask_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryTask" ADD CONSTRAINT "InquiryTask_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSession" ADD CONSTRAINT "ReportSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSession" ADD CONSTRAINT "ReportSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportConversationTurn" ADD CONSTRAINT "ReportConversationTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderTemplate" ADD CONSTRAINT "TenderTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderSession" ADD CONSTRAINT "TenderSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderSession" ADD CONSTRAINT "TenderSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderSession" ADD CONSTRAINT "TenderSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TenderTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderComparison" ADD CONSTRAINT "TenderComparison_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderComparison" ADD CONSTRAINT "TenderComparison_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossAgentLink" ADD CONSTRAINT "CrossAgentLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSession" ADD CONSTRAINT "FinanceSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSession" ADD CONSTRAINT "FinanceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FinanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceConversationTurn" ADD CONSTRAINT "FinanceConversationTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FinanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePolicy" ADD CONSTRAINT "ExpensePolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTemplate" ADD CONSTRAINT "WorkflowTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
