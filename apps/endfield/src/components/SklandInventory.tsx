import { useState } from "react";
import { Notice, Section } from "@riic/endfield-ui";
import type { EndfieldInventory, EndfieldMaterialGroup } from "@riic/endfield-skland/inventory";
import { useWorkspace } from "../state";
import { SearchInput } from "@riic/ui-primitives/search-input";
import { FilterSelect } from "@riic/ui-primitives/filter-select";

export function SklandInventory({ inventory }: { inventory?: EndfieldInventory }) {
  const { t, locale } = useWorkspace();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const items = inventory?.items ?? [];
  const groups: [EndfieldMaterialGroup, string][] = [
    ["charExpMaterials", t("干员经验", "Operator EXP")],
    ["weaponExpMaterials", t("武器经验", "Weapon EXP")],
    ["materials", t("养成材料", "Upgrade materials")],
    ["other", t("其他物品", "Other items")],
  ];
  const query = search.trim().toLocaleLowerCase();
  const filtered = items.filter(item => (group === "all" || item.group === group)
    && (item.name.toLocaleLowerCase().includes(query) || item.id.toLowerCase().includes(query)));
  const issue = inventory?.issue;
  const message = issue === "identity"
    ? t("仓库返回的角色与当前选择不一致，未显示该库存。请重新选择角色或刷新。", "The inventory belongs to a different character and has been hidden. Select your character again or refresh.")
    : !items.length
      ? t("养成仓库暂时无法读取，请点击页面上方“刷新数据”重试。", "Upgrade inventory is unavailable. Use Refresh data above to retry.")
      : issue === "counts"
        ? t("已读取材料目录，库存暂未获取；“未获取”不代表数量为 0。请刷新重试。", "The material catalog loaded, but stock is unavailable. Unknown does not mean zero. Refresh to retry.")
        : issue === "catalog"
          ? t("材料目录暂未获取，先按物品 ID 展示库存。请刷新重试。", "Material names are unavailable; stock is shown by item ID. Refresh to retry.")
          : t("部分物品资料或库存未返回，缺失数量标为“未获取”。", "Some item details or quantities were not returned. Missing quantities are marked Unknown.");
  return <Section>
    {items.length ? <>
      <div className="ef-inventory-filters">
        <FilterSelect aria-label={t("物品分类", "Item category")} value={group} onValueChange={setGroup} emptyText={t("没有匹配分类", "No matching categories")}
          options={[{ value: "all", label: t("全部物品", "All items") }, ...groups.filter(([id]) => items.some(item => item.group === id)).map(([value, label]) => ({ value, label }))]} />
        <span className="ef-muted" role="status">{t(`显示 ${filtered.length} / ${items.length} 种`, `Showing ${filtered.length} / ${items.length} items`)}</span>
      </div>
      <SearchInput containerClassName="ef-sync-search" label={t("搜索仓库物品", "Search inventory")} placeholder={t("搜索物品名称或 ID", "Search by item name or ID")}
        value={search} onChange={event => setSearch(event.target.value)} onClear={() => setSearch("")} clearLabel={t("清空搜索", "Clear search")} />
      {groups.map(([id, title]) => {
        const rows = filtered.filter(item => item.group === id);
        return rows.length ? <div key={id} className="ef-inventory-group">
          <h3>{title}<small>{rows.length}</small></h3>
          <div className="ef-inventory-grid">{rows.map(item => <article key={item.id} className="ef-inventory-item" data-material-id={item.id}>
            {item.icon ? <img src={item.icon} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" /> : <span className="ef-inventory-placeholder" aria-hidden="true">◇</span>}
            <div><h4 title={item.id}>{item.name}</h4><p>{t("库存", "In stock")}</p></div>
            <strong data-material-count>{item.count === null ? <span className="ef-muted">{t("未获取", "Unknown")}</span> : item.count.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</strong>
          </article>)}</div>
        </div> : null;
      })}
      {!filtered.length ? <p className="ef-muted">{t("没有符合条件的物品。", "No matching items.")}</p> : null}
    </> : null}
    <div className="ef-sync-note">
      <p>{t("来自森空岛养成计算器，仅包含该接口开放的物品。", "From the Skland cost calculator; only items exposed by this service are included.")}</p>
      {inventory?.status !== "ready" ? <Notice>{message}</Notice> : null}
    </div>
  </Section>;
}
