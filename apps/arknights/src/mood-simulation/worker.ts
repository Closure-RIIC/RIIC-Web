import { detailAt, simulate } from "./engine.ts";
import type { MoodSimulationInput, MoodSimulationResult, MoodWorkerRequest, MoodWorkerResponse } from "./types.ts";

let current: { input: MoodSimulationInput; result: MoodSimulationResult } | null = null;
self.onmessage = (event: MessageEvent<MoodWorkerRequest>) => {
  const request=event.data;
  const send=(response: MoodWorkerResponse) => self.postMessage(response);
  try {
    if (request.type === "simulate") {
      current=null;
      const result=simulate(request.input);
      current={input:request.input,result};
      send({id:request.id,type:"result",result});
    } else {
      if (!current) throw new Error("Simulation is not ready");
      send({id:request.id,type:"detail",name:request.name,time:request.time,rate:detailAt(current.input,current.result,request.time,request.name)});
    }
  } catch (error) {
    send({id:request.id,type:"error",message:error instanceof Error ? error.message : String(error)});
  }
};
