import { existsSync } from "node:fs"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export type ComposeAttachmentMeta = {
  id: string
  workspaceId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  textExcerpt: string
}

function resolveComposeAttachmentRoot() {
  if (process.env.COMPOSE_ATTACHMENT_DIR) return process.env.COMPOSE_ATTACHMENT_DIR

  const monorepoRoot = join(process.cwd(), "data", "compose-attachments")
  if (existsSync(join(process.cwd(), "apps", "web"))) {
    return monorepoRoot
  }

  return join(process.cwd(), "..", "..", "data", "compose-attachments")
}

const COMPOSE_ATTACHMENT_ROOT = resolveComposeAttachmentRoot()

export function buildComposeAttachmentPath(workspaceId: string, attachmentId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return join(workspaceId, `${attachmentId}_${safeName}`)
}

function metaPath(workspaceId: string, attachmentId: string) {
  return join(COMPOSE_ATTACHMENT_ROOT, workspaceId, `${attachmentId}.meta.json`)
}

export async function saveComposeAttachmentFile(storagePath: string, data: Buffer) {
  const fullPath = join(COMPOSE_ATTACHMENT_ROOT, storagePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, data)
  return fullPath
}

export async function readComposeAttachmentFile(storagePath: string) {
  return readFile(join(COMPOSE_ATTACHMENT_ROOT, storagePath))
}

export async function deleteComposeAttachmentFile(storagePath: string) {
  try {
    await unlink(join(COMPOSE_ATTACHMENT_ROOT, storagePath))
  } catch {
    // ignore missing files
  }
}

export async function saveComposeAttachmentMeta(meta: ComposeAttachmentMeta) {
  const fullMetaPath = metaPath(meta.workspaceId, meta.id)
  await mkdir(dirname(fullMetaPath), { recursive: true })
  await writeFile(fullMetaPath, JSON.stringify(meta), "utf8")
}

export async function loadComposeAttachmentMeta(workspaceId: string, attachmentId: string) {
  try {
    const raw = await readFile(metaPath(workspaceId, attachmentId), "utf8")
    const parsed = JSON.parse(raw) as ComposeAttachmentMeta
    if (parsed.workspaceId !== workspaceId) return null
    return parsed
  } catch {
    return null
  }
}

export async function deleteComposeAttachmentMeta(workspaceId: string, attachmentId: string) {
  try {
    await unlink(metaPath(workspaceId, attachmentId))
  } catch {
    // ignore
  }
}
