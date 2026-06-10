import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const publicDir = path.join(webRoot, "public")

const pdfjsDistRoot = path.dirname(require.resolve("pdfjs-dist/package.json"))
const workerSrc = path.join(pdfjsDistRoot, "build", "pdf.worker.min.mjs")
const workerDest = path.join(publicDir, "pdf.worker.min.mjs")

fs.mkdirSync(publicDir, { recursive: true })
fs.copyFileSync(workerSrc, workerDest)
console.log("Copied pdf.worker.min.mjs to public/")
