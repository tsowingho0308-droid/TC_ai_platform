import {
  dispatchFinanceAnalysisUpdated,
  FINANCE_ANALYSIS_COMPLETE,
  FINANCE_ANALYSIS_FAILED,
  FINANCE_ANALYSIS_STARTED,
  registerPendingFinanceAnalysis,
  removePendingFinanceAnalysis,
  setActiveFinanceSessionId,
  type FinanceAnalysisCompleteDetail,
  type FinanceAnalysisFailedDetail,
} from "@/features/finance/finance-analysis-tracker"
import { normalizeExtractedRows } from "@/features/finance/extracted-rows"
import {
  FINANCE_NO_RECEIPT_MESSAGE,
  FinanceExtractionError,
} from "@/features/finance/extraction-messages"

export interface RunFinanceExtractParams {
  sessionId: string
  fileBase64: string
  fileName: string
  appendRows?: boolean
  sourceLabel?: string
  docType?: string
  model?: string
}

export async function runFinanceBackgroundExtract(params: RunFinanceExtractParams) {
  registerPendingFinanceAnalysis({
    sessionId: params.sessionId,
    fileName: params.fileName,
    startedAt: new Date().toISOString(),
  })
  setActiveFinanceSessionId(params.sessionId)
  window.dispatchEvent(new Event(FINANCE_ANALYSIS_STARTED))

  try {
    const extractRes = await fetch("/api/finance/agent?action=extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: params.sessionId,
        fileBase64: params.fileBase64,
        fileName: params.fileName,
        appendRows: params.appendRows ?? false,
        sourceLabel: params.sourceLabel,
        docType: params.docType,
        model: params.model,
      }),
    })

    if (!extractRes.ok) {
      const errData = await extractRes.json().catch(() => ({})) as { error?: string; detail?: string }
      const message = errData.detail || errData.error || "Extraction failed"
      const kind =
        message === FINANCE_NO_RECEIPT_MESSAGE || /no receipt|invoice was found/i.test(message)
          ? "no_receipt"
          : "failed"
      removePendingFinanceAnalysis(params.sessionId)
      dispatchFinanceAnalysisUpdated()
      window.dispatchEvent(
        new CustomEvent<FinanceAnalysisFailedDetail>(FINANCE_ANALYSIS_FAILED, {
          detail: { sessionId: params.sessionId, error: message },
        })
      )
      throw new FinanceExtractionError(message, kind)
    }

    const data = await extractRes.json()
    const extractedRows = normalizeExtractedRows(data.sessionRows || data.rows)
    if (extractedRows.length === 0) {
      const message = FINANCE_NO_RECEIPT_MESSAGE
      removePendingFinanceAnalysis(params.sessionId)
      dispatchFinanceAnalysisUpdated()
      window.dispatchEvent(
        new CustomEvent<FinanceAnalysisFailedDetail>(FINANCE_ANALYSIS_FAILED, {
          detail: { sessionId: params.sessionId, error: message },
        })
      )
      throw new FinanceExtractionError(message, "no_receipt")
    }

    removePendingFinanceAnalysis(params.sessionId)
    dispatchFinanceAnalysisUpdated()
    window.dispatchEvent(
      new CustomEvent<FinanceAnalysisCompleteDetail>(FINANCE_ANALYSIS_COMPLETE, {
        detail: { sessionId: params.sessionId, rows: extractedRows },
      })
    )
    window.dispatchEvent(new Event("finance:sessions-updated"))

    return {
      rows: extractedRows,
      raw: data,
    }
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error("Extraction failed")
  }
}
