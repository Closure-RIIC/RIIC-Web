import { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, Hexagon, Triangle } from "lucide-react";
import { gameHref, type GameId } from "./games";
import styles from "./GameSwitcher.module.css";

export function GameSwitcher({ game, locale = "zh", targetOrigin }: { game: GameId; locale?: string; targetOrigin?: string }) {
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  const names = locale === "en" ? { arknights: "Arknights", endfield: "Endfield" } : { arknights: "明日方舟", endfield: "终末地" };
  const Icon = game === "arknights" ? Triangle : Hexagon;
  return <Menu.Root>
    <Menu.Trigger className={styles.trigger} aria-label={locale === "en" ? `Switch game: ${names[game]}` : `切换游戏：${names[game]}`} data-game-switcher>
      <Icon aria-hidden="true" /><span>{names[game]}</span><ChevronsUpDown aria-hidden="true" className={styles.chevron} />
    </Menu.Trigger>
    <Menu.Portal><Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className={styles.positioner}>
      <Menu.Popup className={styles.popup}>
        {(["arknights"] as const).map(id => <Menu.LinkItem key={id} className={styles.item}
          render={<a href={gameHref(id, origin, id === game ? undefined : targetOrigin)} aria-current={id === game ? "true" : undefined} />}
          onClick={event => { if (id === game) event.preventDefault(); }}>
          {id === "arknights" ? <Triangle aria-hidden="true" /> : <Hexagon aria-hidden="true" />}
          <span>{names[id]}</span>{id === game ? <Check aria-hidden="true" /> : null}
        </Menu.LinkItem>)}
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
