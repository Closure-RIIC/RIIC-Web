import { useState } from "react";
import { Notice, Section } from "@riic/endfield-ui";
import type { EndfieldInventory, EndfieldMaterialGroup } from "@riic/endfield-skland/inventory";
import { inventoryExperienceSummary } from "@riic/endfield-skland/inventory-summary";
import { useWorkspace } from "../state";
import { SearchInput } from "@riic/ui-primitives/search-input";
import { Tabs, TabsList, TabsTrigger } from "@riic/ui-primitives/tabs";

export function SklandInventory({ inventory }: { inventory?: EndfieldInventory }) {
  const { t, locale } = useWorkspace();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const items = inventory?.items ?? [];
  const experience = inventoryExperienceSummary(inventory);
  const groups: [EndfieldMaterialGroup, string][] = [
    ["charExpMaterials", t("SklandInventory.operatorExp")],
    ["weaponExpMaterials", t("SklandInventory.weaponExp")],
    ["materials", t("SklandInventory.upgradeMaterials")],
    ["other", t("SklandInventory.otherItems")],
  ];
  const query = search.trim().toLocaleLowerCase();
  const wan = (value: number) => `${(value / 10_000).toLocaleString(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} ${t("SklandInventory.10kExp")}`;
  const filtered = items.filter(item => (group === "all" || item.group === group)
    && (item.name.toLocaleLowerCase().includes(query) || item.id.toLowerCase().includes(query)));
  const issue = inventory?.issue;
  const message = issue === "identity"
    ? t("SklandInventory.theInventoryBelongsToADifferentCharacterAndHas")
    : !items.length
      ? t("SklandInventory.upgradeInventoryIsUnavailableUseRefreshDataAboveTo")
      : issue === "counts"
        ? t("SklandInventory.theMaterialCatalogLoadedButStockIsUnavailableUnknown")
        : issue === "catalog"
          ? t("SklandInventory.materialNamesAreUnavailableStockIsShownByItem")
          : t("SklandInventory.someItemDetailsOrQuantitiesWereNotReturnedMissing");
  return <Section>
    {items.length ? <>
      <div className="ef-inventory-filters">
        <Tabs value={group} onValueChange={setGroup} data-yeye-scroll="auto" className="max-w-full overflow-x-auto py-1">
          <TabsList aria-label={t("SklandInventory.itemCategory")}>
            <TabsTrigger value="all">{t("SklandInventory.allItems")}</TabsTrigger>
            {groups.filter(([id]) => items.some(item => item.group === id)).map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <span className="ef-muted" role="status">{t("SklandInventory.showingItems", { value1: filtered.length, value2: items.length })}</span>
      </div>
      <SearchInput containerClassName="ef-sync-search" label={t("SklandInventory.searchInventory")} placeholder={t("SklandInventory.searchByItemNameOrId")}
        value={search} onChange={event => setSearch(event.target.value)} onClear={() => setSearch("")} clearLabel={t("SklandInventory.clearSearch")} />
      {groups.map(([id, title]) => {
        const rows = filtered.filter(item => item.group === id);
        const summary = id === "charExpMaterials" && experience.operator
          ? `${t("SklandInventory.cognitiveCarriers")} ${wan(experience.operator.carriers)} · ${t("SklandInventory.battleRecords")} ${wan(experience.operator.records)}`
          : id === "weaponExpMaterials" && experience.weapon !== null
            ? `${t("SklandInventory.total")} ${wan(experience.weapon)}`
            : null;
        return rows.length ? <div key={id} className="ef-inventory-group">
          <h3>{title}<small>{rows.length}</small></h3>
          {summary ? <p className="ef-inventory-summary">{summary}</p> : null}
          <div className="ef-inventory-grid">{rows.map(item => <article key={item.id} className="ef-inventory-item" data-material-id={item.id}>
            {item.icon ? <img src={item.icon} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" /> : <span className="ef-inventory-placeholder" aria-hidden="true">◇</span>}
            <div><h4 title={item.id}>{item.name}</h4><p>{t("SklandInventory.inStock")}</p></div>
            <strong data-material-count>{item.count === null ? <span className="ef-muted">{t("SklandInventory.unknown")}</span> : item.count.toLocaleString(locale)}</strong>
          </article>)}</div>
        </div> : null;
      })}
      {!filtered.length ? <p className="ef-muted">{t("SklandInventory.noMatchingItems")}</p> : null}
    </> : null}
    <div className="ef-sync-note">
      <p>{t("SklandInventory.fromTheSklandCostCalculatorOnlyItemsExposedBy")}</p>
      {inventory?.status !== "ready" ? <Notice>{message}</Notice> : null}
    </div>
  </Section>;
}
