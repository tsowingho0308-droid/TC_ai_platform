export function parseSseRecord(
  raw: string
): { event: string; data: Record<string, unknown> | null } {
  const lines = raw.split(/\r?\n/)
  let eventType = "message"
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return { event: eventType, data: null }
  try {
    return { event: eventType, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> }
  } catch {
    return { event: eventType, data: null }
  }
}

export async function readAgentSseStream(
  response: Response,
  onRecord: (event: string, data: Record<string, unknown> | null) => void
): Promise<void> {
  if (!response.body) throw new Error("Response body is not available")

  const bodyReader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await bodyReader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })

    let boundary = buffer.indexOf("\n\n")
    while (boundary >= 0) {
      const record = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)
      if (record) {
        const { event, data } = parseSseRecord(record)
        onRecord(event, data)
      }
      boundary = buffer.indexOf("\n\n")
    }

    if (done) break
  }

  const remaining = buffer.trim()
  if (remaining) {
    const { event, data } = parseSseRecord(remaining)
    onRecord(event, data)
  }
}
