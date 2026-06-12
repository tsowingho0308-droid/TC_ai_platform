export const FINANCE_NO_RECEIPT_MESSAGE =
  "No receipt or invoice was found in this file. The document does not contain scannable receipt data — try a clearer image or a different file."

export type FinanceExtractionErrorKind = "no_receipt" | "failed"

export class FinanceExtractionError extends Error {
  readonly kind: FinanceExtractionErrorKind

  constructor(message: string, kind: FinanceExtractionErrorKind = "failed") {
    super(message)
    this.name = "FinanceExtractionError"
    this.kind = kind
  }
}

export function isFinanceNoReceiptError(error: unknown): boolean {
  return error instanceof FinanceExtractionError && error.kind === "no_receipt"
}
