import { SchedulePoster } from "./SchedulePoster";
import type { SchedulePosterDocument } from "@/schedule-poster-document";
import "./poster-fonts.css";
import "./schedule-poster.css";

export default function GalleryPreview({ document }: { document: SchedulePosterDocument }) {
  // The existing poster is interactive in the editor; this is a read-only preview.
  return <div inert className="pointer-events-none min-w-0 overflow-hidden" aria-hidden="true">
    <SchedulePoster document={document} result={null} background={null} share={null} onSelect={() => {}} />
  </div>;
}
