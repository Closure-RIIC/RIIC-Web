import type { AppBindingList, BuildingRoom, PlayerInfo, ResidentCharacter } from "skland-kit";

import { normalizeOperboxEntries } from "../../operbox-normalization.ts";
import type {
  OperBoxEntry,
  SklandControlRoom,
  SklandDormitoryRoom,
  SklandHireRoom,
  SklandInfrastructure,
  SklandInfrastructureGroup,
  SklandInfrastructureOperator,
  SklandInfrastructureRoomBase,
  SklandManufactureRoom,
  SklandMeetingRoom,
  SklandOperatorStatus,
  SklandOwnedSkin,
  SklandPowerRoom,
  SklandProcessingRoom,
  SklandProgress,
  SklandRole,
  SklandScheduleSnapshot,
  SklandStatusSnapshot,
  SklandTradingRoom,
  SklandTrainingPosition,
  SklandTrainingRoom,
} from "../../types.ts";

const MORALE_DIVISOR = 360_000;
const GOLD_ITEM_ID = "3003";
const ORIGINIUM_SHARD_ITEM_ID = "3141";
const BATTLE_RECORD_ITEM_IDS = new Set(["2001", "2002", "2003", "2004"]);
const CLUE_NAMES: Record<string, string> = {
  RHINE: "莱茵生命",
  PENGUIN: "企鹅物流",
  BLACKSTEEL: "黑钢国际",
  URSUS: "乌萨斯学生自治团",
  GLASGOW: "格拉斯哥帮",
  KJERAG: "喀兰贸易",
  RHODES: "罗德岛",
};

type FactoryProduct = SklandManufactureRoom["product"];

// Match the in-game manufacture labels after swapping 4↔2, then 1↔2.
// The first four upstream entries therefore map to displayed rooms as 3, 1, 4, 2.
export function manufacturesInGameOrder<T>(rooms: readonly T[]): T[] {
  if (rooms.length < 4) return [...rooms];
  return [rooms[2]!, rooms[0]!, rooms[3]!, rooms[1]!, ...rooms.slice(4)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegative(value: unknown): number {
  return Math.max(0, finiteNumber(value));
}

function optionalNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function recruitState(value: unknown): "locked" | "standby" | "recruiting" | "completed" {
  if (value === 1) return "standby";
  if (value === 2) return "recruiting";
  if (value === 3) return "completed";
  return "locked";
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function nameFor(info: PlayerInfo, charId: string | undefined): string | null {
  if (!charId) return null;
  return info.charInfoMap[charId]?.name?.trim() || null;
}

function normalizeResident(info: PlayerInfo, resident: ResidentCharacter): SklandInfrastructureOperator | null {
  const name = nameFor(info, resident.charId);
  if (!name) return null;
  return {
    id: resident.charId,
    name,
    morale: Math.round(clamp(finiteNumber(resident.ap) / MORALE_DIVISOR, 0, 24) * 10) / 10,
    workTime: nonNegative(resident.workTime),
    lastMoraleUpdateTs: nonNegative(resident.lastApAddTime),
  };
}

function normalizeTrainingResident(
  info: PlayerInfo,
  resident: { charId: string; ap: number; lastApAddTime: number },
  position: SklandTrainingPosition,
): SklandTrainingRoom["operators"][number] | null {
  const name = nameFor(info, resident.charId);
  if (!name) return null;
  return {
    id: resident.charId,
    name,
    morale: Math.round(clamp(finiteNumber(resident.ap) / MORALE_DIVISOR, 0, 24) * 10) / 10,
    lastMoraleUpdateTs: nonNegative(resident.lastApAddTime),
    position,
  };
}

function roomBase<TGroup extends SklandInfrastructureGroup>(
  info: PlayerInfo,
  group: TGroup,
  index: number,
  value: BuildingRoom
): SklandInfrastructureRoomBase<TGroup> {
  return {
    key: value.slotId || `${group}-${index + 1}`,
    group,
    index,
    level: nonNegative(value.level),
    operators: (value.chars ?? []).flatMap((resident) => {
      const normalized = normalizeResident(info, resident);
      return normalized ? [normalized] : [];
    }),
  };
}

export function rolesFromBinding(binding: AppBindingList): SklandRole[] {
  const game = binding.list.find((item) => item.appCode === "arknights");
  if (!game) return [];
  return game.bindingList
    .filter((item) => Boolean(item.uid) && !item.isDelete)
    .map((item) => ({
      uid: item.uid,
      nickname: item.nickName,
      channelName: item.channelName,
      isDefault: item.isDefault || item.uid === game.defaultUid,
    }));
}

export function operboxFromPlayerInfo(info: PlayerInfo): { operbox: OperBoxEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const operbox = info.chars.flatMap<OperBoxEntry>((character) => {
    if (seen.has(character.charId)) return [];
    seen.add(character.charId);
    const name = nameFor(info, character.charId);
    const elite = Number(character.evolvePhase);
    const level = Number(character.level);
    const potential = Number(character.potentialRank) + 1;
    const rarity = Number(info.charInfoMap[character.charId]?.rarity ?? character.rarity) + 1;
    if (
      !name
      || !Number.isInteger(elite)
      || elite < 0
      || elite > 2
      || !Number.isInteger(level)
      || level < 1
      || level > 90
      || !Number.isInteger(potential)
      || potential < 1
      || potential > 6
      || !Number.isInteger(rarity)
      || rarity < 1
      || rarity > 6
    ) {
      warnings.push(`干员 ${name || character.charId} 的森空岛练度字段不完整，已跳过。`);
      return [];
    }
    return [{ id: character.charId, name, elite, level, own: true, potential, rarity }];
  });
  return { operbox: normalizeOperboxEntries(operbox), warnings };
}

export function factoryProduct(info: PlayerInfo, formulaId: string | number): FactoryProduct {
  const formula = info.manufactureFormulaInfoMap[Number(formulaId)];
  const itemId = String(formula?.itemId ?? "");
  if (itemId === GOLD_ITEM_ID) return "gold";
  if (BATTLE_RECORD_ITEM_IDS.has(itemId)) return "battle_record";
  if (itemId === ORIGINIUM_SHARD_ITEM_ID) return "originium";
  return "unknown";
}

function infrastructureFromPlayerInfo(
  info: PlayerInfo,
  suggestion: Pick<SklandInfrastructure, "layoutLabel" | "layoutSuggestion" | "layoutWarning">
): SklandInfrastructure {
  const building = info.building;
  const control: SklandControlRoom = roomBase(info, "control", 0, building.control);
  const tradings: SklandTradingRoom[] = building.tradings.map((value, index) => ({
    ...roomBase(info, "trading", index, value),
    product: value.strategy === "O_DIAMOND" ? "originium" : "gold",
    production: {
      stock: value.stock.length,
      capacity: nonNegative(value.stockLimit),
      unitCapacity: null,
      completed: null,
      remaining: null,
      completeWorkTime: value.completeWorkTime || null,
    },
    orders: value.stock.map((order) => {
      const isOrundumOrder = order.type === "O_DIAMOND"
        || order.gain.type === "DIAMOND"
        || order.delivery.some((item) => item.type === "DIAMOND_SHD");
      return {
        delivery: order.delivery.map((item) => ({
          type: item.type === "DIAMOND_SHD" ? "originium_shard" as const : "material" as const,
          count: nonNegative(item.count),
        })),
        reward: {
          type: isOrundumOrder ? "orundum" as const : "lmd" as const,
          count: nonNegative(order.gain.count),
        },
      };
    }),
    lastUpdateTime: nonNegative(value.lastUpdateTime),
  }));
  const manufactures: SklandManufactureRoom[] = manufacturesInGameOrder(building.manufactures).map((value, index) => ({
    ...roomBase(info, "manufacture", index, value),
    product: factoryProduct(info, value.formulaId),
    production: {
      stock: nonNegative(value.weight),
      capacity: nonNegative(value.capacity),
      unitCapacity: (() => {
        const formulaWeight = nonNegative(info.manufactureFormulaInfoMap[Number(value.formulaId)]?.weight);
        return formulaWeight > 0 ? Math.floor(nonNegative(value.capacity) / formulaWeight) : null;
      })(),
      completed: nonNegative(value.complete),
      remaining: nonNegative(value.remain),
      completeWorkTime: value.completeWorkTime || null,
    },
    speed: nonNegative(value.speed),
    lastUpdateTime: nonNegative(value.lastUpdateTime),
  }));
  const powers: SklandPowerRoom[] = building.powers.map((value, index) => ({
    ...roomBase(info, "power", index, value),
  }));
  const dormitories: SklandDormitoryRoom[] = building.dormitories.map((value, index) => ({
    ...roomBase(info, "dormitory", index, value),
    comfort: nonNegative(value.comfort),
  }));
  const meeting: SklandMeetingRoom[] = building.meeting
    ? [{
        ...roomBase(info, "meeting", 0, building.meeting),
        clue: {
          board: building.meeting.clue.board.map((item) => CLUE_NAMES[item] ?? "未知线索"),
          own: nonNegative(building.meeting.clue.own),
          received: nonNegative(building.meeting.clue.received),
          dailyReward: Boolean(building.meeting.clue.dailyReward),
          needReceive: nonNegative(building.meeting.clue.needReceive),
          sharing: Boolean(building.meeting.clue.sharing),
          shareCompleteTime: nonNegative(building.meeting.clue.shareCompleteTime),
        },
        completeWorkTime: nonNegative(building.meeting.completeWorkTime),
        lastUpdateTime: nonNegative(building.meeting.lastUpdateTime),
      }]
    : [];
  const hire: SklandHireRoom[] = building.hire
    ? [{
        ...roomBase(info, "hire", 0, building.hire),
        refreshCount: nonNegative(building.hire.refreshCount),
        completeWorkTime: nonNegative(building.hire.completeWorkTime),
      }]
    : [];
  const trainingRoom = building.training;
  const trainingRooms: SklandTrainingRoom[] = trainingRoom
    ? [{
        key: trainingRoom.slotId || "training-1",
        group: "training",
        index: 0,
        level: nonNegative(trainingRoom.level),
        operators: [
          trainingRoom.trainee
            ? normalizeTrainingResident(info, trainingRoom.trainee, "trainee")
            : null,
          trainingRoom.trainer
            ? normalizeTrainingResident(info, trainingRoom.trainer, "trainer")
            : null,
        ].filter((operator): operator is SklandTrainingRoom["operators"][number] => operator !== null),
        occupancy: {
          current: Number(Boolean(trainingRoom.trainee)) + Number(Boolean(trainingRoom.trainer)),
          capacity: 2,
        },
      }]
    : [];
  const processingRooms: SklandProcessingRoom[] = suggestion.layoutSuggestion?.rooms
    .filter((room) => room.kind === "workshop")
    .map((room, index) => ({
      key: room.id || `processing-${index + 1}`,
      group: "processing",
      index,
      level: nonNegative(room.level),
      operators: [],
    })) ?? [];
  const hasTrainingTask = Boolean(
    trainingRoom?.trainee
    && finiteNumber(trainingRoom.trainee.targetSkill, -1) >= 0
    && finiteNumber(trainingRoom.remainPoint) > 0
    && finiteNumber(trainingRoom.remainSecs) > 0
  );
  const training = trainingRoom && hasTrainingTask
    ? {
        trainee: nameFor(info, trainingRoom.trainee?.charId),
        trainer: nameFor(info, trainingRoom.trainer?.charId),
        skillIndex: finiteNumber(trainingRoom.trainee?.targetSkill) + 1,
        remainSecs: nonNegative(trainingRoom.remainSecs),
        remainPoint: nonNegative(trainingRoom.remainPoint),
        speed: nonNegative(trainingRoom.speed),
        completeWorkTime: nonNegative(info.currentTs) + nonNegative(trainingRoom.remainSecs),
      }
    : null;
  return {
    currentTs: nonNegative(info.currentTs),
    storeTs: optionalNonNegative(info.status.storeTs),
    ...suggestion,
    rooms: [
      control,
      ...tradings,
      ...manufactures,
      ...powers,
      ...dormitories,
      ...meeting,
      ...hire,
      ...trainingRooms,
      ...processingRooms,
    ],
    tiredOperators: building.tiredChars.flatMap((value) => {
      const name = nameFor(info, value.charId);
      return name ? [name] : [];
    }),
    labor: {
      value: nonNegative(building.labor.value),
      maxValue: nonNegative(building.labor.maxValue),
      remainSecs: nonNegative(building.labor.remainSecs),
      lastUpdateTime: nonNegative(building.labor.lastUpdateTime),
    },
    furnitureTotal: nonNegative(building.furniture.total),
    training,
  };
}

function operatorsFromPlayerInfo(info: PlayerInfo): SklandOperatorStatus[] {
  const assists = new Set(info.assistChars.map((item) => item.charId));
  const seen = new Set<string>();
  return info.chars.flatMap((character) => {
    if (seen.has(character.charId)) return [];
    seen.add(character.charId);
    const metadata = info.charInfoMap[character.charId];
    const name = metadata?.name?.trim();
    if (!name) return [];
    return [{
      id: character.charId,
      name,
      rarity: clamp(finiteNumber(metadata.rarity ?? character.rarity) + 1, 1, 6),
      profession: metadata.profession || "UNKNOWN",
      subProfessionName: metadata.subProfessionName?.trim() || "未分类",
      elite: clamp(finiteNumber(character.evolvePhase), 0, 2),
      level: nonNegative(character.level),
      potential: clamp(finiteNumber(character.potentialRank) + 1, 1, 6),
      favorPercent: clamp(finiteNumber(character.favorPercent), 0, 200),
      mainSkillLevel: nonNegative(character.mainSkillLvl),
      skills: character.skills.map((skill, index) => ({
        index: index + 1,
        specializeLevel: clamp(finiteNumber(skill.specializeLevel), 0, 3),
      })),
      modules: character.equip.flatMap((module) => {
        const moduleInfo = info.equipmentInfoMap[module.id];
        if (!moduleInfo?.name?.trim()) return [];
        return [{
          id: module.id,
          name: moduleInfo.name.trim(),
          level: nonNegative(module.level),
          locked: Boolean(module.locked),
          isDefault: module.id === character.defaultEquipId,
        }];
      }),
      currentSkinName: info.skinInfoMap[character.skinId]?.name?.trim() || null,
      acquiredAt: nonNegative(character.gainTime),
      isAssist: assists.has(character.charId),
    }];
  });
}

function skinsFromPlayerInfo(info: PlayerInfo): SklandOwnedSkin[] {
  const currentSkinByOperator = new Map(info.chars.map((character) => [character.charId, character.skinId]));
  return info.skins.flatMap((skin) => {
    const metadata = info.skinInfoMap[skin.id];
    const operatorName = nameFor(info, metadata?.charId);
    if (!metadata?.name?.trim() || !operatorName) return [];
    return [{
      id: skin.id,
      name: metadata.name.trim(),
      brandId: metadata.brandId?.trim() || "未分类",
      operatorId: metadata.charId,
      operatorName,
      obtainedAt: nonNegative(skin.ts),
      isCurrent: currentSkinByOperator.get(metadata.charId) === skin.id,
    }];
  });
}

function progressFromPlayerInfo(info: PlayerInfo): SklandProgress {
  const recruit = Array.isArray(info.recruit)
    ? info.recruit.map((slot, index) => ({
        index,
        startTs: nonNegative(slot.startTs),
        finishTs: nonNegative(slot.finishTs),
        state: recruitState(slot.state),
      }))
    : null;
  const routine = info.routine?.daily && info.routine?.weekly
    ? {
        daily: {
          current: nonNegative(info.routine.daily.current),
          total: nonNegative(info.routine.daily.total),
        },
        weekly: {
          current: nonNegative(info.routine.weekly.current),
          total: nonNegative(info.routine.weekly.total),
        },
      }
    : null;
  const campaign = info.campaign?.reward && Array.isArray(info.campaign.records)
    ? {
        records: info.campaign.records.map((record) => {
          const metadata = info.campaignInfoMap?.[record.campaignId];
          const zone = metadata ? info.campaignZoneInfoMap?.[metadata.campaignZoneId] : undefined;
          return {
            name: metadata?.name?.trim() || "未知剿灭区域",
            zoneName: zone?.name?.trim() || null,
            maxKills: nonNegative(record.maxKills),
          };
        }),
        reward: {
          current: nonNegative(info.campaign.reward.current),
          total: nonNegative(info.campaign.reward.total),
        },
      }
    : null;
  const tower = info.tower?.reward && Array.isArray(info.tower.records)
    ? {
        records: info.tower.records.map((record) => {
          const metadata = info.towerInfoMap?.[record.towerId];
          return {
            name: metadata?.name?.trim() || "未知保全区域",
            subName: metadata?.subName?.trim() || "",
            best: nonNegative(record.best),
          };
        }),
        reward: {
          higher: {
            current: nonNegative(info.tower.reward.higherItem?.current),
            total: nonNegative(info.tower.reward.higherItem?.total),
          },
          lower: {
            current: nonNegative(info.tower.reward.lowerItem?.current),
            total: nonNegative(info.tower.reward.lowerItem?.total),
          },
          termTs: nonNegative(info.tower.reward.termTs),
        },
      }
    : null;
  const rogue = Array.isArray(info.rogue?.records)
    ? info.rogue.records.map((record) => ({
        name: info.rogueInfoMap?.[record.rogueId]?.name?.trim() || "未知集成战略主题",
        relicCount: nonNegative(record.relicCnt),
        bankCurrent: nonNegative(record.bank?.current),
        bankRecord: nonNegative(record.bank?.record),
      }))
    : null;
  const activities = Array.isArray(info.activity)
    ? info.activity.map((activity) => {
        const metadata = info.activityInfoMap?.[activity.actId] ?? info.activityInfoMap?.[activity.actReplicaId];
        const zones = Array.isArray(activity.zones) ? activity.zones : [];
        return {
          name: metadata?.name?.trim() || "未命名活动",
          startTime: nonNegative(metadata?.startTime),
          endTime: nonNegative(metadata?.endTime),
          rewardEndTime: nonNegative(metadata?.rewardEndTime),
          isReplicate: Boolean(metadata?.isReplicate),
          clearedStages: zones.reduce((total, zone) => total + nonNegative(zone.clearedStage), 0),
          totalStages: zones.reduce((total, zone) => total + nonNegative(zone.totalStage), 0),
        };
      })
    : null;
  const bossRush = Array.isArray(info.bossRush)
    ? info.bossRush.map((item) => {
        const stage = info.stageInfoMap?.[item.record.stageId];
        return {
          played: Boolean(item.record.played),
          stageCode: stage?.code?.trim() || null,
          stageName: stage?.name?.trim() || null,
          difficulty: item.record.difficulty?.trim() || "未知",
        };
      })
    : null;

  return {
    recruit,
    routine,
    campaign,
    tower,
    rogue,
    activities,
    bossRush,
  };
}

export function scheduleSnapshotFromPlayerInfo(
  info: PlayerInfo,
  roles: SklandRole[],
  suggestion: Pick<SklandInfrastructure, "layoutLabel" | "layoutSuggestion" | "layoutWarning">
): SklandScheduleSnapshot {
  const { operbox, warnings } = operboxFromPlayerInfo(info);
  const infrastructure = infrastructureFromPlayerInfo(info, suggestion);
  if (infrastructure.layoutWarning) warnings.push(infrastructure.layoutWarning);
  return {
    roles,
    operbox,
    infrastructure: scheduleInfrastructure(infrastructure),
    sourceName: "森空岛同步",
    warnings,
  };
}

function scheduleInfrastructure(infrastructure: SklandInfrastructure): SklandScheduleSnapshot["infrastructure"] {
  return {
    storeTs: infrastructure.storeTs,
    layoutLabel: infrastructure.layoutLabel,
    layoutSuggestion: infrastructure.layoutSuggestion,
    layoutWarning: infrastructure.layoutWarning,
    tiredOperators: [...infrastructure.tiredOperators],
    rooms: infrastructure.rooms
      .filter((room) => room.group !== "training" && room.group !== "processing")
      .map((room) => ({
        key: room.key,
        group: room.group,
        index: room.index,
        level: room.level,
        operators: room.operators.map((operator) => ({
          id: operator.id,
          name: operator.name,
          morale: operator.morale,
        })),
        ...("product" in room ? { product: room.product } : {}),
      })),
  };
}

export function scheduleSnapshotFromStatusSnapshot(snapshot: SklandStatusSnapshot): SklandScheduleSnapshot {
  return {
    roles: snapshot.roles,
    operbox: snapshot.operbox,
    infrastructure: scheduleInfrastructure(snapshot.infrastructure),
    sourceName: snapshot.sourceName,
    warnings: snapshot.warnings,
  };
}

export function snapshotFromPlayerInfo(
  info: PlayerInfo,
  roles: SklandRole[],
  selectedUid: string,
  suggestion: Pick<SklandInfrastructure, "layoutLabel" | "layoutSuggestion" | "layoutWarning">
): SklandStatusSnapshot {
  const role = roles.find((item) => item.uid === selectedUid) ?? roles[0];
  const { operbox, warnings } = operboxFromPlayerInfo(info);
  const infrastructure = infrastructureFromPlayerInfo(info, suggestion);
  if (infrastructure.layoutWarning) warnings.push(infrastructure.layoutWarning);
  const secretaryId = info.status.secretary?.charId;
  const secretaryName = nameFor(info, secretaryId);
  const secretary = secretaryId && secretaryName
    ? {
        id: secretaryId,
        name: secretaryName,
        skinName: info.skinInfoMap[info.status.secretary.skinId]?.name?.trim() || null,
      }
    : null;

  return {
    player: {
      uid: info.status.uid,
      nickname: info.status.name || role?.nickname || selectedUid,
      level: optionalNonNegative(info.status.level),
      channelName: role?.channelName ?? "未知渠道",
      avatarUrl: safeHttpsUrl(info.status.avatar?.url),
      registerTs: optionalNonNegative(info.status.registerTs),
      mainStageProgress: info.status.mainStageProgress?.trim() || null,
      resume: info.status.resume?.trim() || null,
      subscriptionEnd: optionalNonNegative(info.status.subscriptionEnd),
      storeTs: optionalNonNegative(info.status.storeTs),
      lastOnlineTs: optionalNonNegative(info.status.lastOnlineTs),
      sanity: info.status.ap
        ? {
            current: nonNegative(info.status.ap.current),
            max: nonNegative(info.status.ap.max),
            completeRecoveryTime: optionalNonNegative(info.status.ap.completeRecoveryTime),
          }
        : null,
      secretary,
      counts: {
        operators: optionalNonNegative(info.status.charCnt),
        furniture: optionalNonNegative(info.status.furnitureCnt),
        skins: optionalNonNegative(info.status.skinCnt),
      },
    },
    roles,
    operbox,
    infrastructure,
    operators: operatorsFromPlayerInfo(info),
    skins: skinsFromPlayerInfo(info),
    progress: progressFromPlayerInfo(info),
    sourceName: "森空岛同步",
    warnings,
  };
}

export function snapshotsFromPlayerInfo(
  info: PlayerInfo,
  roles: SklandRole[],
  selectedUid: string,
  suggestion: Pick<SklandInfrastructure, "layoutLabel" | "layoutSuggestion" | "layoutWarning">
): { scheduleSnapshot: SklandScheduleSnapshot; statusSnapshot: SklandStatusSnapshot } {
  const statusSnapshot = snapshotFromPlayerInfo(info, roles, selectedUid, suggestion);
  return {
    scheduleSnapshot: scheduleSnapshotFromStatusSnapshot(statusSnapshot),
    statusSnapshot,
  };
}
