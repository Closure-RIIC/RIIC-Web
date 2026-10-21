import type { MoodSimulationResult } from "./types.ts";
export function pointAt(result: MoodSimulationResult,time: number) {
  const t=Math.max(0,Math.min(result.total,time));
  let lo=0,hi=result.points.length;
  while (lo<hi) {const mid=(lo+hi)>>>1;if (result.points[mid]!.time<=t) lo=mid+1;else hi=mid;}
  const a=result.points[Math.max(0,lo-1)]!,b=result.points[lo];
  if (!b || b.time===a.time) return a.moods;
  const ratio=(t-a.time)/(b.time-a.time);
  return Object.fromEntries(result.names.map(n => [n,a.moods[n]!+(b.moods[n]!-a.moods[n]!)*ratio]));
}
export function segmentAt(result: MoodSimulationResult,time: number) {
  return result.segments.find(s => s.start<=time && s.end>time) ?? result.segments[result.segments.length-1]!;
}

export function moodSummary(result: MoodSimulationResult, name: string) {
  let min=24,max=0,minTime=0,maxTime=0;
  const red: [number,number][]=[];
  for (let i=0;i<result.points.length;i++) {
    const p=result.points[i]!,v=p.moods[name] ?? 24;
    if (v<min) {min=v;minTime=p.time;}
    if (v>max) {max=v;maxTime=p.time;}
    const next=result.points[i+1];
    if (v===0 && next && next.moods[name]===0 && next.time>p.time) {
      const last=red[red.length-1];
      if (last && last[1]===p.time) last[1]=next.time; else red.push([p.time,next.time]);
    }
  }
  return {min,max,minTime,maxTime,red,end:result.points[result.points.length-1]!.moods[name] ?? 24};
}

export function shiftMoodSummaries(result: MoodSimulationResult, name: string) {
  return result.segments.map(segment => {
    let min=pointAt(result,segment.start)[name] ?? 24,drain=0;
    for (let i=0;i<result.points.length-1;i++) {
      const a=result.points[i]!,b=result.points[i+1]!;
      // Same-time jumps are events, not hourly consumption.
      if (a.time<segment.start || b.time>segment.end || b.time<=a.time) continue;
      min=Math.min(min,a.moods[name] ?? 24,b.moods[name] ?? 24);
      drain+=(a.moods[name] ?? 24)-(b.moods[name] ?? 24);
    }
    return {...segment,min,meanNet:drain/(segment.end-segment.start)};
  });
}
