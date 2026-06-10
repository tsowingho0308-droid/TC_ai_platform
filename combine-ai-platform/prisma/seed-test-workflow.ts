/**
 * Seeds a demo onboarding workflow run for testing Workflow Agent.
 * Run: npm run db:seed:test-workflow
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const workspace = await prisma.workspace.findFirst({ where: { id: "demo-workspace" } })
  if (!workspace) throw new Error("Run npm run db:seed first.")

  const template = await prisma.workflowTemplate.findFirst({
    where: { id: "template-onboarding-default", workspaceId: workspace.id },
  })
  if (!template) throw new Error("Onboarding template not found. Run npm run db:seed first.")

  const steps = template.steps as Array<{
    stepIndex: number
    title: string
    department: string
    slaHours: number
  }>

  const runId = "test-workflow-onboarding-demo"
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

  const run = await prisma.workflowRun.upsert({
    where: { id: runId },
    update: {
      title: "Employee Onboarding — Alex Chen",
      status: "active",
      targetPerson: {
        name: "Alex Chen",
        email: "alex.chen@company.com",
        department: "Engineering",
        startDate: "2026-06-10",
      },
    },
    create: {
      id: runId,
      workspaceId: workspace.id,
      templateId: template.id,
      title: "Employee Onboarding — Alex Chen",
      category: "ONBOARDING",
      status: "active",
      targetPerson: {
        name: "Alex Chen",
        email: "alex.chen@company.com",
        department: "Engineering",
        startDate: "2026-06-10",
      },
    },
  })

  // Remove old steps and recreate for idempotent seed
  await prisma.workflowStepRun.deleteMany({ where: { workflowRunId: run.id } })

  for (const step of steps) {
    let status: "PENDING" | "IN_PROGRESS" | "COMPLETED" = "PENDING"
    let completedAt: Date | null = null
    let createdAt = new Date()

    if (step.stepIndex <= 2) {
      status = "COMPLETED"
      completedAt = new Date()
    } else if (step.stepIndex === 3) {
      status = "IN_PROGRESS"
      createdAt = threeDaysAgo // overdue demo (SLA 24h)
    }

    await prisma.workflowStepRun.create({
      data: {
        workflowRunId: run.id,
        stepIndex: step.stepIndex,
        title: step.title,
        department: step.department,
        slaHours: step.slaHours,
        status,
        completedAt,
        createdAt,
      },
    })
  }

  console.log("✓ Test workflow run seeded")
  console.log("  Run ID:", run.id)
  console.log("  Title:", run.title)
  console.log("  Steps:", steps.length, "(2 completed, 1 in progress, 1 overdue)")
  console.log("")
  console.log("Open: http://localhost:3000/workflow/runs/test-workflow-onboarding-demo")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
