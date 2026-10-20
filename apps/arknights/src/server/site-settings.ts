import { eq } from "drizzle-orm";
import { getDatabase } from "@/server/db";
import { siteSetting } from "@/server/db/schema";

const DONATION_KEY = "wishes.donation";
export type DonationSetting = { enabled: boolean; imageUrl: string | null };
const DEFAULT_DONATION: DonationSetting = { enabled: false, imageUrl: null };

export async function getDonationSetting(): Promise<DonationSetting> {
  const [row] = await getDatabase().select().from(siteSetting).where(eq(siteSetting.key, DONATION_KEY)).limit(1);
  const value = row?.value as Partial<DonationSetting> | undefined;
  return { enabled: value?.enabled === true, imageUrl: typeof value?.imageUrl === "string" ? value.imageUrl : DEFAULT_DONATION.imageUrl };
}

export async function saveDonationSetting(value: DonationSetting) {
  const [row] = await getDatabase().insert(siteSetting).values({ key: DONATION_KEY, value, updatedAt: new Date() }).onConflictDoUpdate({ target: siteSetting.key, set: { value, updatedAt: new Date() } }).returning();
  return row?.value as DonationSetting;
}
