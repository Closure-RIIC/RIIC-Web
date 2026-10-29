import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "./messages/zh-CN/Shell_GameSwitcher.json";
const uiText = createUiLocalizer<typeof UiMessages>("Shell_GameSwitcher");
import { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, Hexagon, Triangle } from "lucide-react";
import { gameHref, type GameId } from "./games";
import { localizedGameHref, type AppLocale } from "@riic/contracts/locale";
import styles from "./GameSwitcher.module.css";

export function GameSwitcher({ game, locale = "zh-CN", targetOrigin }: { game: GameId; locale?: AppLocale; targetOrigin?: string }) {
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  const names = { arknights: uiText.text(locale, "arknights"), endfield: uiText.text(locale, "endfield") };
  const Icon = game === "arknights" ? Triangle : Hexagon;
  return <Menu.Root>
    <Menu.Trigger className={styles.trigger} aria-label={uiText.text(locale, "switchGame", { value1: names[game] })} data-game-switcher>
      <Icon aria-hidden="true" /><span>{names[game]}</span><ChevronsUpDown aria-hidden="true" className={styles.chevron} />
    </Menu.Trigger>
    <Menu.Portal><Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className={styles.positioner}>
      <Menu.Popup className={styles.popup}>
        {(["arknights", "endfield"] as const).map(id => <Menu.LinkItem key={id} className={styles.item}
          render={<a href={localizedGameHref(gameHref(id, origin, id === game ? undefined : targetOrigin), locale)} aria-current={id === game ? "true" : undefined} />}
          onClick={event => { if (id === game) event.preventDefault(); }}>
          {id === "arknights" ? <Triangle aria-hidden="true" /> : <Hexagon aria-hidden="true" />}
          <span>{names[id]}</span>{id === game ? <Check aria-hidden="true" /> : null}
        </Menu.LinkItem>)}
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
