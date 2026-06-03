"use client"

import { useState, useCallback, useRef } from "react"
import { cn } from "@combine-ai/shared-ui"
import { Upload, FileText, Loader2, CheckCircle } from "lucide-react"
import { uploadDocument, listKnowledgeBases, type ContextDocument, type KnowledgeBase } from "../api/context-client"
import { useEffect } from "react"

interface UploadDropzoneProps {
  onUploadComplete: (doc: ContextDocument) => void
  onError: (err: Error) => void
}

type UploadState = "idle" | "dragging" | "uploading" | "success" | "error"

export function UploadDropzone({ onUploadComplete, onError }: UploadDropzoneProps) {
  const [state, setState] = useState<UploadState>("idle")
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedKb, setSelectedKb] = useState("")
  const [title, setTitle] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch knowledge bases for selection
  useEffect(() => {
    listKnowledgeBases()
      .then((data) => {
        setKnowledgeBases(data.knowledgeBases)
        if (data.knowledgeBases.length > 0) {
          setSelectedKb(data.knowledgeBases[0].id)
        }
      })
      .catch(console.error)
  }, [])

  const handleFileSelect = useCallback((selectedFile: File) => {
    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ]

    const allowedExtensions = [".pdf", ".docx", ".doc", ".txt", ".csv", ".xlsx", ".xls"]
    const ext = "." + selectedFile.name.split(".").pop()?.toLowerCase()

    if (!allowedTypes.includes(selectedFile.type) && !allowedExtensions.includes(ext)) {
      setState("error")
      setErrorMsg("Unsupported file type. Please upload PDF, DOCX, TXT, CSV, or XLSX files.")
      onError(new Error("Unsupported file type"))
      return
    }

    setFile(selectedFile)
    setTitle(selectedFile.name.replace(/\.[^.]+$/, ""))
    setState("idle")
    setErrorMsg("")
  }, [onError])

  const handleUpload = useCallback(async () => {
    if (!file || !selectedKb) return

    setState("uploading")
    setProgress(10)

    try {
      setProgress(30)
      const result = await uploadDocument(file, selectedKb, title || undefined)
      setProgress(100)
      setState("success")

      setTimeout(() => {
        onUploadComplete(result.document)
      }, 500)
    } catch (err) {
      setState("error")
      const msg = err instanceof Error ? err.message : "Upload failed"
      setErrorMsg(msg)
      onError(err instanceof Error ? err : new Error(msg))
    }
  }, [file, selectedKb, title, onUploadComplete, onError])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) handleFileSelect(droppedFile)
    setState("idle")
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setState("dragging")
  }, [])

  const handleDragLeave = useCallback(() => {
    setState((prev) => (prev === "dragging" ? "idle" : prev))
  }, [])

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
          state === "dragging" && "border-primary bg-primary/5",
          state === "error" && "border-destructive bg-destructive/5",
          state === "uploading" && "border-muted bg-muted/10 pointer-events-none",
          state === "success" && "border-green-500 bg-green-50",
          state === "idle" && "border-muted-foreground/25 hover:border-primary/50"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.doc,.txt,.csv,.xlsx,.xls"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFileSelect(f)
          }}
        />

        {state === "idle" && !file && (
          <>
            <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drag & drop a file here, or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Supports PDF, DOCX, TXT, CSV, XLSX (max 10MB)
            </p>
          </>
        )}

        {state === "dragging" && (
          <>
            <Upload className="mb-2 h-8 w-8 text-primary" />
            <p className="text-sm font-medium text-primary">Drop file to upload</p>
          </>
        )}

        {state === "uploading" && (
          <>
            <Loader2 className="mb-2 h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Processing document...</p>
            <div className="mt-2 h-2 w-48 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Extracting text, chunking, and generating embeddings...
            </p>
          </>
        )}

        {state === "success" && (
          <>
            <CheckCircle className="mb-2 h-8 w-8 text-green-500" />
            <p className="text-sm font-medium text-green-700">Document uploaded!</p>
          </>
        )}

        {state === "error" && (
          <>
            <svg className="mb-2 h-8 w-8 text-destructive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <p className="text-sm font-medium text-destructive">{errorMsg}</p>
            <p className="mt-1 text-xs text-muted-foreground">Click to try again</p>
          </>
        )}
      </div>

      {/* Selected File Info + Options */}
      {file && state !== "uploading" && state !== "success" && (
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border px-2 py-1 text-sm font-medium"
              placeholder="Document title"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <select
            value={selectedKb}
            onChange={(e) => setSelectedKb(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name} ({kb.department})
              </option>
            ))}
          </select>
          <button
            onClick={handleUpload}
            disabled={!file || !selectedKb}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Upload
          </button>
        </div>
      )}
    </div>
  )
}
