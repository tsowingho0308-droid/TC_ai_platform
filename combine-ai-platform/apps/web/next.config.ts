import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@combine-ai/shared-ui",
    "@combine-ai/contracts",
    "@combine-ai/ai-provider",
    "@combine-ai/auth",
    "@combine-ai/database",
  ],
}

export default nextConfig
