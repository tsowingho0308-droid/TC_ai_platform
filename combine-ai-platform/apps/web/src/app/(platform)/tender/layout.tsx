import { TenderPathTracker } from "@/features/tender/components/tender-path-tracker"

export default function TenderLayout({ children }: { children: React.ReactNode }) {
  return <TenderPathTracker>{children}</TenderPathTracker>
}
