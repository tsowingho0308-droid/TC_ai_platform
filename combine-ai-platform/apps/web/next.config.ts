import { loadEnvConfig } from "@next/env"
import type { NextConfig } from "next"
import path from "node:path"

const projectRoot = path.resolve(import.meta.dirname, "../..")
loadEnvConfig(projectRoot)

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth", "pdfkit"],
  turbopack: {
    root: projectRoot,
  },
  transpilePackages: [
    "@combine-ai/shared-ui",
    "@combine-ai/contracts",
    "@combine-ai/ai-provider",
    "@combine-ai/auth",
    "@combine-ai/database",
  ],
}

export default nextConfig
