import fs from "node:fs"
import path from "node:path"

let envLoaded = false

function parseEnvFile(filePath: string): void {
  const content = fs.readFileSync(filePath, "utf8")
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

/** Walk up from cwd to find combine-ai-platform/.env and load into process.env */
export function ensureAiEnvLoaded(): void {
  if (envLoaded) return

  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const envFile = path.join(dir, ".env")
    if (fs.existsSync(envFile)) {
      parseEnvFile(envFile)
      if (process.env["DASHSCOPE_API_KEY"] || process.env["LLM_API_KEY"]) {
        envLoaded = true
        return
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  envLoaded = true
}

export function readEnv(name: string): string {
  ensureAiEnvLoaded()
  return process.env[name] ?? ""
}
