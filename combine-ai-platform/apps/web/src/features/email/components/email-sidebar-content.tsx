"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import {
  Inbox,
  Star,
  Send,
  File,
  Archive,
  Trash2,
  PencilLine,
  type LucideIcon,
} from "lucide-react"

interface FolderItem {
  id: string
  name: string
  icon: LucideIcon
  count: number
}

const DEFAULT_FOLDERS: FolderItem[] = [
  { id: "inbox", name: "Inbox", icon: Inbox, count: 0 },
  { id: "starred", name: "Starred", icon: Star, count: 0 },
  { id: "sent", name: "Sent", icon: Send, count: 0 },
  { id: "drafts", name: "Drafts", icon: File, count: 0 },
  { id: "archive", name: "Archive", icon: Archive, count: 0 },
  { id: "trash", name: "Trash", icon: Trash2, count: 0 },
]

interface Department {
  id: string
  name: string
  slug: string
  color: string
}

export function EmailSidebarContent() {
  const pathname = usePathname()
  const [folders, setFolders] = useState(DEFAULT_FOLDERS)
  const [departments, setDepartments] = useState<Department[]>([])

  useEffect(() => {
    // Fetch folder counts and departments from the API
    fetch("/api/email/folders")
      .then((r) => r.json())
      .then((data) => {
        if (data.folders) {
          setFolders(
            DEFAULT_FOLDERS.map((f) => {
              const apiFolder = data.folders.find((af: { id: string }) => af.id === f.id)
              return { ...f, count: apiFolder?.count ?? f.count }
            })
          )
        }
      })
      .catch(() => {})

    fetch("/api/email/inboxes?kind=department")
      .then((r) => r.json())
      .then((data) => {
        if (data.inboxes) {
          const colors = ["bg-blue-500", "bg-green-500", "bg-orange-500", "bg-purple-500", "bg-red-500"]
          setDepartments(
            data.inboxes.map((inbox: { id: string; name: string; slug: string }, i: number) => ({
              id: inbox.id,
              name: inbox.name,
              slug: inbox.slug,
              color: colors[i % colors.length],
            }))
          )
        }
      })
      .catch(() => {
        // Fallback departments for demo
        setDepartments([
          { id: "dept-it", name: "IT Support", slug: "it-support", color: "bg-blue-500" },
          { id: "dept-hr", name: "Human Resources", slug: "hr", color: "bg-green-500" },
          { id: "dept-commercial", name: "Commercial", slug: "commercial", color: "bg-orange-500" },
        ])
      })
  }, [])

  return (
    <div className="px-2">
      {/* Compose button */}
      <Link
        href="/email/compose"
        className="mb-3 flex w-full items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <PencilLine className="h-4 w-4" />
        Compose
      </Link>

      {/* Folders */}
      <div className="mb-4">
        <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Folders
        </h3>
        <nav className="space-y-0.5">
          {folders.map((folder) => {
            const isActive =
              folder.id === "inbox"
                ? !pathname.includes("/starred") &&
                  !pathname.includes("/sent") &&
                  !pathname.includes("/drafts") &&
                  !pathname.includes("/archive") &&
                  !pathname.includes("/trash")
                : pathname.includes(`/${folder.id}`)
            return (
              <Link
                key={folder.id}
                href={`/email${folder.id === "inbox" ? "" : `?folder=${folder.id}`}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <folder.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{folder.name}</span>
                {folder.count > 0 && (
                  <span className={cn(
                    "rounded-full px-1.5 text-xs",
                    isActive ? "bg-sidebar-primary/20" : "bg-muted"
                  )}>
                    {folder.count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Departments */}
      {departments.length > 0 && (
        <div>
          <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Departments
          </h3>
          <nav className="space-y-0.5">
            {departments.map((dept) => (
              <Link
                key={dept.id}
                href={`/email?department=${dept.slug}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <div className={cn("h-2 w-2 shrink-0 rounded-full", dept.color)} />
                <span>{dept.name}</span>
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  )
}
