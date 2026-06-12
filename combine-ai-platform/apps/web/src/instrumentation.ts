export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { loadEnvConfig } = await import("@next/env")

  // Next.js dev runs with cwd at apps/web; load env from monorepo root.
  const cwd = process.cwd()
  const monorepoRoot = cwd.endsWith(`${"apps/web"}`) || cwd.endsWith("apps\\web")
    ? `${cwd}/../..`
    : cwd

  loadEnvConfig(monorepoRoot)
}
