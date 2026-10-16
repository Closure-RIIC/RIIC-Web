import { normalizeLocalProfileSession, SESSION_KEY_V5, SESSION_KEY_V4, SESSION_KEY_V3, SESSION_KEY_V2, type PersistedSessionV5 } from './persistence.ts';
import { MANUAL_SCHEDULE_STORAGE_KEY, MOOD_STORAGE_KEY } from './manual-schedule-config.ts';
import { loadManualScheduleDraft } from './manual-schedule.ts';
import { MOWER_EDITOR_STORAGE_KEY, parseMowerEditorDocument } from './mower-editor.ts';
import { stripInternalFields } from './internal-field-safety.ts';
export const LOCAL_PROFILES_KEY = 'riic-local-profiles-v1';
export const MAX_LOCAL_PROFILES = 20;
export const MAX_PROFILE_FILE_BYTES = 8 * 1024 * 1024;
const CACHE_KEY = 'arknights-infra-manual-evaluation-v1';
const WORK_KEYS = [SESSION_KEY_V5, MANUAL_SCHEDULE_STORAGE_KEY, MOOD_STORAGE_KEY, MOWER_EDITOR_STORAGE_KEY] as const;
const SWITCH_KEYS = [...WORK_KEYS, SESSION_KEY_V4, SESSION_KEY_V3, SESSION_KEY_V2, CACHE_KEY];
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type LocalProfileData = {
    session: PersistedSessionV5;
    manual: unknown | null;
    mood: unknown | null;
    mower: unknown | null;
};
export type LocalProfile = {
    id: string;
    name: string;
    updatedAt: string;
    data: LocalProfileData;
};
export type LocalProfiles = {
    version: 1;
    managed: boolean;
    activeId: string;
    profiles: LocalProfile[];
};
const secretKey = /^(?:cred|credentials?|token|access[_-]?token|refresh[_-]?token|oauth[_-]?token|authorization|password|secret|cookies?|set-cookie|__proto__|prototype|constructor)$/i;
function portable(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(portable);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key)).map(([key, v]) => [key, portable(v)]));
    return value;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function read(storage: StorageLike, key: string): unknown { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; }
export function profileName(name: string) { const trimmed = name.trim(); if (!trimmed || trimmed.length > 40)
    throw new Error('INVALID_NAME'); return trimmed; }
export function validateLocalProfileData(value: unknown): LocalProfileData {
    if (!record(value))
        throw new Error('INVALID_FILE');
    const safe = portable(value) as Record<string, unknown>;
    const session = normalizeLocalProfileSession(safe.session);
    if (!session)
        throw new Error('INVALID_FILE');
    // Imported rosters are independent snapshots, never an instruction to restore a server account.
    session.layout = stripInternalFields(session.layout);
    session.operbox = stripInternalFields(session.operbox);
    session.boxSource = session.boxSource === 'skland' ? 'maa' : session.boxSource;
    session.layoutSource = 'local';
    session.layoutDirty = true;
    session.localLayoutBackup = null;
    let manual: unknown = null, mower: unknown = null;
    if (safe.manual != null) {
        manual = loadManualScheduleDraft({ getItem: () => JSON.stringify(safe.manual), setItem: () => undefined });
        if (!manual)
            throw new Error('INVALID_FILE');
    }
    if (safe.mower != null) {
        try {
            mower = stripInternalFields(parseMowerEditorDocument(JSON.stringify(safe.mower)));
        }
        catch {
            throw new Error('INVALID_FILE');
        }
    }
    if (safe.mood != null && !record(safe.mood))
        throw new Error('INVALID_FILE');
    return { session, manual, mood: stripInternalFields(safe.mood ?? null), mower };
}
export function captureLocalProfile(storage: StorageLike, session?: unknown): LocalProfileData {
    return validateLocalProfileData({ session: session ?? read(storage, SESSION_KEY_V5), manual: read(storage, MANUAL_SCHEDULE_STORAGE_KEY), mood: read(storage, MOOD_STORAGE_KEY), mower: read(storage, MOWER_EDITOR_STORAGE_KEY) });
}
export function readLocalProfiles(storage: StorageLike): LocalProfiles | null {
    const value = read(storage, LOCAL_PROFILES_KEY);
    if (value === null)
        return null;
    if (!record(value) || value.version !== 1 || !Array.isArray(value.profiles) || !value.profiles.length || value.profiles.length > MAX_LOCAL_PROFILES)
        throw new Error('INVALID_STORE');
    const profiles = value.profiles.map(p => { if (!record(p) || typeof p.id !== 'string' || typeof p.name !== 'string')
        throw new Error('INVALID_STORE'); return { id: p.id, name: profileName(p.name), updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(), data: validateLocalProfileData(p.data) }; });
    if (new Set(profiles.map(p => p.id)).size !== profiles.length || !profiles.some(p => p.id === value.activeId))
        throw new Error('INVALID_STORE');
    return { version: 1, managed: value.managed === true, activeId: String(value.activeId), profiles };
}
export function ensureLocalProfiles(storage: StorageLike, session: unknown, name: string): LocalProfiles {
    const existing = readLocalProfiles(storage);
    if (existing)
        return existing;
    const store: LocalProfiles = { version: 1, managed: false, activeId: 'default', profiles: [{ id: 'default', name, updatedAt: new Date().toISOString(), data: captureLocalProfile(storage, session) }] };
    storage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(store));
    return store;
}
export function saveActiveLocalProfile(storage: StorageLike, session?: unknown, expectedId?: string): LocalProfiles | null {
    const store = readLocalProfiles(storage);
    if (!store)
        return null;
    if (expectedId && store.activeId !== expectedId)
        throw new Error('PROFILE_CHANGED');
    const data = captureLocalProfile(storage, session);
    const next = { ...store, profiles: store.profiles.map(p => p.id === store.activeId ? { ...p, data, updatedAt: new Date().toISOString() } : p) };
    storage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(next));
    return next;
}
/** Restore working keys transactionally. Keep every profile if browser quota rejects a write. */
export function switchLocalProfile(storage: StorageLike, store: LocalProfiles, id: string): LocalProfiles {
    const target = store.profiles.find(p => p.id === id);
    if (!target)
        throw new Error('INVALID_PROFILE');
    const data = validateLocalProfileData(target.data);
    const next = { ...store, managed: true, activeId: id };
    const before = new Map([...SWITCH_KEYS, LOCAL_PROFILES_KEY].map(key => [key, storage.getItem(key)]));
    try {
        const values = [data.session, data.manual, data.mood, data.mower];
        WORK_KEYS.forEach((key, i) => { if (values[i] == null)
            storage.removeItem(key);
        else
            storage.setItem(key, JSON.stringify(values[i])); });
        [SESSION_KEY_V4, SESSION_KEY_V3, SESSION_KEY_V2, CACHE_KEY].forEach(key => storage.removeItem(key));
        storage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(next));
    }
    catch (error) {
        for (const [key, value] of before) {
            try {
                if (value === null)
                    storage.removeItem(key);
                else
                    storage.setItem(key, value);
            }
            catch { /* Preserve the original storage failure. */ }
        }
        throw error;
    }
    return next;
}
export function appendLocalProfile(store: LocalProfiles, name: string, data: LocalProfileData, id: string): LocalProfiles {
    if (store.profiles.length >= MAX_LOCAL_PROFILES)
        throw new Error('PROFILE_LIMIT');
    if (store.profiles.some(p => p.id === id))
        throw new Error('INVALID_PROFILE');
    const base = profileName(name);
    let label = base, index = 2;
    while (store.profiles.some(p => p.name === label)) {
        const suffix = ` (${index++})`;
        label = base.slice(0, 40 - suffix.length) + suffix;
    }
    return { ...store, profiles: [...store.profiles, { id, name: label, updatedAt: new Date().toISOString(), data: validateLocalProfileData(data) }] };
}
export function emptyLocalProfile(current: LocalProfileData): LocalProfileData {
    return { ...current, session: { ...current.session, operbox: null, sourceName: null, boxSource: 'sample', result: null, activeShift: 0 }, manual: null, mood: null, mower: null };
}
export function exportLocalProfiles(store: LocalProfiles, all = false) {
    return { format: 'riic-local-profiles', version: 1, exportedAt: new Date().toISOString(), profiles: store.profiles.filter(p => all || p.id === store.activeId).map(p => ({ name: p.name, data: validateLocalProfileData(p.data) })) };
}
export function parseLocalProfilesFile(text: string): Array<{
    name: string;
    data: LocalProfileData;
}> {
    if (new TextEncoder().encode(text).length > MAX_PROFILE_FILE_BYTES)
        throw new Error('FILE_TOO_LARGE');
    let value: unknown;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new Error('INVALID_FILE');
    }
    if (!record(value) || value.format !== 'riic-local-profiles' || value.version !== 1 || !Array.isArray(value.profiles) || !value.profiles.length || value.profiles.length > MAX_LOCAL_PROFILES)
        throw new Error('INVALID_FILE');
    return value.profiles.map(p => { if (!record(p) || typeof p.name !== 'string')
        throw new Error('INVALID_FILE'); return { name: profileName(p.name), data: validateLocalProfileData(p.data) }; });
}
