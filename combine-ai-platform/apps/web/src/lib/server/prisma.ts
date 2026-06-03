import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL || "postgresql://combine_ai:combine_ai_dev@localhost:5432/combine_ai_platform",
})

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
