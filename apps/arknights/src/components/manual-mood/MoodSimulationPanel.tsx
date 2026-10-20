"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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
import { moodSummary, pointAt, segmentAt, shiftMoodSummaries } from "@/mood-simulation/presentation";
import { MOOD_STORAGE_KEY, pruneSettings, readSettings } from "@/mood-simulation/settings";
import { defaultMoodSettings, type MoodSettings, type MoodSimulationInput, type MoodSimulationResult, type MoodRate, type MoodWorkerResponse } from "@/mood-simulation/types";
import type { BaseBlueprint, OperBoxEntry } from "@/types";

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
export type MoodBoardState = {rows:RoomRow[];shift:number;cycle:number;moods:Record<string,number>;selected:string;onSelect:(name:string) => void};
export default function MoodSimulationPanel({layout,operbox,draft,fiammettaEnabled,onFiammettaEnabledChange,onTargetChange,renderBoard,settingsOpen,onSettingsOpenChange,view,onViewChange,posterContent}: {
  layout: BaseBlueprint; operbox: OperBoxEntry[]; draft: ManualScheduleDraft; fiammettaEnabled: boolean;
  onFiammettaEnabledChange: (enabled: boolean) => void;
  onTargetChange: (shift: number,target: string | null) => void;
  renderBoard: (simulation: MoodBoardState | null) => ReactNode;
  view?: string;
  onViewChange?: (value: string) => void;
  posterContent?: ReactNode;
  settingsOpen:boolean;
  onSettingsOpenChange:(open:boolean) => void;
}) {
  const t=useTranslations("MoodSimulation"),locale=useLocale(),gameCatalog=useGameCatalog();
  const controlId=useId();
  const [idleExpanded,setIdleExpanded]=useState<string[]>([]);
  const name=(n: string) => localizedOperatorName(n,locale,gameCatalog);
  const signature=JSON.stringify(draft.shifts.map(s => s.rooms));
  const [settings,setSettings]=useState<MoodSettings>(defaultMoodSettings);
  const [ready,setReady]=useState(false);
  const [localMode,setLocalMode]=useState("edit");
  const mode=view ?? localMode;
  const setMode=(value: string) => {setLocalMode(value);onViewChange?.(value);};
  const [result,setResult]=useState<MoodSimulationResult|null>(null);
  const [error,setError]=useState<string|null>(null),[storageWarning,setStorageWarning]=useState(false);
  const [pending,setPending]=useState(true),[cursor,setCursor]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [selected,setSelected]=useState(""),[query,setQuery]=useState("");
  const [detailState,setDetail]=useState<{name:string;time:number;rate:MoodRate}|null>(null);
  const detail=detailState?.name===selected && detailState.time===cursor ? detailState.rate : null;
  const worker=useRef<Worker|null>(null),requestId=useRef(0),detailId=useRef(0);
  const initialSignature=useRef(signature);
  const configScope=JSON.stringify({shifts:draft.shifts.length,names:[...new Set([...operbox.filter(o => o.own).map(o => o.name),...draft.shifts.flatMap(s => Object.values(s.rooms).flatMap(r => r.operators.filter(Boolean)))])],rooms:layout.rooms.filter(r => r.kind==="dormitory").map(r => r.id)});
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
  const calculationKey=JSON.stringify({...input,draft:{...draft,activeShift:0,startTime:"00:00"}});
  useEffect(() => {
    if (!ready) return;
    setPending(true);setPlaying(false);setCursor(0);setDetail(null);setError(null);
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
          } else if (response.type==="detail" && response.id===detailId.current) setDetail({name:response.name,time:response.time,rate:response.rate});
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
  },[calculationKey,ready]);
  useEffect(() => {
    if (pending || !result || !selected) return;
    const timer=setTimeout(() => worker.current?.postMessage({id:++detailId.current,type:"detail",time:cursor,name:selected}),0);
    return () => clearTimeout(timer);
  },[cursor,selected,pending,result,playing]);
  useEffect(() => {
    if (!playing || !result) return;
    const started=performance.now(),from=cursor;
    const timer=setInterval(() => {
      const next=Math.min(result.total,from+(performance.now()-started)/3600000*speed);
      setCursor(next);
      if (next>=result.total) setPlaying(false);
    },100);
    return () => clearInterval(timer);
    // Cursor is advanced by this clock; restarting the interval per tick loses elapsed time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,speed,result]);
  const moods=useMemo(() => result ? pointAt(result,cursor) : {},[result,cursor]);
  const segment=result ? segmentAt(result,cursor) : null;
  const rows=useMemo(() => {
    if (!segment) return [];
    const s=draft.shifts[segment.shift];
    if (!s) return [];
    const snapshot={...draft,shifts:[{...s,rooms:Object.fromEntries(Object.entries(segment.rooms).map(([id,operators]) => [id,{operators,autofill:false}]))}]};
    const maa=manualScheduleToMaa(snapshot,layout,false);
    const training=layout.rooms.find(r => r.kind==="training_room");
    const occupants=training ? segment.rooms[training.id] ?? [] : [];
    return addOperatorPresentations(planToRows(maa.plans[0],undefined,layout,training ? {trainee:occupants[0] ?? null,trainer:occupants[1] ?? null}:undefined));
  },[segment,draft,layout]);
  const roomName=(id: string) => {
    const row=rows.find(r => r.roomId===id);
    return row ? localizedRoomTitle(row.title,row.group,locale,gameCatalog) : id;
  };
  const stats=useMemo(() => result && selected ? moodSummary(result,selected) : null,[result,selected]);
  const shiftStats=useMemo(() => result && selected ? shiftMoodSummaries(result,selected) : [],[result,selected]);
  const chart=useMemo(() => result?.points.map(p => ({time:p.time,mood:p.moods[selected] ?? 24})) ?? [],[result,selected]);
  const graphEvents=useMemo(() => result?.events.filter(e => e.kind!=="skipped" && (e.operator===selected || e.target===selected)) ?? [],[result,selected]);
  const currentRoom=segment ? Object.entries(segment.rooms).find(([,names]) => names.includes(selected))?.[0] : null;
  const clock=(hours: number) => {
    const [h,m]=(draft.startTime || DEFAULT_MANUAL_SHIFT_START_TIME).split(":").map(Number),absolute=Math.round(hours*60)+(h ?? 0)*60+(m ?? 0);
    return `${Math.floor(absolute/1440)>0 ? `+${Math.floor(absolute/1440)}d `:""}${String(Math.floor(absolute/60)%24).padStart(2,"0")}:${String(absolute%60).padStart(2,"0")}`;
  };
  const names=result?.names ?? operbox.filter(o => o.own).map(o => o.name);
  const visibleNames=names.filter(n => n.toLowerCase().includes(query.toLowerCase()) || name(n).toLowerCase().includes(query.toLowerCase()));
  const valid=result && !pending && !error;
  const cycles=result?.cycleEnds ?? [];
  const stable=cycles.length>=2 && Object.keys(cycles[cycles.length-1]!).every(n => Math.abs(cycles[cycles.length-1]![n]!-cycles[cycles.length-2]![n]!)<1e-9);
  const bottleneck=result?.points.find(p => Object.values(p.moods).some(v => v===0));
  const setTime=(time: number) => {setMode("simulation");setPlaying(false);setCursor(time);};
  const updateIdle=(key: string,value: {enabled: boolean;target?: string;dorm?: string}) => setSettings(s => ({...s,idle:{...s.idle,[key]:value}}));
  return <section className="min-w-0 space-y-5" aria-label={t("title")} data-mood-simulation>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs value={mode} onValueChange={value => {setMode(String(value));setPlaying(false);}}>
        <TabsList aria-label={t("boardMode")}><TabsTrigger value="edit">{t("editMode")}</TabsTrigger><TabsTrigger value="simulation">{t("simulationMode")}</TabsTrigger>{onViewChange && <TabsTrigger value="poster">作业图</TabsTrigger>}</TabsList>
      </Tabs>
    </div>
    <div hidden={mode!=="poster"}>{posterContent}</div>
    <div hidden={mode==="poster"} className="space-y-5">
    {mode==="edit" ? renderBoard(null) : valid && segment ? renderBoard({rows,shift:segment.shift,cycle:segment.cycle,moods,selected,onSelect:setSelected}) : null}
    {/* Recalculation messages stay below the editor so its controls do not move under the pointer. */}
    {storageWarning && <p role="status" className="text-sm text-amber-700">{t("storageWarning")}</p>}
    {pending && <div role="status"><p className="text-sm text-muted-foreground">{t("calculating")}</p>{mode==="simulation" && <Skeleton className="mt-3 h-40 w-full"/>}</div>}
    {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{t("error",{message:error})}</p>}
    <div className="flex flex-wrap items-center gap-2" data-mood-playback-controls>
      <div className="flex items-center gap-2 text-sm"><span>{t("cycles")}</span><MoodSelect label={t("cycles")} className="w-20" value={String(settings.cycles)} onChange={value => setSettings(s => ({...s,cycles:Number(value)}))} options={[1,2,3,4,5,6,7].map(n => ({value:String(n),label:String(n)}))}/></div>
      <Button disabled={!valid} onClick={() => {setMode("simulation");if (cursor>=result!.total) setCursor(0);setPlaying(v => !v);}}>{playing?<Pause/>:<Play/>}{playing?t("pause"):t("play")}</Button>
      <Button variant="outline" disabled={!valid} onClick={() => setTime(0)}><RotateCcw/>{t("reset")}</Button>
      <MoodSelect label={t("speed")} className="w-28" value={String(speed)} onChange={value => setSpeed(Number(value))} options={[1,60,600,3600].map(n => ({value:String(n),label:`${n}×`}))}/>
      <output className="ml-auto font-number text-sm" data-mood-time>{clock(cursor)} / {clock(settings.cycles*24)}</output>
    </div>
    <input type="range" className="w-full accent-primary" aria-label={t("timeline")} min={0} max={settings.cycles*24} step={1/60} value={cursor} disabled={!valid}
      onChange={e => setTime(Number(e.target.value))} onKeyDown={e => {if(e.code==="Space"){e.preventDefault();setMode("simulation");setPlaying(v => !v);} else if(e.key==="ArrowRight" || e.key==="ArrowLeft"){e.preventDefault();setTime(Math.max(0,Math.min(settings.cycles*24,cursor+(e.key==="ArrowRight"?.25:-.25))));}}}/>
    {mode==="simulation" && valid && segment && <div className="space-y-5">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <span>{t("position",{cycle:segment.cycle+1,shift:segment.shift+1})}</span>
        <span>{cycles.length<2?t("needCycles"):stable?t("stable"):t("notStable")}</span>
        <span>{bottleneck?t("bottleneck",{time:clock(bottleneck.time),names:Object.entries(bottleneck.moods).filter(([,v]) => v===0).map(([n]) => name(n)).join("、")}):t("noRed")}</span>
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          <Input aria-label={t("search")} placeholder={t("search")} value={query} onChange={e => setQuery(e.target.value)}/>
          <ScrollArea className="max-h-72 xl:max-h-[440px]" viewportClassName="grid grid-cols-2 gap-1 xl:grid-cols-1" role="group" aria-label={t("operators")}>
            {visibleNames.map(n => <Button key={n} variant={selected===n?"secondary":"ghost"} aria-pressed={selected===n} className="justify-between gap-1 px-2" onClick={() => setSelected(n)}><span className="truncate">{name(n)}</span><span className={`font-number ${moods[n]===0?"text-destructive":"text-muted-foreground"}`}>{round(moods[n] ?? 24)}</span></Button>)}
          </ScrollArea>
        </div>
        <div className="min-w-0 space-y-3" data-mood-detail>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-medium">{name(selected)} <span className="font-number text-2xl">{round(moods[selected] ?? 24)}</span><span className="text-sm text-muted-foreground"> / 24</span></h3><span className="text-sm text-muted-foreground">{currentRoom?roomName(currentRoom):t("unassigned")}</span></div>
          <ChartContainer className="h-[280px] min-h-[280px] w-full sm:h-[320px]" config={{mood:{label:t("mood"),theme:{light:"oklch(0.58 0.14 166)",dark:"oklch(0.72 0.13 166)"}}}}>
            <LineChart accessibilityLayer data={chart} margin={{left:0,right:12,top:12,bottom:0}}>
              <CartesianGrid vertical={false} strokeDasharray="3 4"/><XAxis dataKey="time" type="number" domain={[0,result.total]} tickFormatter={clock} minTickGap={50} axisLine={false} tickLine={false} tickMargin={10}/><YAxis domain={[0,24]} ticks={[0,6,12,18,24]} width={30} axisLine={false} tickLine={false} tickMargin={8}/>
              <ChartTooltip cursor={{stroke:"var(--border)",strokeDasharray:"3 3"}} content={<ChartTooltipContent indicator="line" labelFormatter={(_label,payload) => clock(Number(payload[0]?.payload.time ?? 0))} formatter={value => <span className="font-number">{round(Number(value))} / 24</span>}/>}/>
              <ChartLegend content={<ChartLegendContent/>}/>
              {stats?.red.map(([a,b]) => <ReferenceArea key={a} x1={a} x2={b} fill="var(--destructive)" fillOpacity={.12}/>)}
              {result.segments.slice(1).map(s => <ReferenceLine key={s.start} x={s.start} stroke="var(--border)" strokeDasharray="3 3"/>)}
              {graphEvents.map((e,i) => <ReferenceLine key={i} x={e.time} stroke={e.kind==="idle"?"var(--chart-2)":"var(--chart-3)"} strokeDasharray="2 3"/>)}
              <Line type="linear" dataKey="mood" stroke="var(--color-mood)" strokeWidth={2} dot={false} isAnimationActive={false}/>
              <ReferenceLine x={cursor} stroke="var(--foreground)" strokeWidth={1.5}/>
            </LineChart>
          </ChartContainer>
          {stats && <p className="text-sm text-muted-foreground">{t("summary",{start:24,end:round(stats.end),min:round(stats.min),minTime:clock(stats.minTime),max:round(stats.max),maxTime:clock(stats.maxTime),red:round(stats.red.reduce((s,[a,b]) => s+b-a,0))})}</p>}
          <details><summary className="cursor-pointer text-sm text-muted-foreground">{t("shiftStats")}</summary>
            <ScrollArea direction="both" className="mt-2 max-h-48"><table className="w-full text-left text-sm"><thead><tr><th>{t("shiftLabel")}</th><th>{t("minimum")}</th><th>{t("meanNet")}</th></tr></thead><tbody>
              {shiftStats.map(s => <tr key={s.start}><td className="py-1">{t("position",{cycle:s.cycle+1,shift:s.shift+1})}</td><td className="font-number">{round(s.min)}</td><td className="font-number">{round(s.meanNet)}</td></tr>)}
            </tbody></table></ScrollArea>
          </details>
          {detail && <div className="space-y-2">
            <p className="text-sm">{t("rates",{consume:round(detail.consume),recover:round(detail.recover),net:round(detail.net)})}</p>
            <details><summary className="cursor-pointer text-sm text-muted-foreground">{t("ledger")}</summary><ScrollArea direction="both" className="mt-2 max-h-64 rounded-md border">
              <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">{t("source")}</th><th className="p-2">{t("effect")}</th><th className="p-2">{t("value")}</th></tr></thead><tbody>{detail.items.map((item,i) => <tr key={i} className={item.applied?"":"text-muted-foreground line-through"}><td className="p-2">{item.owner?name(item.owner):t("base")}{item.skill?` · ${localizedBuildingSkill(item.skill.split("#")[0]!,locale,{name:item.label,description:""},gameCatalog).name}`:""}</td><td className="p-2">{t(item.side==="consume"?"consume":"recover")}</td><td className="p-2 font-number">{round(item.value)}</td></tr>)}</tbody></table>
            </ScrollArea></details>
          </div>}
          <details><summary className="cursor-pointer text-sm text-muted-foreground">{t("events")}</summary><ScrollArea className="mt-2 max-h-48"><ul className="space-y-1 text-sm">{result.events.filter(e => e.operator===selected || e.target===selected).map((e,i) => <li key={i}><span className="font-number">{clock(e.time)}</span> · {t(e.kind)} · {name(e.operator)}{e.target?` → ${name(e.target)}`:""}{e.room?` · ${roomName(e.room)}`:""}{e.reason?` · ${t(e.reason)}`:""}</li>)}</ul></ScrollArea></details>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("assumptions")}{result.warnings.length>0 && t("missingTraining",{names:result.warnings.map(name).join("、")})}</p>
    </div>}
    </div>
    <Dialog open={settingsOpen} onOpenChange={onSettingsOpenChange}><DialogContent className="max-h-[90svh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(960px,calc(100vw-3rem))]"><DialogHeader><DialogTitle>{t("settings")}</DialogTitle><DialogDescription>{t("settingsDescription")}</DialogDescription></DialogHeader><ScrollArea><DialogBody className="space-y-6">
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
            {rule.mode==="specified" && <MoodSelect label={t("target",{n:i+1})} value={s.fiammettaTarget ?? ""} onChange={value => onTargetChange(i,value || null)} options={[{value:"",label:t("previous")},...names.filter(n => n!=="菲亚梅塔").map(n => ({value:n,label:name(n)}))]}/>}
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
    </DialogBody></ScrollArea></DialogContent></Dialog>
  </section>;
}
