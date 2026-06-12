import {
  AlignmentType,
  Document,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx"

function parseReportBody(bodyText: string): Paragraph[] {
  const lines = bodyText.split(/\r?\n/)
  const paragraphs: Paragraph[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(4),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
        })
      )
      continue
    }

    if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(3),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 140 },
        })
      )
      continue
    }

    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(2),
          heading: HeadingLevel.TITLE,
          spacing: { after: 200 },
        })
      )
      continue
    }

    if (line.startsWith("- ") || line.startsWith("• ")) {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(line.replace(/^[-•]\s*/, ""))],
          spacing: { after: 80 },
        })
      )
      continue
    }

    if (line.startsWith(">")) continue

    paragraphs.push(
      new Paragraph({
        children: [new TextRun(line.replace(/\*\*/g, ""))],
        spacing: { after: 120 },
      })
    )
  }

  return paragraphs
}

export async function buildReportDocx(params: {
  title: string
  bodyText: string
  companyName?: string
}): Promise<Buffer> {
  const { title, bodyText, companyName = "內部報告" } = params
  const bodyParagraphs = parseReportBody(bodyText)

  const doc = new Document({
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: companyName, size: 20, color: "666666" }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 360 },
          }),
          ...bodyParagraphs,
        ],
      },
    ],
  })

  return Packer.toBuffer(doc)
}
