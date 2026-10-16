import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendLocalProfile,captureLocalProfile,emptyLocalProfile,ensureLocalProfiles,exportLocalProfiles,LOCAL_PROFILES_KEY,parseLocalProfilesFile,readLocalProfiles,saveActiveLocalProfile,switchLocalProfile,validateLocalProfileData} from './local-profiles.ts';
import {SESSION_KEY_V5} from './persistence.ts';
import {MANUAL_SCHEDULE_STORAGE_KEY,MOOD_STORAGE_KEY} from './manual-schedule-config.ts';
import {createManualScheduleDraft} from './manual-schedule.ts';
import {MOWER_EDITOR_STORAGE_KEY,createMowerEditorDocument} from './mower-editor.ts';
class Store {values=new Map<string,string>();failKey:string|null=null;getItem(key:string){return this.values.get(key)??null;}setItem(key:string,value:string){if(key===this.failKey){this.failKey=null;throw new Error('Quota exceeded');}this.values.set(key,value);}removeItem(key:string){this.values.delete(key);}}
const session={presetLabel:'243',layout:{template:'243',drone_cap:235,rooms:[],scenario:{}},operbox:[{id:'test',name:'阿米娅',own:true,elite:2,level:80}],sourceName:'test',boxSource:'maa',layoutDirty:true,layoutSource:'local',localLayoutBackup:null,rotationProfile:{},result:null,activeShift:0};
test('migrate current workbench without opting into local-only mode',()=>{
 const storage=new Store(),store=ensureLocalProfiles(storage,session,'默认档案');
 assert.equal(store.managed,false);assert.equal(store.profiles[0].data.session.operbox?.[0].name,'阿米娅');
 assert.equal(ensureLocalProfiles(storage,{...session,operbox:[]},'other').profiles.length,1);
});
test('switch isolates roster, manual plan, mood and Mower and clears old working keys',()=>{
 const storage=new Store();storage.setItem(MANUAL_SCHEDULE_STORAGE_KEY,JSON.stringify(createManualScheduleDraft()));storage.setItem(MOOD_STORAGE_KEY,JSON.stringify({signature:'a',settings:{}}));storage.setItem(MOWER_EDITOR_STORAGE_KEY,JSON.stringify(createMowerEditorDocument()));
 let store=ensureLocalProfiles(storage,session,'A');
 store=appendLocalProfile(store,'B',emptyLocalProfile(store.profiles[0].data),'b');
 store=switchLocalProfile(storage,store,'b');assert.equal(store.managed,true);
 assert.equal(JSON.parse(storage.getItem(SESSION_KEY_V5)!).operbox,null);
 assert.equal(storage.getItem(MANUAL_SCHEDULE_STORAGE_KEY),null);assert.equal(storage.getItem(MOOD_STORAGE_KEY),null);assert.equal(storage.getItem(MOWER_EDITOR_STORAGE_KEY),null);
 switchLocalProfile(storage,store,'default');assert.equal(JSON.parse(storage.getItem(SESSION_KEY_V5)!).operbox[0].name,'阿米娅');assert.ok(storage.getItem(MANUAL_SCHEDULE_STORAGE_KEY));assert.ok(storage.getItem(MOOD_STORAGE_KEY));assert.ok(storage.getItem(MOWER_EDITOR_STORAGE_KEY));
});
test('quota failure rolls working data and active profile back',()=>{
 const storage=new Store();let store=ensureLocalProfiles(storage,session,'A');storage.setItem(SESSION_KEY_V5,JSON.stringify(store.profiles[0].data.session));
 store=appendLocalProfile(store,'B',emptyLocalProfile(store.profiles[0].data),'b');const before=new Map(storage.values);storage.failKey=LOCAL_PROFILES_KEY;
 assert.throws(()=>switchLocalProfile(storage,store,'b'),/Quota/);assert.deepEqual(storage.values,before);
});
test('portable data excludes credentials and severs automatic Skland restore',()=>{
 const data=validateLocalProfileData({session:{...session,boxSource:'skland',cred:'secret',operbox:[{...session.operbox[0],accessToken:'secret'}],layout:{...session.layout,password:'secret'}},manual:null,mower:null,mood:{signature:'x',settings:{token:'secret',idle:{}}}});
 assert.equal(data.session.boxSource,'maa');assert.equal(data.session.layoutSource,'local');assert.ok(!JSON.stringify(data).includes('secret'));
});
test('versioned JSON round-trips without replacing existing profiles',()=>{
 const storage=new Store();const store=ensureLocalProfiles(storage,session,'A');const entries=parseLocalProfilesFile(JSON.stringify(exportLocalProfiles(store,true)));assert.equal(entries[0].name,'A');
 const next=appendLocalProfile(store,entries[0].name,entries[0].data,'new-id');assert.equal(next.profiles.length,2);assert.equal(next.activeId,'default');assert.equal(store.profiles.length,1);
 assert.throws(()=>parseLocalProfilesFile('{invalid'),/INVALID_FILE/);assert.throws(()=>parseLocalProfilesFile(JSON.stringify({format:'riic-local-profiles',version:999,profiles:[]})),/INVALID_FILE/);
 assert.throws(()=>parseLocalProfilesFile(JSON.stringify({format:'riic-local-profiles',version:1,profiles:[{name:'x',data:{session:{}}}]})),/INVALID_FILE/);
});
test('stale tabs cannot save into another active profile',()=>{
 const storage=new Store();let store=ensureLocalProfiles(storage,session,'A');store=appendLocalProfile(store,'B',emptyLocalProfile(store.profiles[0].data),'b');switchLocalProfile(storage,store,'b');
 assert.throws(()=>saveActiveLocalProfile(storage,session,'default'),/PROFILE_CHANGED/);assert.equal(readLocalProfiles(storage)?.activeId,'b');
});
test('profiles keep older snapshots beyond the rolling working-session TTL',()=>{
 const data=validateLocalProfileData({session:{...session,savedAt:'2020-01-01',expiresAt:'2020-01-02'},manual:null,mood:null,mower:null});assert.equal(data.session.operbox?.length,1);
 const storage=new Store();assert.equal(captureLocalProfile(storage,data.session).session.operbox?.length,1);
});

test('duplicate names are distinguished and profile count is bounded',()=>{
 const storage=new Store();let store=ensureLocalProfiles(storage,session,'A');const data=store.profiles[0].data;
 store=appendLocalProfile(store,'A',data,'second');assert.equal(store.profiles[1].name,'A (2)');
 for(let i=2;i<20;i++)store=appendLocalProfile(store,`P${i}`,data,`id${i}`);
 assert.throws(()=>appendLocalProfile(store,'extra',data,'overflow'),/PROFILE_LIMIT/);
});
