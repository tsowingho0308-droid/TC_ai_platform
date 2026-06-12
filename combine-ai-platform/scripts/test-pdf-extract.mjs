import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const fixturePath = path.join(root, "fixtures/test-emails/RFP-2026-HK-IT-Cloud-Services.pdf")

console.log("=== PDF extraction diagnostic ===\n")

console.log("1. Dependency versions (npm ls):")
try {
  execSync("npm ls pdf-parse pdfjs-dist", { cwd: root, stdio: "inherit" })
} catch {
  console.warn("   npm ls reported issues — run `npm install` from combine-ai-platform/\n")
}

console.log("\n2. Fixture PDF extraction test:")
if (!fs.existsSync(fixturePath)) {
  console.error(`   FAIL: fixture not found at ${fixturePath}`)
  process.exit(1)
}

try {
  const { extractTextFromDocument } = await import(
    "../apps/web/src/lib/server/document-text.ts"
  )
  const buffer = fs.readFileSync(fixturePath)
  const text = await extractTextFromDocument(buffer, "RFP-2026-HK-IT-Cloud-Services.pdf", "application/pdf")
  console.log(`   OK: extracted ${text.length.toLocaleString()} characters`)
  console.log(`   Preview: ${text.slice(0, 120).replace(/\s+/g, " ")}…`)
  if (text.length < 50) {
    console.error("\n   FAIL: fixture should yield >50 chars — check pdf-parse / pdfjs-dist install")
    process.exit(1)
  }
} catch (err) {
  console.error(`   FAIL: ${err instanceof Error ? err.message : err}`)
  console.error("\n   Try: npm install && npm run dev (restart dev server after pull)")
  process.exit(1)
}

console.log("\n3. Optional: test your own PDF")
console.log("   node scripts/test-pdf-extract.mjs path/to/your.pdf")

const customPath = process.argv[2]
if (customPath) {
  const resolved = path.resolve(customPath)
  if (!fs.existsSync(resolved)) {
    console.error(`\n   Custom file not found: ${resolved}`)
    process.exit(1)
  }
  try {
    const { extractTextFromDocument } = await import(
      "../apps/web/src/lib/server/document-text.ts"
    )
    const buffer = fs.readFileSync(resolved)
    const text = await extractTextFromDocument(buffer, path.basename(resolved), "application/pdf")
    console.log(`\n   Custom PDF: ${text.length.toLocaleString()} characters`)
    if (text.length < 50) {
      console.warn("   Likely image-only / scanned PDF — use a text-based PDF or DOCX")
    }
  } catch (err) {
    console.error(`\n   Custom PDF FAIL: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

console.log("\nDone. If fixture passes but Analyze fails on your PDF, the PDF may be scanned (no text layer).")
