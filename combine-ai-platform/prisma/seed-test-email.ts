/**
 * Seeds a realistic tender/RFP test email with PDF attachment into the Primary Inbox.
 * Run: npm run db:seed:test-email
 */
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const fixturesDir = join(repoRoot, "fixtures/test-emails")

function loadFixtureText(name: string) {
  return readFileSync(join(fixturesDir, name), "utf-8").trim()
}

function loadFixtureBuffer(name: string) {
  return readFileSync(join(fixturesDir, name))
}

function resolveAttachmentRoot() {
  return join(repoRoot, "data", "email-attachments")
}

function buildStoragePath(workspaceId: string, attachmentId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return join(workspaceId, `${attachmentId}_${safeName}`)
}

async function saveAttachmentFile(storagePath: string, data: Buffer) {
  const { mkdir, writeFile } = await import("node:fs/promises")
  const fullPath = join(resolveAttachmentRoot(), storagePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, data)
}

async function main() {
  const workspace = await prisma.workspace.findFirst({ where: { id: "demo-workspace" } })
  if (!workspace) {
    throw new Error("Demo workspace not found. Run npm run db:seed first.")
  }

  const inbox = await prisma.inbox.findFirst({
    where: { workspaceId: workspace.id, slug: "primary" },
  })
  if (!inbox) {
    throw new Error("Primary inbox not found. Run npm run db:seed first.")
  }

  const coverLetter = loadFixtureText("email-cover-letter.txt")
  const emailBody = coverLetter

  const conversationId = "test-email-rfp-2026-it-cloud"
  const messageId = "test-email-rfp-2026-it-cloud-msg-1"
  const attachmentId = "test-email-rfp-2026-it-cloud-att-pdf"
  const pdfFileName = "RFP-2026-HK-IT-Cloud-Services.pdf"

  const subject = "[RFP] IT Cloud Infrastructure & Managed Services — Ref: HK-IT-2026-0042"
  const preview =
    "Please find attached our official Request for Proposal (RFP) for IT Cloud Infrastructure & Managed Services. Submission deadline: 30 June 2026."

  const conversation = await prisma.conversation.upsert({
    where: { id: conversationId },
    update: {
      subject,
      senderName: "Fiona Cheung",
      senderEmail: "procurement.it@hkdtb.gov.hk",
      preview,
      replyTo: "procurement.it@hkdtb.gov.hk",
      workType: "commercial",
      aiRouteConfidence: 0.95,
      aiIntentSummary: "Official RFP for IT cloud infrastructure tender — requires proposal submission",
      aiRouteReason: "Contains tender reference, submission deadline, budget, and RFP attachment",
      read: false,
      folderId: "inbox",
      status: "OPEN",
    },
    create: {
      id: conversationId,
      workspaceId: workspace.id,
      inboxId: inbox.id,
      subject,
      senderName: "Fiona Cheung",
      senderEmail: "procurement.it@hkdtb.gov.hk",
      preview,
      replyTo: "procurement.it@hkdtb.gov.hk",
      workType: "commercial",
      aiRouteConfidence: 0.95,
      aiIntentSummary: "Official RFP for IT cloud infrastructure tender — requires proposal submission",
      aiRouteReason: "Contains tender reference, submission deadline, budget, and RFP attachment",
      read: false,
      folderId: "inbox",
      status: "OPEN",
      labels: ["tender", "rfp", "commercial"],
    },
  })

  await prisma.message.upsert({
    where: { id: messageId },
    update: {
      body: emailBody,
      bodyText: emailBody,
    },
    create: {
      id: messageId,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      body: emailBody,
      bodyText: emailBody,
    },
  })

  const pdfBuffer = loadFixtureBuffer(pdfFileName)
  const storagePath = buildStoragePath(workspace.id, attachmentId, pdfFileName)
  await saveAttachmentFile(storagePath, pdfBuffer)

  await prisma.messageAttachment.upsert({
    where: { id: attachmentId },
    update: {
      fileName: pdfFileName,
      mimeType: "application/pdf",
      sizeBytes: pdfBuffer.length,
      storagePath,
    },
    create: {
      id: attachmentId,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      messageId,
      fileName: pdfFileName,
      mimeType: "application/pdf",
      sizeBytes: pdfBuffer.length,
      storagePath,
      providerAttachmentId: "local-rfp-pdf",
    },
  })

  console.log("✓ Test tender email seeded successfully")
  console.log("  Conversation ID:", conversation.id)
  console.log("  Attachment ID:", attachmentId)
  console.log("  PDF:", pdfFileName, `(${pdfBuffer.length} bytes)`)
  console.log("  Subject:", subject)
  console.log("  Sender: Fiona Cheung <procurement.it@hkdtb.gov.hk>")
  console.log("")
  console.log("How to test:")
  console.log("  1. Open http://localhost:3000/email")
  console.log("  2. Select the RFP email → click 'Open in Tender'")
  console.log("  3. On Tender page click 'Analyze PDF' on the attachment")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
