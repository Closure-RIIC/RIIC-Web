type StringStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export class DeviceIdCache {
  private value: string | null = null;
  private pending: Promise<string> | null = null;

  async run<T>(
    storage: StringStorage,
    storageKey: string,
    createChallenge: () => Promise<T>
  ): Promise<T> {
    if (this.value) {
      await storage.setItem(storageKey, this.value);
      return createChallenge();
    }

    if (this.pending) {
      const deviceId = await this.pending;
      await storage.setItem(storageKey, deviceId);
      return createChallenge();
    }

    const operation = (async () => {
      const result = await createChallenge();
      const deviceId = await storage.getItem(storageKey);
      if (!deviceId) throw new Error("Skland device ID was not generated.");
      this.value = deviceId;
      return { deviceId, result };
    })();
    const pending = operation.then(({ deviceId }) => deviceId);
    this.pending = pending;
    void pending.catch(() => undefined);

    try {
      return (await operation).result;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }
}
