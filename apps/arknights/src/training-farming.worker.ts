import type { planFarming } from "./training-farming";
import { planFarmingWithCrafts } from "./training-farming-crafts";
import plannerData from "./generated/training-planner-data.json" with { type: "json" };
import type { TrainingPlannerData } from "./training-planner";

self.addEventListener("message", (event: MessageEvent<Parameters<typeof planFarming>>) => {
  try {
    const { items } = plannerData as TrainingPlannerData;
    self.postMessage({ plan: planFarmingWithCrafts(event.data, items) });
  } catch {
    self.postMessage({ plan: null });
  }
});
