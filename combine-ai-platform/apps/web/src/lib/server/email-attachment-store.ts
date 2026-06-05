import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

function resolveAttachmentRoot() {
  if (process.env.EMAIL_ATTACHMENT_DIR) return process.env.EMAIL_ATTACHMENT_DIR

  const monorepoRoot = join(process.cwd(), "data", "email-attachments")
  if (existsSync(join(process.cwd(), "apps", "web"))) {
    return monorepoRoot
  }

  return join(process.cwd(), "..", "..", "data", "email-attachments")
}

const ATTACHMENT_ROOT = resolveAttachmentRoot()

export function getAttachmentRoot() {
  return ATTACHMENT_ROOT
}

export function buildAttachmentStoragePath(workspaceId: string, attachmentId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return join(workspaceId, `${attachmentId}_${safeName}`)
}

export async function saveAttachmentFile(storagePath: string, data: Buffer) {
  const fullPath = join(ATTACHMENT_ROOT, storagePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, data)
  return fullPath
}

export async function readAttachmentFile(storagePath: string) {
  const fullPath = join(ATTACHMENT_ROOT, storagePath)
  return readFile(fullPath)
}
