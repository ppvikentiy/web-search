/**
 * Settings live in chrome.storage.local. One-time migration from storage.sync.
 */
globalThis.WSSettingsStorage = globalThis.WSSettingsStorage ?? (() => {
  const MIGRATED_KEY = 'settingsMigrated';
  let migratePromise = null;

  function settingsKeys() {
    return Object.keys(globalThis.WS_DEFAULTS || {});
  }

  function pickSettings(source) {
    const payload = {};
    if (!source || typeof source !== 'object') return payload;
    for (const key of settingsKeys()) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        payload[key] = source[key];
      }
    }
    return payload;
  }

  async function migrateIfNeeded() {
    if (migratePromise) return migratePromise;

    migratePromise = (async () => {
      const local = await chrome.storage.local.get({ [MIGRATED_KEY]: false });
      if (local[MIGRATED_KEY]) return;

      let fromSync = {};
      try {
        fromSync = await chrome.storage.sync.get(null);
      } catch {
        fromSync = {};
      }

      const payload = pickSettings(fromSync);
      if (Object.keys(payload).length) {
        await chrome.storage.local.set(payload);
      }
      await chrome.storage.local.set({ [MIGRATED_KEY]: true });
    })().catch((err) => {
      migratePromise = null;
      throw err;
    });

    return migratePromise;
  }

  async function get(defaults = globalThis.WS_DEFAULTS) {
    await migrateIfNeeded();
    return chrome.storage.local.get(defaults);
  }

  async function set(values) {
    await migrateIfNeeded();
    return chrome.storage.local.set(values);
  }

  return { get, set, migrateIfNeeded, pickSettings, MIGRATED_KEY };
})();

var WSSettingsStorage = globalThis.WSSettingsStorage;
