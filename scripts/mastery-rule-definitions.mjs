// Explicitly reviewed skill IDs. New IDs must be classified before assets pass CI.
export const masteryRules = {};
const add = (ids, rule) => ids.split(" ").forEach((id) => { masteryRules[id] = rule; });
const speed = (ids, bonus, professions, extra = {}) => add(ids, { kind: "speed", bonus, ...(professions ? { professions } : {}), ...extra });
speed("train_spd_000 train_spd_0000 train_spd_001 train_spd_002", 25);
const professions = [8, 1, 3, 2, 6, 5, 4, 7];
professions.forEach((profession, i) => {
  const n = i + 1;
  speed(`train_spd&profession_0${n}0`, 30, [profession]);
  speed(`train_spd&profession_0${n}1`, 50, [profession]);
  speed(`train_spd&profession_1${n}0`, 60, [profession]);
});
speed("train_spd&profession_1020", 30, [1]);
speed("train_spd&profession_1081", 50, [7]);
for (const [suffix, profession] of Object.entries({ "010": 8, "020": 1, "030": 3, "040": 2, "050": 6, "052": 6, "060": 5, "080": 7, "111": 8, "321": 1 })) {
  speed(`train_spd&profession2_${suffix}`, 30, [profession]);
}
for (const [suffix, profession, stage, extra] of [
  ["110",8,1,45], ["112",8,3,50], ["120",1,1,45], ["130",3,1,45], ["150",6,1,45], ["180",7,1,45],
  ["220",1,2,45], ["230",3,2,45], ["240",2,2,45], ["250",6,2,45], ["270",4,2,45],
  ["320",1,3,45], ["322",1,3,45], ["440",2,1,65], ["620",1,3,65], ["630",2,3,45], ["640",2,3,65], ["650",6,3,65], ["660",5,3,65], ["680",7,3,65],
]) speed(`train_spd&profession2_${suffix}`, 30, [profession], { extra: { stage, bonus: extra } });
for (const [suffix, profession] of [["130",3],["150",1],["160",1],["180",4],["182",4],["184",4],["190",5]]) {
  speed(`train_spd&profession3_${suffix}`, 30, [profession]);
}
for (const [suffix, profession, branch] of [
  ["131",3,"artsprotector"], ["140",2,"fastshot"], ["151",1,"fighter"], ["161",1,"lord"],
  ["170",2,"siegesniper"], ["181",4,"wandermedic"], ["183",4,"chainhealer"], ["191",5,"supportiveranger"],
]) speed(`train_spd&profession3_${suffix}`, 30, [profession], { extra: { branch, bonus: 45 } });
speed("train_spd_doubleProf_000 train_spd_doubleProf3_000",30,[1,2]);
speed("train_spd_doubleProf_100",30,[6,4]);
speed("train_spd_doubleProf_110",45,[6,4]);
speed("train_spd_doubleProf_200",30,[6,5]);
speed("train_spd_doubleProf_201",30,[1,5]);
speed("train_spd_doubleProf_300 train_spd_doubleProf_301 train_spd_doubleProf_302",30,[6,1]);
speed("train_spd_branches_000",0,undefined,{extra:{branches:["primguard","primcaster"],bonus:45}});
speed("train_spd_doubleProf_310",45,[6,1]);
speed("train_spd_doubleProf2_000",30,[7,8],{extra:{stage:2,bonus:50}});
speed("train_spd_doubleProf2_001",30,[7,8]);
speed("train_spd_doubleProf3_100",50,[1,2]);
speed("train_spd_doubleProf3_999",45,[2,4]);
speed("train_spd&level_000",0,undefined,{extra:{stage:3,bonus:70}});
add("train_spd_reduceTime_000 train_spd_reduceTime_001",{kind:"halve"});
add("train_spd_bd&reduceTime_000",{kind:"unsupported",reason:"武道 / Martial Arts"});
add("train_cost&profession_140 train_cost&profession_320 train_cost&profession_340 train_cost&profession_350 train_cost&profession_360 train_cost&profession_380",{kind:"morale"});
export const environments = {
  fireworks: { label: "人间烟火", english: "Worldly Plight", perPoint: 1 },
  sami: { label: "萨米干员人数", english: "Sami operators", perPoint: 10, max: 3 },
  abyssal: { label: "深海猎人人数", english: "Abyssal Hunters", perPoint: 10, max: 5 },
  knights: { label: "骑士人数", english: "Knights", perPoint: 5, max: 8 },
  defence: { label: "防守方干员人数", english: "Defence operators", perPoint: 10, max: 4 },
  attack: { label: "进攻方干员人数", english: "Attack operators", perPoint: 10, max: 4 },
  siracusa: { label: "叙拉古干员人数", english: "Siracusa operators", perPoint: 5, max: 7 },
};
for (const [id, environment, cap] of [
  ["train_spd_bd_000","fireworks",null], ["train_spd_power_000","sami",3], ["train_spd_power_down_000","abyssal",5],
  ["train_spd_tag_000","knights",5], ["train_spd_tag_010","knights",8],
  ["train_spd_tag_020","defence",4], ["train_spd_tag_1020","defence",4],
  ["train_spd_tag_030","attack",4], ["train_spd_tag_1030","attack",4], ["train_spd_tag_040","siracusa",7],
]) add(id,{kind:"environment",environment,cap});
