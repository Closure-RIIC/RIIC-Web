"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_manual_mood_MoodSimulationPanel.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_manual_mood_MoodSimulationPanel");


import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Pause, Play, RotateCcw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody } from "@/components/ui/dialog";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { manualScheduleToMaa, type ManualScheduleDraft } from "@/manual-schedule";
import { DEFAULT_MANUAL_SHIFT_START_TIME } from "@/manual-schedule-config";
import { planToRows, type RoomRow } from "@/schedule";
import { addOperatorPresentations } from "@/schedule-presentation";
import { localizedBuildingSkill, localizedOperatorName, localizedRoomTitle } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { moodSummary, segmentAt, shiftMoodSummaries } from "@/mood-simulation/presentation";
import { MOOD_STORAGE_KEY, pruneSettings, readSettings } from "@/mood-simulation/settings";
import { defaultMoodSettings, type MoodSettings, type MoodSimulationInput, type MoodSimulationResult, type MoodWorkerResponse } from "@/mood-simulation/types";
import { MoodDetailStore, MoodPlaybackStore, MoodViewStore, MoodVisibilityStore, useMood, useMoodCursor, useMoodDetail } from "@/mood-view-store";
import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";

function MoodSelect({label,value,options,onChange,className="w-44"}: {
  label:string;value:string;options:{value:string;label:string}[];onChange:(value:string) => void;className?:string;
}) {
  const selected=options.find(option => option.value===value) ?? null;
  return <Combobox items={options} filteredItems={options} value={selected} inputValue={selected?.label ?? ""}
    itemToStringValue={option => option.label} isItemEqualToValue={(option,current) => option.value===current.value}
    onValueChange={option => {if(option) onChange(option.value);}}>
    <ComboboxInput aria-label={label} readOnly className={`h-9 max-w-full ${className}`}/>
    <ComboboxContent><ComboboxList>{option => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox>;
}
const round=(n: number) => Math.round(n*100)/100;

const OperatorMoodButton = memo(function OperatorMoodButton({operator,label,mood,selected,onSelect}: {
  operator:string;label:string;mood:number;selected:boolean;onSelect:(name:string) => void;
}) {
  return <Button variant={selected?"secondary":"ghost"} aria-pressed={selected} className="justify-between gap-1 px-2" onClick={() => onSelect(operator)}>
    <span className="truncate">{label}</span>
    <span className={`font-number ${mood===0?"text-destructive":"text-muted-foreground"}`}>{round(mood)}</span>
  </Button>;
});

const MoodAwareOperatorButton = memo(function MoodAwareOperatorButton({store,operator,label,selected,onSelect}: {
  store:MoodViewStore;operator:string;label:string;selected:boolean;onSelect:(name:string) => void;
}) {
  const mood=useMood(store,operator);
  return <OperatorMoodButton operator={operator} label={label} mood={mood} selected={selected} onSelect={onSelect}/>;
});

const MoodOperatorList = memo(function MoodOperatorList({store,names,selected,onSelect,name}: {
  store:MoodViewStore; names:string[]; selected:string; onSelect:(name:string) => void; name:(operator:string) => string;
}) {
  const t=useTranslations("MoodSimulation");
  const [query,setQuery]=useState("");
  const visibleNames=useMemo(() => names.filter(n => n.toLowerCase().includes(query.toLowerCase()) || name(n).toLowerCase().includes(query.toLowerCase())),[names,query,name]);
  return <div className="min-w-0 space-y-2">
    <Input aria-label={t("search")} placeholder={t("search")} value={query} onChange={e => setQuery(e.target.value)}/>
    <ScrollArea className="max-h-72 xl:max-h-[440px]" viewportClassName="grid grid-cols-2 gap-1 xl:grid-cols-1" role="group" aria-label={t("operators")}>
      {visibleNames.map(n => <MoodAwareOperatorButton key={n} store={store} operator={n} label={name(n)} selected={selected===n} onSelect={onSelect}/>)}
    </ScrollArea>
  </div>;
});

const MoodSelectedValue = memo(function MoodSelectedValue({store,name}: {store:MoodViewStore;name:string}) {
  const mood=useMood(store,name);
  return <>{round(mood)}</>;
});

const MoodCursorOverlay = memo(function MoodCursorOverlay({playback,width,total}: {playback:MoodPlaybackStore;width:number;total:number}) {
  const cursor=useMoodCursor(playback);
  if (width<=0 || total<=0) return null;
  const left=30+(Math.max(0,Math.min(cursor,total))/total)*Math.max(0,width-42);
  return <div aria-hidden className="pointer-events-none absolute w-[1.5px]" style={{left:`${left}px`,top:12,bottom:30,backgroundColor:"var(--foreground)"}}/>;
});

const MoodFrameWriter = function MoodFrameWriter({playback,result,store,moodAt,selected}: {
  playback:MoodPlaybackStore; result:MoodSimulationResult|null; store:MoodViewStore;
  moodAt:(name:string,time:number) => number; selected:string;
}) {
  useEffect(() => {
    const update=() => {
      if (!result) return;
      const cursor=playback.getCursor();
      store.setFrame(Object.fromEntries(result.names.map(name => [name,moodAt(name,cursor)])),selected);
    };
    update();
    return playback.subscribe(update);
  },[playback,result,store,moodAt,selected]);
  return null;
};

const MoodDetailRequester = function MoodDetailRequester({playback,result,selected,pending,requestDetail}: {
  playback:MoodPlaybackStore; result:MoodSimulationResult|null; selected:string; pending:boolean;
  requestDetail:(time:number,name:string) => void;
}) {
  useEffect(() => {
    if (pending || !result || !selected) return;
    let last="";
    const update=() => {
      let low=0,high=result.points.length;
      const cursor=playback.getCursor();
      while (low<high) {
        const middle=(low+high)>>1;
        if (result.points[middle]!.time<=cursor) low=middle+1;
        else high=middle;
      }
      const time=result.points[Math.max(0,low-1)]?.time ?? 0;
      const key=`${selected}:${time}`;
      if (key===last) return;
      last=key;
      requestDetail(time,selected);
    };
    update();
    return playback.subscribe(update);
  },[playback,result,selected,pending,requestDetail]);
  return null;
};

const MoodCurrentTime = memo(function MoodCurrentTime({playback,clock,total}: {playback:MoodPlaybackStore;clock:(hours:number) => string;total:number}) {
  const cursor=useMoodCursor(playback);
  return <output className="ml-auto font-number text-sm" data-mood-time>{clock(cursor)} / {clock(total)}</output>;
});

const MoodPlaybackToolbar = memo(function MoodPlaybackToolbar({playback,result,valid,settings,setSettings,playing,setPlaying,speed,setSpeed,setMode,clock}: {
  playback:MoodPlaybackStore; result:MoodSimulationResult|null; valid:boolean; settings:MoodSettings;
  setSettings:(updater:(current:MoodSettings) => MoodSettings) => void; playing:boolean; setPlaying:(updater:(playing:boolean) => boolean) => void;
  speed:number; setSpeed:(speed:number) => void; setMode:(mode:string) => void; clock:(hours:number) => string;
}) {
  const t=useTranslations("MoodSimulation");
  const total=result?.total ?? settings.cycles*24;
  return <div className="flex flex-wrap items-center gap-2" data-mood-playback-controls>
    <div className="flex items-center gap-2 text-sm"><span>{t("cycles")}</span><MoodSelect label={t("cycles")} className="w-20" value={String(settings.cycles)} onChange={value => setSettings(current => ({...current,cycles:Number(value)}))} options={[1,2,3,4,5,6,7].map(n => ({value:String(n),label:String(n)}))}/></div>
    <Button disabled={!valid} onClick={() => {setMode("simulation");if (playback.getCursor()>=total) playback.setCursor(0);setPlaying(v => !v);}}>{playing?<Pause/>:<Play/>}{playing?t("pause"):t("play")}</Button>
    <Button variant="outline" disabled={!valid} onClick={() => {setMode("simulation");setPlaying(() => false);playback.setCursor(0);}}><RotateCcw/>{t("reset")}</Button>
    <MoodSelect label={t("speed")} className="w-28" value={String(speed)} onChange={value => setSpeed(Number(value))} options={[1,60,600,3600].map(n => ({value:String(n),label:`${n}×`}))}/>
    <MoodCurrentTime playback={playback} clock={clock} total={total}/>
  </div>;
});

const MoodTimelineSlider = memo(function MoodTimelineSlider({playback,total,valid,setMode,setPlaying}: {
  playback:MoodPlaybackStore; total:number; valid:boolean; setMode:(mode:string) => void; setPlaying:(updater:(playing:boolean) => boolean) => void;
}) {
  const t=useTranslations("MoodSimulation");
  const cursor=useMoodCursor(playback);
  const setTime=(time:number) => {setMode("simulation");setPlaying(() => false);playback.setCursor(time);};
  return <input type="range" className="w-full accent-primary" aria-label={t("timeline")} min={0} max={total} step={1/60} value={cursor} disabled={!valid}
    onChange={e => setTime(Number(e.target.value))} onKeyDown={e => {if(e.code==="Space"){e.preventDefault();setMode("simulation");setPlaying(v => !v);} else if(e.key==="ArrowRight" || e.key==="ArrowLeft"){e.preventDefault();setTime(Math.max(0,Math.min(total,cursor+(e.key==="ArrowRight"?.25:-.25))));}}}/>;
});

const MoodShiftStats = memo(function MoodShiftStats({stats}: {
  stats:{start:number;cycle:number;shift:number;min:number;meanNet:number}[];
}) {
  const t=useTranslations("MoodSimulation");
  return <details><summary className="cursor-pointer text-sm text-muted-foreground">{t("shiftStats")}</summary>
    <ScrollArea direction="both" className="mt-2 max-h-48"><table className="w-full text-left text-sm"><thead><tr><th>{t("shiftLabel")}</th><th>{t("minimum")}</th><th>{t("meanNet")}</th></tr></thead><tbody>
      {stats.map(s => <tr key={s.start}><td className="py-1">{t("position",{cycle:s.cycle+1,shift:s.shift+1})}</td><td className="font-number">{round(s.min)}</td><td className="font-number">{round(s.meanNet)}</td></tr>)}
    </tbody></table></ScrollArea>
  </details>;
});

const MoodEventsList = memo(function MoodEventsList({events,name,roomName,clock}: {
  events:MoodSimulationResult["events"];
  name:(operator:string) => string;
  roomName:(room:string) => string;
  clock:(hours:number) => string;
}) {
  const t=useTranslations("MoodSimulation");
  return <details><summary className="cursor-pointer text-sm text-muted-foreground">{t("events")}</summary><ScrollArea className="mt-2 max-h-48"><ul className="space-y-1 text-sm">{events.map((e,i) => <li key={i}><span className="font-number">{clock(e.time)}</span> · {t(e.kind)} · {name(e.operator)}{e.target?` → ${name(e.target)}`:""}{e.room?` · ${roomName(e.room)}`:""}{e.reason?` · ${t(e.reason)}`:""}</li>)}</ul></ScrollArea></details>;
});

const MoodChart = memo(function MoodChart({chart,total,clock,red,segments,events,moodLabel}: {
  chart: {time:number;mood:number}[];
  total: number;
  clock: (hours: number) => string;
  red?: [number,number][];
  segments: MoodSimulationResult["segments"];
  events: MoodSimulationResult["events"];
  moodLabel: string;
}) {
  return <ChartContainer className="h-[280px] min-h-[280px] w-full sm:h-[320px]" config={{mood:{label:moodLabel,theme:{light:"oklch(0.58 0.14 166)",dark:"oklch(0.72 0.13 166)"}}}}>
    <LineChart accessibilityLayer data={chart} margin={{left:0,right:12,top:12,bottom:0}}>
      <CartesianGrid vertical={false} strokeDasharray="3 4"/><XAxis dataKey="time" type="number" domain={[0,total]} tickFormatter={clock} minTickGap={50} axisLine={false} tickLine={false} tickMargin={10}/><YAxis domain={[0,24]} ticks={[0,6,12,18,24]} width={30} axisLine={false} tickLine={false} tickMargin={8}/>
      <ChartTooltip cursor={{stroke:"var(--border)",strokeDasharray:"3 3"}} content={<ChartTooltipContent indicator="line" labelFormatter={(_label,payload) => clock(Number(payload[0]?.payload.time ?? 0))} formatter={value => <span className="font-number">{round(Number(value))} / 24</span>}/>}/>
      <ChartLegend content={<ChartLegendContent/>}/>
      {red?.map(([a,b]) => <ReferenceArea key={a} x1={a} x2={b} fill="var(--destructive)" fillOpacity={.12}/>)}
      {segments.slice(1).map(s => <ReferenceLine key={s.start} x={s.start} stroke="var(--border)" strokeDasharray="3 3"/>)}
      {events.map((e,i) => <ReferenceLine key={i} x={e.time} stroke={e.kind==="idle"?"var(--chart-2)":"var(--chart-3)"} strokeDasharray="2 3"/>)}
      <Line type="linear" dataKey="mood" stroke="var(--color-mood)" strokeWidth={2} dot={false} isAnimationActive={false}/>
    </LineChart>
  </ChartContainer>;
});
const MoodDetailPanel = memo(function MoodDetailPanel({store,selected,name}: {
  store: MoodDetailStore; selected: string; name: (operator: string) => string;
}) {
  const t=useTranslations("MoodSimulation"), locale=useLocale(), gameCatalog=useGameCatalog();
  const state=useMoodDetail(store);
  const detail=state?.name===selected ? state.rate : null;
  if (!detail) return null;
  return <div className="space-y-2">
    <p className="text-sm">{t("rates",{consume:round(detail.consume),recover:round(detail.recover),net:round(detail.net)})}</p>
    <details><summary className="cursor-pointer text-sm text-muted-foreground">{t("ledger")}</summary><ScrollArea direction="both" className="mt-2 max-h-64 rounded-md border">
      <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">{t("source")}</th><th className="p-2">{t("effect")}</th><th className="p-2">{t("value")}</th></tr></thead><tbody>{detail.items.map((item,i) => <tr key={i} className={item.applied?"":"text-muted-foreground line-through"}><td className="p-2">{item.owner?name(item.owner):t("base")}{item.skill?` · ${localizedBuildingSkill(item.skill.split("#")[0]!,locale,{name:item.label,description:""},gameCatalog).name}`:""}</td><td className="p-2">{t(item.side==="consume"?"consume":"recover")}</td><td className="p-2 font-number">{round(item.value)}</td></tr>)}</tbody></table>
    </ScrollArea></details>
  </div>;
});

export type MoodBoardState = {rows:RoomRow[];shift:number;cycle:number;store:MoodViewStore;selected:string;onSelect:(name:string) => void};
export default function MoodSimulationPanel({layout,operbox,draft,fiammettaEnabled,onFiammettaEnabledChange,onTargetChange,renderBoard,settingsOpen,onSettingsOpenChange,view,onViewChange,posterContent}: {
  layout: BaseBlueprint; operbox: OperBoxEntry[]; draft: ManualScheduleDraft; fiammettaEnabled: boolean;
  onFiammettaEnabledChange: (enabled: boolean) => void;
  onTargetChange: (shift: number,target: string | null) => void;
  renderBoard: (simulation: MoodBoardState | null, visibility?: MoodVisibilityStore) => ReactNode;
  view?: string;
  onViewChange?: (value: string) => void;
  posterContent?: ReactNode;
  settingsOpen:boolean;
  onSettingsOpenChange:(open:boolean) => void;
}) {
  const rawLocale = useRawLocale();
  const t=useTranslations("MoodSimulation"),locale=useLocale(),gameCatalog=useGameCatalog();
  const controlId=useId();
  const chartRef=useRef<HTMLDivElement|null>(null);
  const [chartWidth,setChartWidth]=useState(0);
  const [idleExpanded,setIdleExpanded]=useState<string[]>([]);
  const name=useCallback((n: string) => localizedOperatorName(n,locale,gameCatalog),[locale,gameCatalog]);
  const signature=useMemo(() => JSON.stringify(draft.shifts.map(s => s.rooms)),[draft.shifts]);
  const [settings,setSettings]=useState<MoodSettings>(defaultMoodSettings);
  const [ready,setReady]=useState(false);
  const [localMode,setLocalMode]=useState("edit");
  const mode=view ?? localMode;
  const setMode=(value: string) => {setLocalMode(value);onViewChange?.(value);};
  const [result,setResult]=useState<MoodSimulationResult|null>(null);
  const [error,setError]=useState<string|null>(null),[storageWarning,setStorageWarning]=useState(false);
  const [pending,setPending]=useState(true),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [selected,setSelected]=useState("");
  const [playback]=useState(() => new MoodPlaybackStore());
  const [moodStore]=useState(() => new MoodViewStore(setSelected));
  const [detailStore]=useState(() => new MoodDetailStore());
  const worker=useRef<Worker|null>(null),requestId=useRef(0),detailId=useRef(0);
  const requestDetail=useCallback((time:number,name:string) => {
    worker.current?.postMessage({id:++detailId.current,type:"detail",time,name});
  },[]);
  const initialSignature=useRef(signature);
  const configScope=useMemo(() => JSON.stringify({shifts:draft.shifts.length,names:[...new Set([...operbox.filter(o => o.own).map(o => o.name),...draft.shifts.flatMap(s => Object.values(s.rooms).flatMap(r => r.operators.filter(Boolean)))])],rooms:layout.rooms.filter(r => r.kind==="dormitory").map(r => r.id)}),[draft.shifts,operbox,layout.rooms]);
  useEffect(() => {
    const element=chartRef.current;
    if (!element) return;
    const update=()=>setChartWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver==="undefined") return;
    const observer=new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  },[result,mode,pending]);
  useEffect(() => {
    try {setSettings(readSettings(localStorage.getItem(MOOD_STORAGE_KEY),initialSignature.current));} catch {setStorageWarning(true);}
    setReady(true);
  },[]);
  useEffect(() => {
    const scope=JSON.parse(configScope) as {shifts:number;names:string[];rooms:string[]};
    setSettings(current => {
      const next=pruneSettings(current,scope.shifts,new Set(scope.names),new Set(scope.rooms));
      return JSON.stringify(next)===JSON.stringify(current) ? current : next;
    });
  },[configScope,settings.cycles]);
  useEffect(() => {
    if (!ready) return;
    try {localStorage.setItem(MOOD_STORAGE_KEY,JSON.stringify({signature,settings}));} catch {setStorageWarning(true);}
  },[ready,signature,settings]);
  const input=useMemo<MoodSimulationInput>(() => ({layout,operbox,draft,settings,fiammettaEnabled}),[layout,operbox,draft,settings,fiammettaEnabled]);
  // The active editor tab and display start clock must not trigger a new calculation.
  const calculationKey=useMemo(() => JSON.stringify({...input,draft:{...draft,activeShift:0,startTime:"00:00"}}),[input,draft]);
  useEffect(() => {
    if (!ready) return;
    setPending(true);setPlaying(false);playback.setCursor(0);detailStore.set(null);setError(null);
    const id=++requestId.current;
    const timer=setTimeout(() => {
      try {
        const next=new Worker(new URL("../../mood-simulation/worker.ts",import.meta.url),{type:"module"});
        worker.current=next;
        next.onmessage=(event: MessageEvent<MoodWorkerResponse>) => {
          if (id!==requestId.current || worker.current!==next) return;
          const response=event.data;
          if (response.type==="result" && response.id===id) {
            setResult(response.result);setPending(false);
            setSelected(current => response.result.names.includes(current) ? current : response.result.names[0] ?? "");
          } else if (response.type==="detail" && response.id===detailId.current) detailStore.set({name:response.name,time:response.time,rate:response.rate});
          else if (response.type==="error") {setError(response.message);setPending(false);setPlaying(false);}
        };
        next.onerror=(event) => {
          // Terminating an obsolete worker can report aborted chunk loads later.
          if (id!==requestId.current || worker.current!==next) return;
          setError(event.message || "Worker failed");setPending(false);setPlaying(false);
        };
        next.postMessage({id,type:"simulate",input:JSON.parse(calculationKey)});
      } catch (cause) {setError(String(cause));setPending(false);}
    },250);
    return () => {
      clearTimeout(timer);
      if (worker.current) {worker.current.onmessage=null;worker.current.onerror=null;worker.current.terminate();worker.current=null;}
    };
  },[calculationKey,ready,detailStore,playback]);
  useEffect(() => {
    if (!playing || !result) return;
    const started=performance.now(),from=playback.getCursor();
    const timer=setInterval(() => {
      const next=Math.min(result.total,from+(performance.now()-started)/3600000*speed);
      playback.setCursor(next);
      if (next>=result.total) setPlaying(false);
    },100);
    return () => clearInterval(timer);
    // Cursor is advanced by this clock; restarting the interval per tick loses elapsed time.
  },[playing,speed,result,playback]);
  const seriesByName=useMemo(() => {
    const map=new Map<string,{time:number;mood:number}[]>();
    for (const group of result?.series ?? []) for (const name of group.names) map.set(name,group.points);
    return map;
  },[result]);
  const moodAt=useCallback((name: string,time: number) => {
    const points=seriesByName.get(name);
    if (!points?.length) return 24;
    let low=0,high=points.length;
    while (low<high) {
      const middle=(low+high)>>1;
      if (points[middle]!.time<=time) low=middle+1;
      else high=middle;
    }
    const before=points[low-1],after=points[low];
    if (!before) return after?.mood ?? 24;
    if (!after || after.time===before.time) return before.mood;
    return before.mood+(after.mood-before.mood)*(time-before.time)/(after.time-before.time);
  },[seriesByName]);
  const segment=useSyncExternalStore(
    playback.subscribe,
    useCallback(() => result ? segmentAt(result,playback.getCursor()) : null,[result,playback]),
    () => null,
  );
  // Build every shift's rows once when the worker result arrives. Switching
  // shifts is then a map lookup instead of rebuilding MAA rows during playback.
  const rowsBySegment=useMemo(() => {
    const map=new Map<number,RoomRow[]>(), cache=new Map<string,RoomRow[]>(), rowCache=new Map<string,RoomRow>();
    const training=layout.rooms.find(r => r.kind==="training_room");
    for (const item of result?.segments ?? []) {
      const key=JSON.stringify(item.rooms);
      const cached=cache.get(key);
      if (cached) {map.set(item.start,cached);continue;}
      const s=draft.shifts[item.shift];
      if (!s) {map.set(item.start,[]);continue;}
      const snapshot={...draft,shifts:[{...s,rooms:Object.fromEntries(Object.entries(item.rooms).map(([id,operators]) => [id,{operators,autofill:false}]))}]};
      const maa=manualScheduleToMaa(snapshot,layout,false);
      const occupants=training ? item.rooms[training.id] ?? [] : [];
      const built=addOperatorPresentations(planToRows(maa.plans[0],undefined,layout,training ? {trainee:occupants[0] ?? null,trainer:occupants[1] ?? null}:undefined));
      const reused=built.map(row => {
        const rowKey=JSON.stringify(row), existing=rowCache.get(rowKey);
        if (existing) return existing;
        rowCache.set(rowKey,row);return row;
      });
      cache.set(key,reused);
      map.set(item.start,reused);
    }
    return map;
  },[result,draft,layout]);
  const rows=useMemo(() => segment ? rowsBySegment.get(segment.start) ?? [] : [],[segment,rowsBySegment]);
  const layerStarts=useMemo(() => (result?.segments ?? []).map(item => item.start),[result]);
  const segmentsByStart=useMemo(() => new Map((result?.segments ?? []).map(item => [item.start,item])),[result]);
  const visibilityStores=useMemo(() => new Map(layerStarts.map(start => [start,new MoodVisibilityStore(false)])),[layerStarts]);
  const visibilityFor=useCallback((start:number) => visibilityStores.get(start)!, [visibilityStores]);
  useLayoutEffect(() => {
    for (const start of layerStarts) visibilityFor(start).setVisible(start===segment?.start);
  },[layerStarts,segment?.start,visibilityFor]);
  const roomName=useCallback((id: string) => {
    const row=rows.find(r => r.roomId===id);
    return row ? localizedRoomTitle(row.title,row.group,locale,gameCatalog) : id;
  },[rows,locale,gameCatalog]);
  const stats=useMemo(() => result && selected ? moodSummary(result,selected) : null,[result,selected]);
  const shiftStats=useMemo(() => result && selected ? shiftMoodSummaries(result,selected) : [],[result,selected]);
  const chart=useMemo(() => result?.points.map(point => ({time:point.time,mood:point.moods[selected] ?? 24})) ?? [],[result,selected]);
  const graphEvents=useMemo(() => result?.events.filter(e => e.kind!=="skipped" && (e.operator===selected || e.target===selected)) ?? [],[result,selected]);
  const selectedEvents=useMemo(() => result?.events.filter(e => e.operator===selected || e.target===selected) ?? [],[result,selected]);
  const currentRoom=useMemo(() => segment ? Object.entries(segment.rooms).find(([,names]) => names.includes(selected))?.[0] : null,[segment,selected]);
  const clock=useCallback((hours: number) => {
    const [h,m]=(draft.startTime || DEFAULT_MANUAL_SHIFT_START_TIME).split(":").map(Number),absolute=Math.round(hours*60)+(h ?? 0)*60+(m ?? 0);
    return `${Math.floor(absolute/1440)>0 ? `+${Math.floor(absolute/1440)}d `:""}${String(Math.floor(absolute/60)%24).padStart(2,"0")}:${String(absolute%60).padStart(2,"0")}`;
  },[draft.startTime]);
  const names=useMemo(() => result?.names ?? operbox.filter(o => o.own).map(o => o.name),[result,operbox]);
  const targetOptions=useMemo(() => names.filter(n => n!=="菲亚梅塔").map(n => ({value:n,label:name(n)})),[names,name]);
  const valid=result && !pending && !error;
  const cycles=useMemo(() => result?.cycleEnds ?? [], [result]);
  const stable=useMemo(() => cycles.length>=2 && Object.keys(cycles[cycles.length-1]!).every(n => Math.abs(cycles[cycles.length-1]![n]!-cycles[cycles.length-2]![n]!)<1e-9),[cycles]);
  const bottleneck=useMemo(() => result?.points.find(p => Object.values(p.moods).some(v => v===0)),[result]);
  const updateIdle=(key: string,value: {enabled: boolean;target?: string;dorm?: string}) => setSettings(s => ({...s,idle:{...s.idle,[key]:value}}));
  return <section className="min-w-0 space-y-5" aria-label={t("title")} data-mood-simulation>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs value={mode} onValueChange={value => {setMode(String(value));setPlaying(false);}}>
        <TabsList aria-label={t("boardMode")}><TabsTrigger value="edit">{t("editMode")}</TabsTrigger><TabsTrigger value="simulation">{t("simulationMode")}</TabsTrigger>{onViewChange && <TabsTrigger value="poster">{rawText.text(rawLocale, "schedulePoster")}</TabsTrigger>}</TabsList>
      </Tabs>
    </div>
    <div hidden={mode!=="poster"}>{posterContent}</div>
    <div hidden={mode==="poster"} className="space-y-5">
    {mode==="edit" ? renderBoard(null) : valid && segment ? (
      <div className="grid">
        {layerStarts.map(start => {
          const item=segmentsByStart.get(start);
          if (!item) return null;
          const active=start===segment.start;
          const layerRows=active ? rows : rowsBySegment.get(start) ?? [];
          return <div key={start} aria-hidden={!active} style={{gridArea:"1 / 1",visibility:active?"visible":"hidden",pointerEvents:active?"auto":"none"}}>
            {renderBoard({rows:layerRows,shift:item.shift,cycle:item.cycle,store:moodStore,selected,onSelect:setSelected},visibilityFor(start))}
          </div>;
        })}
      </div>
    ) : null}
    {/* Recalculation messages stay below the editor so its controls do not move under the pointer. */}
    {storageWarning && <p role="status" className="text-sm text-amber-700">{t("storageWarning")}</p>}
    {pending && <div role="status"><p className="text-sm text-muted-foreground">{t("calculating")}</p>{mode==="simulation" && <Skeleton className="mt-3 h-40 w-full"/>}</div>}
    {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{t("error",{message:error})}</p>}
    <MoodFrameWriter playback={playback} result={result} store={moodStore} moodAt={moodAt} selected={selected}/>
    <MoodDetailRequester playback={playback} result={result} selected={selected} pending={pending} requestDetail={requestDetail}/>
    <MoodPlaybackToolbar playback={playback} result={result} valid={Boolean(valid)} settings={settings} setSettings={setSettings} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} setMode={setMode} clock={clock}/>
    <MoodTimelineSlider playback={playback} total={result?.total ?? settings.cycles*24} valid={Boolean(valid)} setMode={setMode} setPlaying={setPlaying}/>
    {mode==="simulation" && valid && segment && <div className="space-y-5">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <span>{t("position",{cycle:segment.cycle+1,shift:segment.shift+1})}</span>
        <span>{cycles.length<2?t("needCycles"):stable?t("stable"):t("notStable")}</span>
        <span>{bottleneck?t("bottleneck",{time:clock(bottleneck.time),names:Object.entries(bottleneck.moods).filter(([,v]) => v===0).map(([n]) => name(n)).join("、")}):t("noRed")}</span>
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          <MoodOperatorList store={moodStore} names={names} selected={selected} onSelect={setSelected} name={name}/>
        </div>
        <div className="min-w-0 space-y-3" data-mood-detail>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-medium">{name(selected)} <span className="font-number text-2xl"><MoodSelectedValue store={moodStore} name={selected}/></span><span className="text-sm text-muted-foreground"> / 24</span></h3><span className="text-sm text-muted-foreground">{currentRoom?roomName(currentRoom):t("unassigned")}</span></div>
          <div className="relative" ref={chartRef}>
            <MoodChart chart={chart} total={result.total} clock={clock} red={stats?.red} segments={result.segments} events={graphEvents} moodLabel={t("mood")}/>
            <MoodCursorOverlay playback={playback} width={chartWidth} total={result.total}/>
          </div>
          {stats && <p className="text-sm text-muted-foreground">{t("summary",{start:24,end:round(stats.end),min:round(stats.min),minTime:clock(stats.minTime),max:round(stats.max),maxTime:clock(stats.maxTime),red:round(stats.red.reduce((s,[a,b]) => s+b-a,0))})}</p>}
          <MoodShiftStats stats={shiftStats}/>
          <MoodDetailPanel store={detailStore} selected={selected} name={name}/>
          <MoodEventsList events={selectedEvents} name={name} roomName={roomName} clock={clock}/>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("assumptions")}{result.warnings.length>0 && t("missingTraining",{names:result.warnings.map(name).join("、")})}</p>
    </div>}
    </div>
    {settingsOpen && <Dialog open={settingsOpen} onOpenChange={onSettingsOpenChange}><DialogContent className="max-h-[90svh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(960px,calc(100vw-3rem))]"><DialogHeader><DialogTitle>{t("settings")}</DialogTitle><DialogDescription>{t("settingsDescription")}</DialogDescription></DialogHeader><ScrollArea><DialogBody className="space-y-6">
      <fieldset className="space-y-3"><legend className="font-medium">{t("fiammetta")}</legend>
        <div className="flex min-h-11 items-center justify-between gap-4"><Label htmlFor={`${controlId}-fiammetta`} className="leading-5">{t("fiammettaEnabled")}</Label><Switch id={`${controlId}-fiammetta`} checked={fiammettaEnabled} onCheckedChange={onFiammettaEnabledChange}/></div>
        <p className="text-xs text-muted-foreground">{t("simulationOnly")}</p>
        {draft.shifts.map((s,i) => {
          const rule=settings.fiammetta[i] ?? {enabled:true,mode:"specified" as const,wait:false};
          const update=(patch: Partial<typeof rule>) => setSettings(current => ({...current,fiammetta:{...current.fiammetta,[i]:{...rule,...patch}}}));
          return <div key={i} className="space-y-3 rounded-lg border p-3">
            <div className="flex min-h-9 items-center justify-between gap-4"><Label htmlFor={`${controlId}-shift-${i}`}>{t("shift",{n:i+1})}</Label><Switch id={`${controlId}-shift-${i}`} checked={rule.enabled} onCheckedChange={enabled => update({enabled})}/></div>
            <div className="flex flex-wrap gap-3">
            <MoodSelect label={t("targetMode",{n:i+1})} value={rule.mode} onChange={value => update({mode:value as typeof rule.mode})} options={[{value:"specified",label:t("specified")},{value:"previous",label:t("previous")},{value:"auto",label:t("autoTarget")}]}/>
            {rule.mode==="specified" && <MoodSelect label={t("target",{n:i+1})} value={s.fiammettaTarget ?? ""} onChange={value => onTargetChange(i,value || null)} options={[{value:"",label:t("previous")},...targetOptions]}/>}
            </div>
            <div className="flex min-h-9 items-center justify-between gap-4"><Label htmlFor={`${controlId}-wait-${i}`} className="leading-5">{t("wait")}</Label><Switch id={`${controlId}-wait-${i}`} checked={rule.wait} onCheckedChange={wait => update({wait})}/></div>
          </div>;
        })}
      </fieldset>
      <fieldset className="space-y-3"><legend className="font-medium">{t("idle")}</legend>
        <div className="flex min-h-11 items-center justify-between gap-4"><Label htmlFor={`${controlId}-idle`} className="leading-5">{t("idleEnabled")}</Label><Switch id={`${controlId}-idle`} checked={settings.idleEnabled} onCheckedChange={idleEnabled => setSettings(s => ({...s,idleEnabled}))}/></div>
        <p className="text-xs text-muted-foreground">{t("idleRules")}</p>
        {pending && <p role="status" className="text-sm text-muted-foreground">{t("calculating")}</p>}
        <Accordion multiple value={idleExpanded} onValueChange={values => setIdleExpanded(values.map(String))}>
        {!pending && settings.idleEnabled && result?.segments.map(s => {
          const candidates=result.idleCandidates.filter(c => c.cycle===s.cycle && c.shift===s.shift);
          if (!candidates.length) return null;
          return <AccordionItem key={s.start} value={String(s.start)}><AccordionTrigger>{t("position",{cycle:s.cycle+1,shift:s.shift+1})} · {candidates.length}</AccordionTrigger><AccordionPanel className="space-y-3 p-3">
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setSettings(current => ({...current,idle:{...current.idle,...Object.fromEntries(candidates.map(c => [`${c.cycle}:${c.shift}:${c.operator}`,{...current.idle[`${c.cycle}:${c.shift}:${c.operator}`],enabled:true}]))}}))}>{t("all")}</Button><Button variant="outline" size="sm" onClick={() => setSettings(current => ({...current,idle:{...current.idle,...Object.fromEntries(candidates.map(c => [`${c.cycle}:${c.shift}:${c.operator}`,{...current.idle[`${c.cycle}:${c.shift}:${c.operator}`],enabled:false}]))}}))}>{t("none")}</Button></div>
            {candidates.map(c => {
              const key=`${c.cycle}:${c.shift}:${c.operator}`,rule=settings.idle[key] ?? {enabled:true};
              return <div key={key} className="space-y-2 border-t pt-3"><div className="flex min-h-9 items-center justify-between gap-4"><Label htmlFor={`${controlId}-idle-${key}`}>{name(c.operator)} <span className="font-number text-muted-foreground">{round(c.mood)}</span></Label><Switch id={`${controlId}-idle-${key}`} checked={rule.enabled} onCheckedChange={enabled => updateIdle(key,{...rule,enabled})}/></div>
                <MoodSelect label={t("idleTarget",{name:name(c.operator)})} value={rule.dorm?`dorm:${rule.dorm}`:rule.target?`op:${rule.target}`:""}
                  onChange={value => updateIdle(key,{enabled:rule.enabled,...(value.startsWith("dorm:")?{dorm:value.slice(5)}:value.startsWith("op:")?{target:value.slice(3)}:{})})}
                  options={[{value:"",label:t("automatic")},...c.options.flatMap(r => [...(r.free?[{value:`dorm:${r.room}`,label:`${roomName(r.room)} · ${t("vacancy")}`}]:[]),...r.operators.map(o => ({value:`op:${o.name}`,label:`${name(o.name)} · ${round(o.mood)}`}))])]}/>
              </div>;
            })}
          </AccordionPanel></AccordionItem>;
        })}
        </Accordion>
        {!pending && !result?.idleCandidates.length && <p className="text-sm text-muted-foreground">{t("noIdle")}</p>}
      </fieldset>
    </DialogBody></ScrollArea></DialogContent></Dialog>}
  </section>;
}
