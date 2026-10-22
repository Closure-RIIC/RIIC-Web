import { factoryRecipeFromMaaProduct } from "./factory-recipes.ts";
import type { BaseBlueprint, OperBoxEntry, PublicPlanData, RotationProfile } from "./types.ts";

export function effectiveFiammettaSetting(
  operbox: readonly OperBoxEntry[] | null,
  rotationProfile: RotationProfile,
  enabled: boolean,
): boolean {
  const ownsFiammetta = Boolean(operbox?.some((operator) => operator.own && operator.name === "菲亚梅塔"));
  return ownsFiammetta && (rotationProfile === "fiammetta_8_8_4_4" || enabled);
}

export function resolvePlanPresentationLayout(layout: BaseBlueprint, result: PublicPlanData): BaseBlueprint {
  let next = layout;
  const maaFactoryRooms = result.maa.plans[0]?.rooms?.manufacture;
  if (!maaFactoryRooms) return next;
  const layoutFactoryRooms = layout.rooms.filter((room) => room.kind === "factory");
  maaFactoryRooms.forEach((maaRoom, index) => {
    const layoutRoom = layoutFactoryRooms[index];
    const currentRecipe = layoutRoom?.product && "factory" in layoutRoom.product
      ? layoutRoom.product.factory.recipe
      : "gold";
    if (!layoutRoom || !maaRoom.product || currentRecipe !== "all") return;
    const recipe = factoryRecipeFromMaaProduct(maaRoom.product);
    if (!recipe) return;
    next = {
      ...next,
      rooms: next.rooms.map((room) => room.id === layoutRoom.id && room.kind === "factory"
        ? { ...room, product: { factory: { recipe } } }
        : room),
    };
  });
  return next;
}
