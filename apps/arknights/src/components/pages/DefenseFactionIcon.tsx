import type { DefenseFaction } from "../../defense-team-validation";

const icons: Record<DefenseFaction, string> = {
  aegir: "egirShip.png",
  kazimierz: "kazimierzShip.png",
  laterano: "lateranoShip.png",
  sargon: "sargonShip.png",
  victoria: "victoriaShip.png",
  kjerag: "kjeragShip.png",
  siracusa: "siracusaShip.png",
  yan: "yanShip.png",
  harmony: "maniShip.png",
  precision: "preciShip.png",
  swift: "swiftShip.png",
  dexterity: "skillfulShip.png",
  arcane: "arcaneShip.png",
  steadfast: "steadShip.png",
  support: "deputShip.png",
  foresight: "visiShip.png",
  miracle: "miraShip.png",
  investor: "investShip.png",
  assault: "raidShip.png",
  unyielding: "indomShip.png",
  assistant: "emptyShip.png",
  solo: "soloShip.png",
  technique: "suntShip.png",
};

export function DefenseFactionIcon({
  faction,
  className,
}: {
  faction: DefenseFaction;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={`/images/defense-reference/bonds/${icons[faction]}`}
      width={32}
      height={32}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}
