"use client";
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'use-intl';
import { Check, Download, FolderOpen, Plus, Settings2, Upload, Users } from 'lucide-react';
import { localProfilesText } from '@/i18n/helpers/local_profiles';
import { appendLocalProfile, captureLocalProfile, emptyLocalProfile, ensureLocalProfiles, exportLocalProfiles, LOCAL_PROFILES_KEY, MAX_LOCAL_PROFILES, MAX_PROFILE_FILE_BYTES, parseLocalProfilesFile, profileName, readLocalProfiles, saveActiveLocalProfile, switchLocalProfile, type LocalProfileData, type LocalProfiles } from '@/local-profiles';
import { downloadJson } from '@/download';
import { Button } from '@/components/ui/button';
import { SetupActionButton } from '@/components/setup/SetupActionButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
export function LocalProfilesControl({ session, disabled }: {
    session: unknown;
    disabled: boolean;
}) {
    const en = useLocale() === 'en';
    const t = (key: Parameters<typeof localProfilesText.text>[1], values?: Record<string, string | number>) => localProfilesText.text(en, key, values);
    const [store, setStore] = useState<LocalProfiles | null>(null), [open, setOpen] = useState(false), [mode, setMode] = useState<'new' | 'rename' | null>(null), [name, setName] = useState(''), [copy, setCopy] = useState('copy'), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [pending, setPending] = useState<Array<{
        name: string;
        data: LocalProfileData;
    }> | null>(null);
    const file = useRef<HTMLInputElement>(null), initialized = useRef(false);
    useEffect(() => { if (initialized.current)
        return; initialized.current = true; try {
        setStore(ensureLocalProfiles(window.localStorage, session, localProfilesText.text(en, 'defaultName')));
    }
    catch {
        setError('errorStorage');
    } }, [session, en]);
    const fail = (cause: unknown) => { const code = cause instanceof Error ? cause.message : ''; setError(code === 'INVALID_NAME' ? 'errorName' : code === 'INVALID_FILE' ? 'errorFile' : code === 'PROFILE_LIMIT' ? 'errorLimit' : code === 'FILE_TOO_LARGE' ? 'errorSize' : code === 'PROFILE_CHANGED' ? 'errorChanged' : 'errorStorage'); };
    const latest = () => { const current = readLocalProfiles(window.localStorage); if (!current || current.activeId !== store?.activeId)
        throw new Error('PROFILE_CHANGED'); return current; };
    const snapshot = () => { latest(); const value = saveActiveLocalProfile(window.localStorage, session, store?.activeId); if (!value)
        throw new Error('PROFILE_CHANGED'); return value; };
    const select = (id: string) => { if (disabled || id === store?.activeId)
        return; try {
        const next = snapshot();
        switchLocalProfile(window.localStorage, next, id);
        window.location.reload();
    }
    catch (cause) {
        fail(cause);
    } };
    const create = () => { if (disabled)
        return; try {
        const current = snapshot(), data = captureLocalProfile(window.localStorage, session);
        const next = appendLocalProfile(current, name, copy === 'copy' ? data : emptyLocalProfile(data), crypto.randomUUID());
        switchLocalProfile(window.localStorage, next, next.profiles[next.profiles.length - 1].id);
        window.location.reload();
    }
    catch (cause) {
        fail(cause);
    } };
    const rename = () => { try {
        const current = latest(), label = profileName(name);
        const next = { ...current, profiles: current.profiles.map(p => p.id === current.activeId ? { ...p, name: label } : p) };
        window.localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(next));
        setStore(next);
        setMode(null);
        setNotice(t('saved'));
        setError('');
    }
    catch (cause) {
        fail(cause);
    } };
    const exportFile = (all: boolean) => { try {
        const current = snapshot();
        setStore(current);
        downloadJson(`riic-profiles-${new Date().toISOString().slice(0, 10)}.json`, exportLocalProfiles(current, all));
        setError('');
    }
    catch (cause) {
        fail(cause);
    } };
    const importFile = async (selected: File) => { setError(''); try {
        if (selected.size > MAX_PROFILE_FILE_BYTES)
            throw new Error('FILE_TOO_LARGE');
        const profiles = parseLocalProfilesFile(await selected.text());
        if (latest().profiles.length + profiles.length > MAX_LOCAL_PROFILES)
            throw new Error('PROFILE_LIMIT');
        setPending(profiles);
        setMode(null);
        setOpen(true);
    }
    catch (cause) {
        fail(cause);
    } };
    const commitImport = () => { if (!pending || disabled)
        return; try {
        let next = snapshot();
        for (const entry of pending)
            next = appendLocalProfile(next, entry.name, entry.data, crypto.randomUUID());
        window.localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(next));
        setStore(next);
        setNotice(t('imported', { count: pending.length }));
        setPending(null);
        setError('');
    }
    catch (cause) {
        fail(cause);
    } };
    const active = store?.profiles.find(p => p.id === store.activeId);
    const selectOptions = store?.profiles.map(p => ({ value: p.id, label: p.name })) ?? [];
    const selected = selectOptions.find(p => p.value === store?.activeId) ?? null;
    return <section className="space-y-2" data-local-profiles>
 <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/80 px-3 py-2"><div className="flex min-w-0 max-w-full items-center gap-2"><FolderOpen className="size-4 shrink-0 text-muted-foreground"/><span className="shrink-0 text-xs text-muted-foreground max-sm:sr-only">{t('title')}</span><Combobox items={selectOptions} value={selected} inputValue={selected?.label ?? ''} itemToStringValue={option => option.label} isItemEqualToValue={(option, value) => option.value === value.value} disabled={disabled || !store} onValueChange={option => { if (option)
        select(option.value); }}><ComboboxInput readOnly aria-label={t('choose')} className="h-8 w-44 max-w-[min(55vw,240px)]"/><ComboboxContent><ComboboxList>{option => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox><Badge variant="secondary" className="max-sm:hidden">{t('count', { count: store?.profiles.length ?? 0 })}</Badge></div><Button variant="outline" className="rounded-full text-xs" disabled={!store || disabled} onClick={() => { setOpen(true); setMode(null); setPending(null); setError(''); setNotice(''); }}><Settings2 />{t('manage')}</Button></div>
 {disabled && <p className="text-xs text-muted-foreground">{t('busy')}</p>}
 {error && !open && <Alert variant="destructive"><AlertDescription>{t(error as 'errorStorage')}</AlertDescription></Alert>}
 <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label={t('importAction')} onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen)
        void importFile(chosen); }}/>
 <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) {
        setPending(null);
        setMode(null);
        setError('');
    } }}><DialogContent className="grid max-h-[88svh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[min(720px,calc(100vw-2rem))]">
 <DialogHeader><DialogTitle>{t(pending ? 'importTitle' : mode === 'new' ? 'newHeading' : mode === 'rename' ? 'renameHeading' : 'title')}</DialogTitle><DialogDescription>{t(pending ? 'importHint' : 'description')}</DialogDescription></DialogHeader>
 <DialogBody className="min-h-0 overflow-y-auto">
 {!pending && !mode && <><div className="flex flex-wrap gap-2 border-b border-border/60 pb-3"><Button variant="outline" className="rounded-full" disabled={disabled} onClick={() => exportFile(false)}><Download />{t('export')}</Button><Button variant="outline" className="rounded-full" disabled={disabled} onClick={() => exportFile(true)}><Download />{t('exportAll')}</Button><Button variant="outline" className="rounded-full" disabled={disabled} onClick={() => file.current?.click()}><Upload />{t('import')}</Button></div><div className="grid gap-2">{store?.profiles.map(p => <button type="button" key={p.id} disabled={disabled} onClick={() => select(p.id)} className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Users className="size-4 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{p.name}</strong><span className="mt-1 block text-xs text-muted-foreground">{p.id === store.activeId ? t('operators', { count: (session as {
            operbox?: unknown[];
        })?.operbox?.length ?? 0 }) : t('operators', { count: p.data.session.operbox?.length ?? 0 })} · {t((p.id === store.activeId ? (session as {
        result?: unknown;
    }).result : p.data.session.result) ? 'result' : 'noResult')}</span></span>{p.id === store.activeId && <Badge variant="secondary"><Check />{t('current')}</Badge>}</button>)}</div><div className="flex flex-wrap gap-2"><SetupActionButton variant="outline" disabled={disabled || (store?.profiles.length ?? 0) >= MAX_LOCAL_PROFILES} onClick={() => { setMode('new'); setName(''); setError(''); }}><Plus />{t('new')}</SetupActionButton><SetupActionButton variant="outline" disabled={disabled} onClick={() => { setMode('rename'); setName(active?.name ?? ''); setError(''); }}>{t('rename')}</SetupActionButton></div></>}
 {mode && <><div className="grid gap-2"><Label htmlFor="local-profile-name">{t('name')}</Label><Input id="local-profile-name" maxLength={40} value={name} autoFocus placeholder={t('namePlaceholder')} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && name.trim()) {
        if (mode === 'new')
            create();
        else
            rename();
    } }}/></div>{mode === 'new' && <><Tabs value={copy} onValueChange={setCopy}><TabsList aria-label={t('new')}><TabsTrigger value="copy">{t('copy')}</TabsTrigger><TabsTrigger value="empty">{t('empty')}</TabsTrigger></TabsList></Tabs>{copy === 'empty' && <p className="text-xs text-muted-foreground">{t('emptyHint')}</p>}</>}</>}
 {pending && <div className="grid gap-2">{pending.map((p, i) => <div key={i} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border p-3"><span className="min-w-0 truncate text-sm font-medium">{p.name}</span><span className="shrink-0 text-xs text-muted-foreground">{t('operators', { count: p.data.session.operbox?.length ?? 0 })}</span></div>)}</div>}
 <p className="text-xs leading-5 text-muted-foreground">{t('localNotice')}</p>
 {notice && <p role="status" className="text-sm">{notice}</p>}{error && <Alert variant="destructive"><AlertDescription>{t(error as 'errorStorage')}</AlertDescription></Alert>}
 </DialogBody><DialogFooter><Button variant="ghost" className="rounded-full" onClick={() => { if (mode || pending) {
        setMode(null);
        setPending(null);
        setError('');
    }
    else
        setOpen(false); }}>{t(mode || pending ? 'cancel' : 'close')}</Button>{mode && <Button className="rounded-full" disabled={disabled || !name.trim()} onClick={mode === 'new' ? create : rename}>{t(mode === 'new' ? 'create' : 'save')}</Button>}{pending && <Button className="rounded-full" disabled={disabled} onClick={commitImport}>{t('confirmImport', { count: pending.length })}</Button>}</DialogFooter>
 </DialogContent></Dialog>
 </section>;
}
