import { useTranslations } from "use-intl";
import { UserRound, Users, Crown } from "lucide-react";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import type { DefenseFaction } from "../../defense-team-validation";
import styles from "./DefenseMemberSlot.module.css";
import { DefenseFactionIcon } from "./DefenseFactionIcon";

export type DefenseMember = {
  name: string;
  isHost: boolean;
  isMe: boolean;
  favoriteFactions: DefenseFaction[];
};
export function DefenseMemberSlot({
  member,
  index,
  compact = false,
}: {
  member?: DefenseMember;
  index: number;
  compact?: boolean;
}) {
  const t = useTranslations("DefenseTeam");
  const factions = member?.favoriteFactions ?? [];
  const shown = compact ? factions.slice(0, 2) : factions;
  return (
    <Card
      className={`${styles.slot} ${compact ? styles.compact : ""}`}
      data-filled={!!member}
    >
      <div className={styles.meta}>
        <span>P{index + 1}</span>
        {member?.isHost ? (
          <span title={t("host")}>
            <Crown size={12} />
          </span>
        ) : null}
      </div>
      <div className={styles.avatar}>
        {member ? <UserRound size={22} /> : <Users size={22} />}
      </div>
      <div className={styles.name} title={member?.name}>
        {member?.name ?? t("vacant")}
        {member?.isMe ? (
          <Badge variant="secondary" className={styles.me}>
            {t("me")}
          </Badge>
        ) : null}
      </div>
      {member ? (
        <div className={styles.factions} aria-label={t("favoriteFactions")}>
          {shown.length ? (
            shown.map((faction) => (
              <Badge key={faction} variant="outline" className={styles.faction}>
                <DefenseFactionIcon
                  faction={faction}
                  className={styles.factionImage}
                />
                {t(`faction_${faction}`)}
              </Badge>
            ))
          ) : (
            <span className={styles.muted}>{t("noFactions")}</span>
          )}
          {compact && factions.length > 2 ? (
            <span className={styles.muted}>+{factions.length - 2}</span>
          ) : null}
        </div>
      ) : (
        <span className={styles.muted}>{t("openSlot")}</span>
      )}
    </Card>
  );
}
