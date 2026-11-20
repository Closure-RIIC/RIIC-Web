type BillingRecord = Record<string, unknown>;
type ModelRole = "primary" | "secondary" | "reserve";
type ModelEntry = { provider: string; role: ModelRole };
type ProviderLabels = Record<ModelRole | "modelService", string>;

export function billingProviderDisplay(value: unknown, record: BillingRecord, models: readonly ModelEntry[], labels: ProviderLabels) {
  if (value === null || value === undefined) return value;
  const entry = models.find(model => model.provider === value);
  if (entry) return labels[entry.role];
  const modelRecord = typeof record.model === "string" || typeof record.call_model === "string";
  return modelRecord ? labels.modelService : value;
}

export function billingDetailReplacer(models: readonly ModelEntry[], labels: ProviderLabels) {
  return function (this: BillingRecord, key: string, value: unknown) {
    return key === "provider" || key.endsWith("_provider") ? billingProviderDisplay(value, this, models, labels) : value;
  };
}
