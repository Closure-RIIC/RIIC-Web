import assert from "node:assert/strict";
import test from "node:test";

import type { AppBindingList, PlayerInfo } from "skland-kit";

import { successResponse } from "../api-contract.ts";
import {
  rolesFromBinding,
  scheduleSnapshotFromPlayerInfo,
  snapshotFromPlayerInfo,
  snapshotsFromPlayerInfo,
} from "./normalize.ts";

const RESIDENT = {
  charId: "char_1",
  ap: 7_200_000,
  lastApAddTime: 1_700_000_050,
  index: 0,
  workTime: 7_200,
  bubble: {
    normal: { add: 1, ts: 1_700_000_010 },
    assist: { add: 0, ts: 1_700_000_020 },
  },
};

function baseRoom(slotId: string, level = 3) {
  return { slotId, chars: [RESIDENT], level };
}

function playerInfo(avatarUrl = "https://example.com/avatar.png", formulaItemId = "3003"): PlayerInfo {
  return {
    showConfig: { charSwitch: true, skinSwitch: true, standingsSwitch: true },
    currentTs: 1_700_000_100,
    status: {
      uid: "123456789",
      name: "博士",
      level: 120,
      avatar: { type: "ICON", id: "avatar", url: avatarUrl },
      registerTs: 1_600_000_000,
      mainStageProgress: "14-21",
      secretary: { charId: "char_1", skinId: "skin_1" },
      resume: "<b>纯文本简介</b>",
      subscriptionEnd: 1_800_000_000,
      ap: {
        current: 102,
        max: 135,
        lastApAddTime: 1_700_000_000,
        completeRecoveryTime: 1_700_010_000,
      },
      storeTs: 1_700_000_090,
      lastOnlineTs: 1_700_000_080,
      charCnt: 1,
      furnitureCnt: 200,
      skinCnt: 1,
    },
    assistChars: [{
      charId: "char_1",
      skinId: "skin_1",
      level: 90,
      evolvePhase: 2,
      potentialRank: 5,
      mainSkillLvl: 7,
      equip: { id: "uniequip_1", level: 3, locked: false },
      skillId: "skill_1",
      specializeLevel: 3,
    }],
    chars: [{
      charId: "char_1",
      skinId: "skin_1",
      level: 90,
      evolvePhase: 2,
      potentialRank: 5,
      skills: [
        { id: "skill_1", specializeLevel: 3 },
        { id: "skill_2", specializeLevel: 1 },
      ],
      mainSkillLvl: 7,
      equip: [{ id: "uniequip_1", level: 3, locked: false }],
      favorPercent: 200,
      defaultSkillId: "skill_1",
      gainTime: 1_650_000_000,
      defaultEquipId: "uniequip_1",
      sortId: 1,
      exp: 0,
      gold: 0,
      rarity: 5,
    }],
    recruit: [{ startTs: 1_700_000_000, finishTs: 1_700_000_050, state: 3 }],
    charInfoMap: {
      char_1: {
        id: "char_1",
        name: "测试干员",
        nationId: "rhodes",
        groupId: "rhodes",
        displayNumber: "001",
        profession: "WARRIOR",
        subProfessionId: "fighter",
        subProfessionName: "斗士",
        appellation: "测试",
        sortId: 1,
        rarity: 5,
      },
    },
    building: {
      control: baseRoom("control", 5),
      powers: [baseRoom("power_1")],
      manufactures: [{
        ...baseRoom("factory_1"),
        speed: 1.5,
        complete: 2,
        capacity: 10,
        weight: 10,
        formulaId: 1,
        remain: 99,
        completeWorkTime: 1_700_001_000,
        lastUpdateTime: 1_700_000_000,
      }],
      tradings: [{
        ...baseRoom("trade_1"),
        stock: [{
          delivery: [{ id: 3003, count: 3, type: "MATERIAL" }],
          gain: { id: 4001, count: 1_500, type: "GOLD" },
          instId: 1,
          type: "O_GOLD",
        }],
        stockLimit: 10,
        strategy: "O_GOLD",
        completeWorkTime: 1_700_001_200,
        lastUpdateTime: 1_700_000_000,
      }, {
        ...baseRoom("trade_2"),
        stock: [{
          delivery: [{ id: 3141, count: 2, type: "DIAMOND_SHD" }],
          // The live endpoint may retain GOLD here; the order and delivery types
          // remain authoritative for an originium-shard trade.
          gain: { id: 4002, count: 20, type: "GOLD" },
          instId: 2,
          type: "O_DIAMOND",
        }],
        stockLimit: 10,
        strategy: "O_DIAMOND",
        completeWorkTime: 1_700_001_200,
        lastUpdateTime: 1_700_000_000,
      }],
      dormitories: [{ ...baseRoom("dorm_1", 5), comfort: 5_000 }],
      hire: {
        ...baseRoom("hire_1"),
        state: 1,
        refreshCount: 2,
        completeWorkTime: 1_700_002_000,
      },
      training: {
        slotId: "training_1",
        level: 3,
        trainee: { charId: "char_1", ap: 1, lastApAddTime: 1, targetSkill: 1 },
        trainer: { charId: "char_1", ap: 1, lastApAddTime: 1 },
        remainPoint: 100,
        speed: 1.2,
        lastUpdateTime: 1_700_000_000,
        remainSecs: 3_600,
      },
      meeting: {
        ...baseRoom("meeting_1"),
        clue: {
          board: ["RHINE", "RHODES"],
          own: 4,
          received: 1,
          dailyReward: true,
          needReceive: 2,
          shareCompleteTime: 1_700_005_000,
          sharing: true,
        },
        lastUpdateTime: 1_700_000_000,
        completeWorkTime: 1_700_003_000,
      },
      labor: {
        value: 200,
        maxValue: 200,
        remainSecs: 300,
        lastUpdateTime: 1_700_000_000,
      },
      elevators: [],
      corridors: [],
      furniture: { total: 200 },
      tiredChars: [RESIDENT],
    },
    skins: [{ id: "skin_1", ts: 1_660_000_000 }],
    skinInfoMap: {
      skin_1: {
        id: "skin_1",
        name: "测试时装",
        brandId: "TEST",
        sortId: 1,
        displayTagId: "tag",
        charId: "char_1",
      },
    },
    campaign: {
      records: [{ campaignId: "campaign_1", maxKills: 400 }],
      reward: { current: 1_800, total: 1_800 },
    },
    campaignInfoMap: {
      campaign_1: { id: "campaign_1", name: "切尔诺伯格", campaignZoneId: "zone_1" },
    },
    campaignZoneInfoMap: {
      zone_1: { id: "zone_1", name: "乌萨斯" },
    },
    equipmentInfoMap: {
      uniequip_1: {
        id: "uniequip_1",
        name: "测试模组",
        shiningColor: "blue",
        typeIcon: "icon",
      },
    },
    tower: {
      records: [{ towerId: "tower_1", best: 8 }],
      reward: {
        higherItem: { current: 1, total: 2 },
        lowerItem: { current: 3, total: 4 },
        termTs: 1_800_000_000,
      },
    },
    towerInfoMap: {
      tower_1: { id: "tower_1", name: "钢铁萝卜矿场", subName: "测试周期" },
    },
    rogue: {
      records: [{ rogueId: "rogue_1", relicCnt: 120, bank: { current: 300, record: 500 } }],
    },
    rogueInfoMap: {
      rogue_1: { id: "rogue_1", name: "傀影与猩红孤钻", sort: 1 },
    },
    routine: {
      daily: { current: 8, total: 10 },
      weekly: { current: 80, total: 100 },
    },
    activity: [{
      actId: "activity_1",
      actReplicaId: "",
      zones: [{ zoneId: "act_zone_1", zoneReplicaId: "", clearedStage: 8, totalStage: 10 }],
    }],
    activityInfoMap: {
      activity_1: {
        id: "activity_1",
        name: "测试活动",
        startTime: 1_700_000_000,
        endTime: 1_800_000_000,
        rewardEndTime: 1_800_100_000,
        isReplicate: false,
        type: "SIDESTORY",
      },
    },
    stageInfoMap: {
      stage_1: { id: "stage_1", code: "TN-1", name: "测试关卡" },
    },
    manufactureFormulaInfoMap: {
      1: { id: "1", itemId: formulaItemId, count: 1, weight: 1, costPoint: 1 },
    },
    charAssets: [],
    skinAssets: [],
    activityBannerList: {
      list: [{
        activityId: "activity_1",
        imgUrl: "https://example.com/banner.png",
        url: "https://example.com/unsafe-link",
        startTs: 1,
        endTs: 2,
        offlineTs: 3,
      }],
    },
    bossRush: [{
      id: "boss_1",
      record: { played: true, stageId: "stage_1", difficulty: "NORMAL" },
    }],
  } as PlayerInfo;
}

const roles = [{
  uid: "123456789",
  nickname: "博士",
  channelName: "官服",
  isDefault: true,
}];
const noLayoutSuggestion = {
  layoutLabel: null,
  layoutSuggestion: null,
  layoutWarning: null,
} as const;
const workshopLayoutSuggestion = {
  layoutLabel: "243" as const,
  layoutSuggestion: {
    template: "243",
    drone_cap: 235,
    scenario: {},
    rooms: [{ id: "workshop", kind: "workshop" as const, level: 3 }],
  },
  layoutWarning: null,
};

test("normalizes the complete public Skland dashboard without leaking raw response fields", () => {
  const snapshot = snapshotFromPlayerInfo(playerInfo(), roles, "123456789", noLayoutSuggestion);
  assert.equal(snapshot.player.avatarUrl, "https://example.com/avatar.png");
  assert.equal(snapshot.sourceName, "森空岛同步");
  assert.equal(snapshot.player.secretary?.name, "测试干员");
  assert.equal(snapshot.player.sanity?.current, 102);
  assert.equal(snapshot.operators[0]?.rarity, 6);
  assert.equal(snapshot.operators[0]?.potential, 6);
  assert.equal(snapshot.operators[0]?.modules[0]?.name, "测试模组");
  assert.equal(snapshot.skins[0]?.isCurrent, true);
  assert.equal(snapshot.progress.campaign?.records[0]?.name, "切尔诺伯格");
  assert.equal(snapshot.progress.activities?.[0]?.clearedStages, 8);

  const trading = snapshot.infrastructure.rooms.find((room) => room.group === "trading" && room.product === "gold");
  if (trading?.group !== "trading") assert.fail("gold trading room was not normalized");
  assert.equal(trading.orders[0]?.reward.count, 1_500);
  const originiumTrading = snapshot.infrastructure.rooms.find((room) => room.group === "trading" && room.product === "originium");
  if (originiumTrading?.group !== "trading") assert.fail("originium trading room was not normalized");
  assert.deepEqual(originiumTrading.orders[0], {
    delivery: [{ type: "originium_shard", count: 2 }],
    reward: { type: "orundum", count: 20 },
  });
  const manufacture = snapshot.infrastructure.rooms.find((room) => room.group === "manufacture");
  assert.equal(manufacture?.product, "gold");
  assert.equal(manufacture?.production.unitCapacity, 10);
  assert.equal(snapshot.infrastructure.training?.skillIndex, 2);
  const trainingRoom = snapshot.infrastructure.rooms.find((room) => room.group === "training");
  assert.equal(trainingRoom?.group, "training");
  if (trainingRoom?.group !== "training") assert.fail("training room was not normalized");
  assert.equal(trainingRoom.level, 3);
  assert.deepEqual(trainingRoom.occupancy, { current: 2, capacity: 2 });
  assert.deepEqual(trainingRoom.operators.map((operator) => operator.position), ["trainee", "trainer"]);
  assert.equal(snapshot.progress.recruit?.[0]?.state, "completed");
  const meeting = snapshot.infrastructure.rooms.find((room) => room.group === "meeting");
  assert.deepEqual(meeting?.clue.board, ["莱茵生命", "罗德岛"]);

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    "showConfig",
    "activityBannerList",
    "unsafe-link",
    "bubble",
    "formulaId",
    "instId",
    "channelMasterId",
    "serverId",
    "cred",
    "token",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("maps Skland manufacture entries to displayed rooms as 3, 1, 4, 2", () => {
  const info = playerInfo();
  const template = info.building.manufactures[0]!;
  info.building.manufactures = ["slot_14", "slot_5", "slot_6", "slot_7"].map((slotId) => ({
    ...template,
    slotId,
  }));

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  const manufactureRooms = snapshot.infrastructure.rooms.filter((room) => room.group === "manufacture");

  assert.deepEqual(
    manufactureRooms.map((room) => ({ key: room.key, index: room.index })),
    [
      { key: "slot_6", index: 0 },
      { key: "slot_14", index: 1 },
      { key: "slot_7", index: 2 },
      { key: "slot_5", index: 3 },
    ]
  );
});

test("one player-info normalization returns full status and a stripped schedule snapshot", () => {
  const combined = snapshotsFromPlayerInfo(playerInfo(), roles, "123456789", noLayoutSuggestion);
  const legacySchedule = scheduleSnapshotFromPlayerInfo(playerInfo(), roles, noLayoutSuggestion);
  const serialized = JSON.stringify(combined.scheduleSnapshot);
  assert.equal(combined.statusSnapshot.player.avatarUrl, "https://example.com/avatar.png");
  assert.equal(combined.scheduleSnapshot.operbox[0]?.name, "测试干员");
  assert.equal(combined.scheduleSnapshot.infrastructure.rooms[0]?.operators[0]?.morale, 20);
  assert.deepEqual(combined.scheduleSnapshot, legacySchedule);
  for (const forbidden of ["avatarUrl", "sanity", "progress", "skins", "routine", "recruit", "training", "labor"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false);
  }
});

test("adds the inferred processing facility only to the full Skland status", () => {
  const combined = snapshotsFromPlayerInfo(playerInfo(), roles, "123456789", workshopLayoutSuggestion);
  const processing = combined.statusSnapshot.infrastructure.rooms.find((room) => room.group === "processing");

  assert.deepEqual(processing, {
    key: "workshop",
    group: "processing",
    index: 0,
    level: 3,
    operators: [],
  });
  assert.equal(
    combined.scheduleSnapshot.infrastructure.rooms.some((room) => room.key === "workshop"),
    false,
  );
});

test("rejects non-HTTPS avatars and preserves unknown factory recipes as an explicit public value", () => {
  const snapshot = snapshotFromPlayerInfo(
    playerInfo("http://example.com/avatar.png", "unknown"),
    roles,
    "123456789",
    noLayoutSuggestion
  );
  assert.equal(snapshot.player.avatarUrl, null);
  const manufacture = snapshot.infrastructure.rooms.find((room) => room.group === "manufacture");
  assert.equal(manufacture?.product, "unknown");
  assert.equal(manufacture?.production.unitCapacity, 10);
});

test("keeps manufacture unit capacity unavailable when formula metadata is missing", () => {
  const info = playerInfo();
  info.manufactureFormulaInfoMap = {};

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  const manufacture = snapshot.infrastructure.rooms.find((room) => room.group === "manufacture");
  assert.equal(manufacture?.production.unitCapacity, null);
});

test("rejects credential-bearing HTTPS avatar URLs", () => {
  const snapshot = snapshotFromPlayerInfo(
    playerInfo("https://user:secret@example.com/avatar.png"),
    roles,
    "123456789",
    noLayoutSuggestion
  );
  assert.equal(snapshot.player.avatarUrl, null);
});

test("treats targetSkill -1 as an idle training room even when occupant fields remain", () => {
  const info = playerInfo();
  const training = info.building.training;
  if (!training?.trainee) assert.fail("training fixture is missing");
  training.trainee.targetSkill = -1;
  training.remainPoint = -1;
  training.remainSecs = -1;

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  assert.equal(snapshot.infrastructure.training, null);
  const normalizedRoom = snapshot.infrastructure.rooms.find((room) => room.group === "training");
  if (normalizedRoom?.group !== "training") assert.fail("idle training room was not preserved");
  assert.deepEqual(normalizedRoom.occupancy, { current: 2, capacity: 2 });
  assert.deepEqual(normalizedRoom.operators.map((operator) => operator.position), ["trainee", "trainer"]);
});

test("treats a training room without a trainee as idle", () => {
  const info = playerInfo();
  const training = info.building.training;
  if (!training) assert.fail("training fixture is missing");
  training.trainee = null;

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  assert.equal(snapshot.infrastructure.training, null);
  const normalizedRoom = snapshot.infrastructure.rooms.find((room) => room.group === "training");
  if (normalizedRoom?.group !== "training") assert.fail("training room was not preserved");
  assert.deepEqual(normalizedRoom.occupancy, { current: 1, capacity: 2 });
  assert.deepEqual(normalizedRoom.operators.map((operator) => operator.position), ["trainer"]);
});

test("treats a zero-progress training task with a concrete target skill as idle", () => {
  const info = playerInfo();
  const training = info.building.training;
  if (!training?.trainee) assert.fail("training fixture is missing");
  training.remainPoint = 0;
  training.remainSecs = 0;

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  assert.equal(snapshot.infrastructure.training, null);
  const normalizedRoom = snapshot.infrastructure.rooms.find((room) => room.group === "training");
  if (normalizedRoom?.group !== "training") assert.fail("idle training room was not preserved");
  assert.deepEqual(normalizedRoom.occupancy, { current: 2, capacity: 2 });
});

test("keeps an empty training room as an explicit 0/2 facility", () => {
  const info = playerInfo();
  const training = info.building.training;
  if (!training) assert.fail("training fixture is missing");
  training.trainee = null;
  training.trainer = null;

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  const normalizedRoom = snapshot.infrastructure.rooms.find((room) => room.group === "training");
  if (normalizedRoom?.group !== "training") assert.fail("empty training room was not preserved");
  assert.deepEqual(normalizedRoom.occupancy, { current: 0, capacity: 2 });
  assert.deepEqual(normalizedRoom.operators, []);
});

test("merges Skland class forms that share one planner-facing operator name", () => {
  const info = playerInfo();
  const alternate = structuredClone(info.chars[0]);
  alternate.charId = "char_amiya_alternate";
  alternate.level = 80;
  info.chars.push(alternate);
  info.charInfoMap.char_amiya_alternate = {
    ...info.charInfoMap.char_1,
    id: "char_amiya_alternate",
    name: "测试干员",
  };

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  assert.equal(snapshot.operbox.length, 1);
  assert.equal(snapshot.operbox[0]?.id, "char_1");
  assert.equal(snapshot.operbox[0]?.name, "测试干员");
});

test("maps every upstream recruitment state to a semantic public state", () => {
  const info = playerInfo();
  info.recruit = [0, 1, 2, 3].map((state, index) => ({
    startTs: 1_700_000_000 + index,
    finishTs: 1_700_000_100 + index,
    state: state as 0 | 1 | 2 | 3,
  }));

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  assert.deepEqual(
    snapshot.progress.recruit?.map((slot) => slot.state),
    ["locked", "standby", "recruiting", "completed"]
  );
});

test("keeps optional metadata gaps safe without inventing named records", () => {
  const info = playerInfo();
  info.building.hire = null;
  info.building.meeting = null;
  info.building.training = null;
  info.equipmentInfoMap = {};
  info.skinInfoMap = {};
  info.campaignInfoMap = {};
  info.campaignZoneInfoMap = {};
  info.towerInfoMap = {};
  info.rogueInfoMap = {};
  info.activityInfoMap = {};
  info.stageInfoMap = {};

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  assert.equal(snapshot.player.secretary?.skinName, null);
  assert.equal(snapshot.operators[0]?.modules.length, 0);
  assert.equal(snapshot.skins.length, 0);
  assert.equal(snapshot.infrastructure.training, null);
  assert.equal(snapshot.infrastructure.rooms.some((room) => room.group === "meeting"), false);
  assert.equal(snapshot.infrastructure.rooms.some((room) => room.group === "training"), false);
  assert.equal(snapshot.progress.campaign?.records[0]?.name, "未知剿灭区域");
  assert.equal(snapshot.progress.activities?.[0]?.name, "未命名活动");
  assert.equal(snapshot.progress.bossRush?.[0]?.stageCode, null);
});

test("keeps genuinely missing player and progress blocks unavailable instead of inventing zeroes", () => {
  const info = playerInfo();
  const partialInfo = info as Partial<PlayerInfo>;
  const partialStatus = info.status as Partial<PlayerInfo["status"]>;
  delete partialInfo.recruit;
  delete partialInfo.routine;
  delete partialInfo.campaign;
  delete partialInfo.tower;
  delete partialInfo.rogue;
  delete partialInfo.activity;
  delete partialInfo.bossRush;
  delete partialStatus.ap;
  delete partialStatus.registerTs;
  delete partialStatus.subscriptionEnd;
  delete partialStatus.charCnt;
  delete partialStatus.skinCnt;
  delete partialStatus.furnitureCnt;
  delete partialStatus.mainStageProgress;
  delete partialStatus.resume;

  const snapshot = snapshotFromPlayerInfo(info, roles, "123456789", noLayoutSuggestion);
  assert.equal(snapshot.player.sanity, null);
  assert.equal(snapshot.player.registerTs, null);
  assert.equal(snapshot.player.subscriptionEnd, null);
  assert.equal(snapshot.player.mainStageProgress, null);
  assert.equal(snapshot.player.resume, null);
  assert.deepEqual(snapshot.player.counts, {
    operators: null,
    furniture: null,
    skins: null,
  });
  assert.deepEqual(snapshot.progress, {
    recruit: null,
    routine: null,
    campaign: null,
    tower: null,
    rogue: null,
    activities: null,
    bossRush: null,
  });
});

test("filters deleted bindings and keeps only the public role fields", () => {
  const binding = {
    list: [{
      appCode: "arknights",
      appName: "明日方舟",
      defaultUid: "123456789",
      bindingList: [
        {
          uid: "123456789",
          isOfficial: true,
          isDefault: true,
          channelMasterId: "secret-channel-id",
          channelName: "官服",
          nickName: "博士",
          isDelete: false,
          gameName: "明日方舟",
          gameId: 1,
          roles: [],
          defaultRole: null,
        },
        {
          uid: "deleted",
          isOfficial: true,
          isDefault: false,
          channelMasterId: "secret-channel-id",
          channelName: "官服",
          nickName: "已删除",
          isDelete: true,
          gameName: "明日方舟",
          gameId: 1,
          roles: [],
          defaultRole: null,
        },
      ],
    }],
  } as AppBindingList;
  assert.deepEqual(rolesFromBinding(binding), roles);
});

test("Skland dashboard data remains inside the standard public API envelope", async () => {
  const snapshots = snapshotsFromPlayerInfo(playerInfo(), roles, "123456789", noLayoutSuggestion);
  const response = successResponse({
    authenticated: true,
    configured: true,
    ...snapshots,
  }, "req-skland-dashboard");
  assert.equal(response.headers.get("X-Request-Id"), "req-skland-dashboard");
  const body = await response.json() as {
    success: boolean;
    requestId: string;
    data: typeof snapshots;
  };
  assert.equal(body.success, true);
  assert.equal(body.requestId, "req-skland-dashboard");
  assert.equal(body.data.statusSnapshot.player.nickname, "博士");
  assert.equal("showConfig" in body.data.statusSnapshot, false);
  assert.equal("player" in body.data.scheduleSnapshot, false);
});
