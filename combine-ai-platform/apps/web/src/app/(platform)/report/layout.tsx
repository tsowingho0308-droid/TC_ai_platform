import { ReportPathTracker } from "@/features/report/components/report-path-tracker"

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return <ReportPathTracker>{children}</ReportPathTracker>
}
