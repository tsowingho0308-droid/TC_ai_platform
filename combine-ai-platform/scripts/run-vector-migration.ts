import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("Running pgvector migration...")

  // 1. Enable pgvector extension
  console.log("  Enabling pgvector extension...")
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`)
  console.log("  ✓ pgvector extension enabled")

  // 2. Add embedding column to KnowledgeChunk
  console.log("  Adding embedding column...")
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS embedding vector(1536)`
  )
  console.log("  ✓ embedding column added")

  // 3. Create IVFFlat index for approximate nearest neighbor search
  console.log("  Creating IVFFlat index...")
  try {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_knowledgechunk_embedding
       ON "KnowledgeChunk"
       USING ivfflat (embedding vector_cosine_ops)
       WITH (lists = 100)`
    )
    console.log("  ✓ IVFFlat index created")
  } catch (err) {
    // If IVFFlat index already exists but creating differently, try without IF NOT EXISTS
    const msg = err instanceof Error ? err.message : String(err)
    console.log("  ⚠ IVFFlat index creation note:", msg)
  }

  console.log("pgvector migration complete!")
}

main()
  .catch((e) => {
    console.error("pgvector migration failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
