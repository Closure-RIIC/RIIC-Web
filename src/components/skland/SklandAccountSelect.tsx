"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SklandAccountSummary } from "@/types";
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList, ComboboxSeparator } from "@/components/ui/combobox";

/** Shared grouped account / role selector for status and persisted headhunting history. */
export function SklandAccountSelect({ accounts, accountId, uid, disabled, onRoleChange }: {
  accounts: Array<Pick<SklandAccountSummary, "accountId" | "selectedUid" | "roles">>;
  accountId: string | null; uid: string; disabled?: boolean;
  onRoleChange: (accountId: string, uid: string) => void;
}) {
  const intl = useTranslations();
  const [query, setQuery] = useState<string | null>(null);
  const groups = accounts.map((account, index) => {
    const selected = account.roles.find((role) => role.uid === account.selectedUid) ?? account.roles[0];
    return { value: account.accountId,
      label: `${intl("components_pages_SklandStatus.sklandAccount")} ${index + 1}${selected ? ` · ${selected.nickname}` : ""}`,
      items: account.roles.map((role) => ({ value: `${account.accountId}:${role.uid}`, label: `${role.nickname} · ${role.channelName}`, accountId: account.accountId, uid: role.uid })) };
  });
  const selectedValue = `${accountId}:${uid}`;
  const selected = groups.flatMap((group) => group.items).find((item) => item.value === selectedValue) ?? null;
  const filtered = query === null ? groups : groups.map((group) => ({ ...group,
    items: group.items.filter((item) => `${item.label} ${item.uid}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  })).filter((group) => group.items.length > 0);
  return <Combobox items={groups} filteredItems={filtered} value={selected} inputValue={query ?? selected?.label ?? ""} disabled={disabled}
    itemToStringValue={(item) => item.label} isItemEqualToValue={(item, current) => item.value === current.value}
    autoHighlight
    onInputValueChange={setQuery} onOpenChange={(open) => { if (!open) setQuery(null); }}
    onValueChange={(item) => { if (item && item.value !== selectedValue) { setQuery(null); onRoleChange(item.accountId, item.uid); } }}>
    <ComboboxInput className="h-full w-full" aria-label={intl("components_pages_SklandStatus.selectAccountAndCharacter")} placeholder={intl("components_pages_SklandStatus.searchAccountsAndCharacters")} />
    <ComboboxContent>
      <ComboboxEmpty>{intl("components_pages_SklandStatus.noMatchingAccountOrCharacter")}</ComboboxEmpty>
      <ComboboxList>{(group, index) => <ComboboxGroup key={group.value} items={group.items}>
        {index > 0 && <ComboboxSeparator />}<ComboboxLabel>{group.label}</ComboboxLabel>
        <ComboboxCollection>{(item) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxCollection>
      </ComboboxGroup>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}
