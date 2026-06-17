"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import {
  Mail,
  FileSpreadsheet,
  FileText,
  Receipt,
  MessageCircleQuestion,
  GitBranch,
  LayoutDashboard,
  BookOpen,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react"
import { useAuth } from "@/features/auth/auth-context"
import { useEffect, useState } from "react"
import { EmailSidebarContent } from "@/features/email/components/email-sidebar-content"
import { ReportSidebarContent } from "@/features/report/components/report-sidebar-content"
import { TenderSidebarContent } from "@/features/tender/components/tender-sidebar-content"
import { FinanceSidebarContent } from "@/features/finance/components/finance-sidebar-content"
import { HelpdeskSidebarContent } from "@/features/helpdesk/components/helpdesk-sidebar-content"
import { WorkflowSidebarContent } from "@/features/workflow/components/workflow-sidebar-content"
import { ContextSidebarContent } from "@/features/context/components/context-sidebar-content"
import { getReportAgentHref } from "@/features/report/lib/report-workspace-store"

interface AgentNavItem {
  slug: string
  name: string
  nameZh: string
  icon: LucideIcon
  href: string
}

const AGENTS: AgentNavItem[] = [
  { slug: "email", name: "Email Agent", nameZh: "電郵代理", icon: Mail, href: "/email" },
  { slug: "report", name: "Report Agent", nameZh: "報告代理", icon: FileSpreadsheet, href: "/report" },
  { slug: "tender", name: "Tender Agent", nameZh: "標書代理", icon: FileText, href: "/tender" },
  { slug: "finance", name: "Finance Agent", nameZh: "財務代理", icon: Receipt, href: "/finance" },
  { slug: "helpdesk", name: "Helpdesk Agent", nameZh: "知識問答代理", icon: MessageCircleQuestion, href: "/helpdesk" },
  { slug: "workflow", name: "Workflow Agent", nameZh: "流程管理代理", icon: GitBranch, href: "/workflow" },
  { slug: "context", name: "Context", nameZh: "知識庫管理", icon: BookOpen, href: "/context" },
]

function getActiveAgent(pathname: string): string | null {
  for (const agent of AGENTS) {
    if (pathname.startsWith(agent.href)) return agent.slug
  }
  return null
}

export function AppSidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const activeAgent = getActiveAgent(pathname)

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-sidebar transition-all duration-200",
        collapsed ? "w-14" : "w-64"
      )}
    >
      {/* ── Header ────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <LayoutDashboard className="h-5 w-5 text-sidebar-primary" />
            <span className="text-sm">Combine AI</span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "rounded-md p-1.5 hover:bg-sidebar-accent",
            collapsed && "mx-auto"
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft
            className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
          />
        </button>
      </div>

      {/* ── Agent Switcher (always visible) ────────── */}
      <div className="px-2 py-3">
        {!collapsed && (
          <h3 className="mb-2 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Agents
          </h3>
        )}
        <nav className="space-y-1">
          {AGENTS.map((agent) => {
            const isActive = agent.slug === activeAgent
            const href = agent.slug === "report" ? getReportAgentHref() : agent.href
            return (
              <Link
                key={agent.slug}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
                title={collapsed ? `${agent.name} (${agent.nameZh})` : undefined}
              >
                <agent.icon className="h-5 w-5 shrink-0" />
                {!collapsed && (
                  <div className="flex flex-col">
                    <span>{agent.name}</span>
                    <span className="text-xs opacity-70">{agent.nameZh}</span>
                  </div>
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* ── Separator ─────────────────────────────── */}
      <div className="mx-3 border-t border-sidebar-border" />

      {/* ── Context Section (changes per agent) ────── */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto py-2">
          {activeAgent === "email" && <EmailSidebarContent />}
          {activeAgent === "report" && <ReportSidebarContent />}
          {activeAgent === "tender" && <TenderSidebarContent />}
          {activeAgent === "finance" && <FinanceSidebarContent />}
          {activeAgent === "helpdesk" && <HelpdeskSidebarContent />}
          {activeAgent === "workflow" && <WorkflowSidebarContent />}
          {activeAgent === "context" && <ContextSidebarContent />}
          {!activeAgent && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Select an agent to get started
            </div>
          )}
        </div>
      )}

      {/* ── User Footer (always visible) ──────────── */}
      <div className="shrink-0 border-t p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-medium text-sidebar-primary-foreground">
            {user?.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 truncate">
                <p className="truncate text-sm font-medium">{user?.name || "User"}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <button
                onClick={logout}
                className="rounded-md p-1.5 hover:bg-sidebar-accent"
                title="Logout"
              >
                <svg className="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
