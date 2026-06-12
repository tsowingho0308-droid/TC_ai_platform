export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { loadEnvConfig } = await import("@next/env")
  const path = await import("node:path")
  const { fileURLToPath } = await import("node:url")

  /** combine-ai-platform root (apps/web/src → ../../..) */
  const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  loadEnvConfig(monorepoRoot)
}
