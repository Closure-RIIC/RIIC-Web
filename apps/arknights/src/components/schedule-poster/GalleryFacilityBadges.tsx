import { Factory, Warehouse, Zap } from "lucide-react";
import { useLocale } from "use-intl";
import { posterProduct, posterRoomTitle } from "@/schedule-poster-model";
import type { SchedulePosterDocument } from "@/schedule-poster-document";

const colors = {
  originium: "border-red-500/50 bg-red-500/20 text-red-700 dark:text-red-300",
  gold: "border-orange-500/50 bg-orange-500/20 text-orange-700 dark:text-orange-300",
  lmd: "border-blue-500/50 bg-blue-500/20 text-blue-700 dark:text-blue-300",
  battle_record: "border-yellow-500/50 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  power: "border-green-500/50 bg-green-500/20 text-green-700 dark:text-green-300",
  other: "border-border bg-card text-muted-foreground",
};
const backgrounds = { originium: "bg-red-500/30", gold: "bg-orange-500/30", lmd: "bg-blue-500/30", battle_record: "bg-yellow-500/30", power: "bg-green-500/30", other: "bg-muted" };
type Tone = keyof typeof colors;

export function GalleryFacilityBadges({ document: doc }: { document: SchedulePosterDocument }) {
  const locale = useLocale();
  return <div className="flex flex-wrap justify-end gap-1.5">{doc.layout.rooms.filter(room => ["trade_post", "factory", "power_plant"].includes(room.kind)).map(room => {
    const products = doc.draft.shifts.map((_, index) => posterProduct(doc, room, index, locale));
    const tones: Tone[] = [...new Set(products.map(product => room.kind === "power_plant" ? "power" : product?.value === "originium" ? "originium" : product?.value === "gold" ? (room.kind === "trade_post" ? "lmd" : "gold") : product?.value === "battle_record" ? "battle_record" : "other"))];
    const label = [posterRoomTitle(room, doc.layout, locale), ...new Set(products.flatMap(product => product ? [product.label] : []))].join(" · ");
    return <span key={room.id} role="img" aria-label={label} title={label} data-facility-room={room.id} data-facility-tone={tones.join(",")} className={`relative flex size-7 items-center justify-center overflow-hidden rounded border ${tones.length === 1 ? colors[tones[0]!] : "border-border text-foreground"}`}>
      {tones.length > 1 && <span aria-hidden="true" className="absolute inset-0 flex">{tones.map(tone => <span key={tone} className={`flex-1 ${backgrounds[tone]}`} />)}</span>}
      {room.kind === "trade_post" ? <Warehouse aria-hidden="true" className="relative size-3.5" /> : room.kind === "factory" ? <Factory aria-hidden="true" className="relative size-3.5" /> : <Zap aria-hidden="true" className="relative size-3.5" />}
    </span>;
  })}</div>;
}
