"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { DocumentList } from "./document-list"
import { UploadDropzone } from "./upload-dropzone"
import { SearchBar } from "./search-bar"
import { DocumentDetailPanel } from "./document-detail-panel"
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  searchDocuments,
  type ContextDocument,
  type SearchResult,
} from "../api/context-client"
import { toast } from "sonner"

export function ContextPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [documents, setDocuments] = useState<ContextDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  // Filters
  const [selectedDepartment, setSelectedDepartment] = useState<string>(
    searchParams.get("department") || ""
  )
  const [searchQuery, setSearchQuery] = useState("")

  // Selected document for detail panel
  const [selectedDoc, setSelectedDoc] = useState<ContextDocument | null>(null)

  // Upload modal
  const [showUpload, setShowUpload] = useState(searchParams.get("upload") === "true")

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    try {
      setError(null)
      setLoading(true)
      const result = await listDocuments({
        department: selectedDepartment || undefined,
        search: debouncedQuery || undefined,
        limit: 50,
      })
      setDocuments(result.documents)
      setTotal(result.total)
    } catch (err) {
      console.error("Failed to fetch documents:", err)
      setError("Failed to load documents")
    } finally {
      setLoading(false)
    }
  }, [selectedDepartment, debouncedQuery])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  // Reload on custom event
  useEffect(() => {
    const handler = () => fetchDocuments()
    window.addEventListener("context:data-updated", handler)
    return () => window.removeEventListener("context:data-updated", handler)
  }, [fetchDocuments])

  // Handle upload completion
  const handleUploadComplete = useCallback(
    (doc: ContextDocument) => {
      setShowUpload(false)
      window.dispatchEvent(new Event("context:data-updated"))
      toast.success(`Document "${doc.title}" uploaded successfully`)
    },
    []
  )

  // Handle upload error
  const handleUploadError = useCallback((err: Error) => {
    toast.error(`Upload failed: ${err.message}`)
  }, [])

  // Handle document selection
  const handleSelectDocument = useCallback((doc: ContextDocument) => {
    setSelectedDoc(doc)
    router.push(`/context?document=${doc.id}`, { scroll: false })
  }, [router])

  // Handle document deletion
  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await deleteDocument(id)
      setSelectedDoc(null)
      window.dispatchEvent(new Event("context:data-updated"))
      toast.success("Document deleted")
    } catch (err) {
      console.error("Failed to delete document:", err)
      toast.error("Failed to delete document")
    }
  }, [])

  // Handle search
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchQuery("")
      setSearchResults([])
      return
    }
    setSearchQuery(q)
    setSearching(true)
    try {
      const result = await searchDocuments(q, selectedDepartment || undefined, 10)
      setSearchResults(result.results)
    } catch {
      // Fallback to keyword search in document list
    } finally {
      setSearching(false)
    }
  }, [selectedDepartment])

  const departments = [
    { value: "", label: "All Departments" },
    { value: "HR", label: "HR" },
    { value: "IT", label: "IT" },
    { value: "ADMIN", label: "Admin" },
    { value: "FINANCE", label: "Finance" },
    { value: "GENERAL", label: "General" },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Context Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage knowledge bases, documents, and semantic search
            </p>
          </div>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload Document
          </button>
        </div>

        {/* Search + Filters */}
        <div className="mt-4 flex items-center gap-4">
          <SearchBar
            value={searchQuery}
            onChange={handleSearch}
            results={searchResults}
            searching={searching}
            onSelectResult={(result) => {
              const doc = documents.find((d) => d.id === result.articleId)
              if (doc) handleSelectDocument(doc)
            }}
          />
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">
            {total} document{total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Upload Dropzone */}
      {showUpload && (
        <div className="border-b px-6 py-4">
          <UploadDropzone
            onUploadComplete={handleUploadComplete}
            onError={handleUploadError}
          />
        </div>
      )}

      {/* Document List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <DocumentList
          documents={documents}
          loading={loading}
          error={error}
          onRetry={fetchDocuments}
          onSelect={handleSelectDocument}
          onDelete={handleDeleteDocument}
          selectedId={selectedDoc?.id}
        />
      </div>

      {/* Detail Panel */}
      {selectedDoc && (
        <DocumentDetailPanel
          document={selectedDoc}
          onClose={() => {
            setSelectedDoc(null)
            router.push("/context", { scroll: false })
          }}
          onDelete={() => handleDeleteDocument(selectedDoc.id)}
        />
      )}
    </div>
  )
}
