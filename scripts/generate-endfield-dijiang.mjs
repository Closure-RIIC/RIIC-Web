/**
 * Simplified Dijiang exterior, built with Anatomy (build-time only).
 * Build: node scripts/generate-endfield-dijiang.mjs --anatomy <checkout> --audit
 *
 * References, inspected 2026-10-21:
 * Official archive: https://x.com/AKEndfieldJP/status/1881899598140301765
 * In-game Reception Room schematic:
 * https://www.reddit.com/r/Endfield/comments/1pb9mgt/
 *
 * Hero: an elongated open frame surrounding the dark Protorig core, transverse
 * reinforcement hoops, a concentrated engineering belt and a pointed command
 * spire. These are simplified reference proportions, not game model dimensions.
 * Assemblies: four latticed longitudinal spars, four segmented hoops and their
 * suspension arms; faceted Protorig core and stabilizer; paired utility conduits
 * with real end couplings; engineering belt, armored bays and stiffeners;
 * command neck, service deck, spire, tower, attached equipment and sensor masts.
 * Rivets, seams, recessed vents and inspection markings are surface details.
 * Only the enclosed Protorig and surface status lamps animate. The hull stays
 * fixed; a swept envelope proves the front/back layers for the entire rotation.
 */
import { writeFile, readFile } from "node:fs/promises";
import process from "node:process";
import { Buffer } from "node:buffer";
import console from "node:console";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL, URL } from "node:url";

const revision = "1482e8469b0a9e0d8cc18ea2740a01423d29ae80";
const sourceIndex = process.argv.indexOf("--anatomy");
if (sourceIndex < 0 || !process.argv[sourceIndex + 1]) throw new Error("Pass --anatomy <checkout> at the documented revision.");
const source = resolve(process.argv[sourceIndex + 1]);
if (execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim() !== revision) {
  throw new Error(`Use Anatomy revision ${revision} for a reproducible build.`);
}
const k = await import(pathToFileURL(join(source, "kit/iso-kit.mjs")));
const G = await import(pathToFileURL(join(source, "kit/lathe.mjs")));
const A = await import(pathToFileURL(join(source, "kit/audit.mjs")));
const { turning } = await import(pathToFileURL(join(source, "kit/turn-build.mjs")));
const width = 1120, height = 580;
const P = k.fitProjection([
  ...k.boxCorners({ x: -430, y: -86, w: 860, d: 172, r: 0 }, -89, 89),
  [228, 0, 160],
], width, height, { pad: 34, azimuth: 113, elevation: 29 });
const R = A.recorder(P);
const T = turning(P);
const coreGroup = T.group("protorig", { hinge: { point: [0,0,0], axis: [1,0,0], range: [0,360] } });
const coreLayer = T.layer("core");
T.stack(["back", "core", "front"]);
const at = p => k.iso(p, P);
const line = d => k.lineSvg(d, { tone: "faint" });
const axis = { o: [0, 0, 0], a: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] };
const octagon = r => [[r, r * .4142], [r * .4142, r], [-r * .4142, r], [-r, r * .4142],
  [-r, -r * .4142], [-r * .4142, -r], [r * .4142, -r], [r, -r * .4142]];
const clipHeight = (polygon,height,upper) => polygon.flatMap((p,i) => {
  const q=polygon[(i+1)%polygon.length], inside=v=>upper?v[1]>=height:v[1]<=height;
  const crossing=inside(p)!==inside(q)
    ? [[p[0]+(q[0]-p[0])*(height-p[1])/(q[1]-p[1]),height]] : [];
  return [...(inside(p)?[p]:[]),...crossing];
});

function put(name, paths, shape, point, inner = "", overlay = "") {
  if (name.startsWith("protorig.")) {
    const part = T.prism({ name, group: coreGroup, layer: coreLayer, F: shape.F, polygon: shape.poly,
      s0: shape.s0, s1: shape.s1, tone: "mid", details: { bevel: .45 } });
    shape = part.shapes[0];
  }
  R.put({ name, at: point, piece: name,
    shapes: [R.solid(shape)], svg: k.solidSvg(paths, { tone: "mid", inner }), overlay });
}
function slab(name, plan, z, h, inner = "", meta = {}) {
  const top = z + h;
  const detail = plan.w > 25 && plan.d > 20
    ? line(k.planOutline(k.insetPlan(plan, 3), top, P, 4))
      + line(k.sideSeam(plan, z + h * .65, P, 4))
      + k.dotsSvg(k.corners(plan, 4).map(([x, y]) => at([x, y, top])), { size: .65, tone: "mid" })
    : "";
  put(name, k.slabOf(plan, z, h, P, 4, .5), A.slab(plan, z, h, { name, ...meta }, 4),
    [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], detail + inner);
}
function prism(name, polygon, z, h, inner = "") {
  const center = polygon.reduce((s, p) => [s[0] + p[0] / polygon.length, s[1] + p[1] / polygon.length], [0, 0]);
  put(name, k.extrude(polygon, z, h, P, { convex: false, bevel: .5 }),
    A.extruded(polygon, z, h, { name }), [...center, z + h / 2], inner);
}
function axial(name, polygon, start, end, inner = "", meta = {}) {
  const center = polygon.reduce((s, p) => [s[0] + p[0] / polygon.length, s[1] + p[1] / polygon.length], [0, 0]);
  const details = ["engineering.body","command.neck","command.pedestal"].includes(name)
    ? axialPanels(polygon,start,end) : name==="protorig.core" ? crystalFacets(polygon,start,end) : "";
  put(name, G.prismOf(axis, polygon, start, end, P), A.prism(axis, polygon, start, end, { name, ...meta }),
    [(start + end) / 2, ...center], details+inner);
}
function framed(name, F, polygon, start, end, inner = "") {
  const center = polygon.reduce((s,p) => [s[0]+p[0]/polygon.length,s[1]+p[1]/polygon.length],[0,0]);
  const point = G.add3(F.o,G.add3(G.mul3(F.a,(start+end)/2),G.add3(G.mul3(F.u,center[0]),G.mul3(F.v,center[1]))));
  put(name,G.prismOf(F,polygon,start,end,P),A.prism(F,polygon,start,end,{name}),point,inner);
}
function pipe(name, y, z, start, end, radius) {
  const F = {...axis,o:[0,y,z]};
  const profile = [[start,radius],[end,radius]];
  put(name,G.solidOf(profile,F,P,{steps:24}),A.solid(F,profile,{name}),
    [(start+end)/2,y,z]);
}
function facePanel(x0,x1,y,z0,z1) {
  const outline = k.pathOf([[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]].map(at),true);
  const slots = Array.from({length:6},(_,i) => {
    const z = z0+3+i*(z1-z0-7)/6;
    return line(k.pathOf([[x0+3,y,z],[x1-3,y,z],[x1-3,y,z+1],[x0+3,y,z+1]].map(at),true));
  }).join("");
  return `<path class="ef-dijiang-inset" d="${outline}"/>${line(outline)}${slots}`;
}
function axialFacePoint(p,q,x,t) {
  return at([x,p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);
}
function axialPanels(polygon,start,end) {
  // Service panels follow each visible octagonal hull face, including its bevels.
  return polygon.map((p,i)=>{
    const q=polygon[(i+1)%polygon.length];
    if (G.dot3([0,q[1]-p[1],p[0]-q[0]],G.viewOf(P))<=0) return "";
    const rect=(x0,x1,t0,t1)=>k.pathOf([
      axialFacePoint(p,q,x0,t0),axialFacePoint(p,q,x1,t0),
      axialFacePoint(p,q,x1,t1),axialFacePoint(p,q,x0,t1),
    ],true);
    const rim=rect(start+2,end-2,.08,.92);
    const panels=[`<path class="ef-dijiang-panel" d="${rim}"/>`,line(rim)];
    const length=end-start;
    if(length>24) {
      panels.push(line(rect(start+5,start+length*.58,.18,.82)));
      for(let n=0;n<5;n++) panels.push(line(rect(start+length*.68,end-5,.18+n*.13,.23+n*.13)));
      panels.push(k.dotsSvg([axialFacePoint(p,q,start+4,.13),axialFacePoint(p,q,end-4,.13),
        axialFacePoint(p,q,start+4,.87),axialFacePoint(p,q,end-4,.87)],{size:.65,tone:"hi"}));
    }
    return panels.join("");
  }).join("");
}
function crystalFacets(polygon,start,end) {
  return polygon.map((p,i)=>{
    const q=polygon[(i+1)%polygon.length];
    if(G.dot3([0,q[1]-p[1],p[0]-q[0]],G.viewOf(P))<=0) return "";
    // Joined mineral facets, not arbitrary hatch marks on a fabricated tube.
    return Array.from({length:9},(_,n)=>{
      const x0=start+(end-start)*n/9, x1=start+(end-start)*(n+1)/9;
      const points=[[x0,0],[x1,0],[x1-7,.35+(n%3)*.1],[x0+9,1],[x0,.72]];
      const d=k.pathOf(points.map(([x,t])=>axialFacePoint(p,q,x,t)),true);
      return `<path class="ef-dijiang-crystal" style="opacity:${.16+(n%3)*.08}" d="${d}"/>`;
    }).join("");
  }).join("");
}
function hatches(x, y, w, d, z, count = 5) {
  return Array.from({ length: count }, (_, i) =>
    line(k.planOutline({ x: x + i * w / count + 1, y, w: w / count - 3, d, r: .5 }, z, P, 2))
  ).join("");
}
function lamps(start, end, y, z) {
  // Closed surface inlays on the beam, animated by opacity rather than motion.
  return Array.from({ length: 7 }, (_, i) => {
    const x = start + 8 + i * (end - start - 20) / 6;
    const d = k.onTop([[x, y - .8], [x + 3, y - .8], [x + 3, y + .8], [x, y + .8]], z, P, true);
    return `<path class="ef-dijiang-status" style="--dijiang-phase:${(-(x + 344) / 72).toFixed(3)}s" d="${d}"/>`;
  }).join("");
}

// Central structural body is the support root of this free-flying vessel.
// All other solids must physically meet it through the real frame or core.
axial("engineering.body", octagon(58), 134, 194, "", { ground: true });
// Short joined mineral sections keep face births gradual as the long core turns
// edge-on; each section is an audited solid, flush with the next one.
for(let i=0;i<10;i++) axial(i===0?"protorig.core":`protorig.core.${i}`,octagon(20),-344+i*47.8,-344+(i+1)*47.8);
prism("frame.stabilizer", [[-430,-2],[-344,-20],[-344,20],[-430,2]], -10, 20);
// Forty asymmetrical crystal blades on four faces, contained in a radius-37
// swept cylinder. Their bases land flush on the octagonal mineral core.
const vertical = {o:[0,0,0],a:[0,-1,0],u:[1,0,0],v:[0,0,1]};
for (let i=0;i<10;i++) {
  for (let side=0;side<4;side++) {
    const theta=side*Math.PI/2;
    const F={o:[0,0,0],a:[0,-Math.cos(theta),-Math.sin(theta)],u:[1,0,0],v:[0,-Math.sin(theta),Math.cos(theta)]};
    const x=-338+i*46+(side%2)*3;
    const length=35+(i*3+side)%7, rise=7+(i*7+side*3)%7;
    const poly=[[x,20],[x+length,20],[x+length-4,20+rise],[x+10,23+rise]];
    framed(`protorig.facet.${i}.${side}`,F,poly,-7,7);
  }
}

// Four open axial beams interrupted at each transverse reinforcement hoop.
const hoops = [-274, -138, -2, 128];
const spans = [[-344,-274],[-268,-138],[-132,-2],[4,128]];
for (const [i, [start, end]] of spans.entries()) {
  const directions=[[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const [r,direction] of directions.entries()) {
    const F={o:[0,0,0],a:direction,u:[1,0,0],v:G.cross3(direction,[1,0,0])};
    for (const t of [-12,8]) {
      const details = direction[1] && (t === (direction[1]>0?-12:8))
        ? hatches(start+2,direction[1]*60-2,end-start-4,4,12,Math.max(3,Math.floor((end-start)/10)))
          +lamps(start,end,direction[1]*60,12)
        : "";
      framed(`frame.rail.${i}.${r}.${t}`,F,[[start,t],[end,t],[end,t+4],[start,t+4]],56,64,details);
    }
    // Three real diagonal web members leave triangular openings between chords.
    for (let b=0;b<3;b++) {
      const x0=start+b*(end-start)/3, x1=start+(b+1)*(end-start)/3;
      const poly=b%2===0
        ? [[x0,-8],[x0+4,-8],[x1,8],[x1-4,8]]
        : [[x0,8],[x1-4,-8],[x1,-8],[x0+4,8]];
      framed(`frame.web.${i}.${r}.${b}`,F,poly,58,62);
    }
  }
}
for (const [i,x] of hoops.entries()) {
  const outer = octagon(64), inner = octagon(56);
  // Quarter hoops can be depth-sorted independently around the core.
  for (let q = 0; q < 4; q++) {
    const j = q * 2;
    const polygon = [outer[j],outer[(j+1)%8],outer[(j+2)%8],inner[(j+2)%8],inner[(j+1)%8],inner[j]];
    const rimOuter=octagon(62),rimInner=octagon(58);
    const rim=[rimOuter[j],rimOuter[(j+1)%8],rimOuter[(j+2)%8],rimInner[(j+2)%8],rimInner[(j+1)%8],rimInner[j]];
    const bolts=[0,1,2].map(n=>{
      const p=octagon(60)[(j+n)%8];
      return at([x,p[0],p[1]]);
    });
    if(q===1) {
      // This quarter crosses the live core's swept layer. Its upper crown
      // covers the rear utility pipes; its lower leg sits behind the mineral.
      for(const upper of [false,true]) {
        axial(`frame.hoop.${i}.${q}.${upper?"upper":"lower"}`,clipHeight(polygon,37,upper),x,x+6,
          k.dotsSvg(bolts.filter((_,n)=>upper?n===0:n!==0),{size:.7,tone:"hi"}));
      }
    } else {
      axial(`frame.hoop.${i}.${q}`, polygon, x, x+6,
        line(k.pathOf(rim.map(([y,z])=>at([x,y,z])),true))+k.dotsSvg(bolts,{size:.7,tone:"hi"}));
    }
  }
  for (const y of [-56,40]) {
    slab(`suspension.${i}.${y}`, { x,y,w:6,d:16,r:0 },-3,6);
    slab(`suspension.clamp.${i}.${y}`, { x:x-2,y:y<0?-44:40,w:8,d:4,r:.3 },3,6,
      hatches(x-1,y<0?-43.5:40.5,6,3,9,3));
  }
}
// Exposed parallel services terminate on the transverse frames. Flanges and
// pipes are separate, flush-ended solids, so nothing passes through a coupling.
for (const [i,[start,end]] of spans.entries()) {
  if (i===0) continue;
  for (const [y,z] of [[-46,40],[46,40],[-42,44],[42,44]]) {
    pipe(`services.flange.${i}.${y}.a`,y,z,start,start+3,2.5);
    pipe(`services.line.${i}.${y}`,y,z,start+3,end-3,1.6);
    pipe(`services.flange.${i}.${y}.b`,y,z,end-3,end,2.5);
  }
}

// Blocky peripheral bays at the engineering belt, as in the archive render.
slab("engineering.bay.top", { x:139,y:-24,w:50,d:48,r:1 },58,24,
  hatches(144,-20,40,40,82));
slab("engineering.bay.bottom", { x:139,y:-24,w:50,d:48,r:1 },-82,24);
for (const y of [-82,58]) {
  slab(`engineering.bay.${y}`, { x:139,y,w:50,d:24,r:1 },-24,48,
    hatches(143,y+4,42,16,24,4)
    +(y>0?facePanel(145,183,82,-18,18):""));
  slab(`engineering.cap.${y}`, { x:143,y:y+3,w:42,d:18,r:.6 },24,4);
}
for(const side of [-1,1]) {
  const plane=side>0?[-86,-82]:[82,86];
  framed(`engineering.armor.${side}`,vertical,
    [[140,-25],[180,-25],[192,-14],[192,17],[181,25],[140,25]],...plane,
    side>0?facePanel(146,185,86,-18,18):"");
}
slab("engineering.cap.top", { x:143,y:-20,w:42,d:40,r:.6 },82,4);
slab("engineering.cap.bottom", { x:143,y:-20,w:42,d:40,r:.6 },-86,4);
for (let i=0;i<4;i++) {
  // Armored transverse ribs mounted on bay lids, rather than painted stripes.
  slab(`engineering.rib.top.${i}`,{x:145+i*10,y:-20,w:3,d:40,r:.3},86,3);
  slab(`engineering.rib.bottom.${i}`,{x:145+i*10,y:-20,w:3,d:40,r:.3},-89,3);
  for (const y of [-79,61]) {
    slab(`engineering.rib.flank.${i}.${y}`,{x:145+i*10,y,w:3,d:18,r:.3},28,3);
  }
}

// Narrow neck between the belt and the cluster below the command spire.
axial("command.neck", octagon(34),194,262);
for (const y of [-62,34]) {
  slab(`command.module.${y}`, { x:222,y,w:40,d:28,r:1 },-14,42,
    hatches(226,y+4,32,20,28,4)+(y>0?facePanel(227,257,62,-8,22):""));
  slab(`command.cap.${y}`, { x:224,y:y+2,w:36,d:24,r:.5 },28,8);
}
for(const side of [-1,1]) {
  const plane=side>0?[-66,-62]:[62,66];
  framed(`command.armor.${side}`,vertical,
    [[222,-20],[258,-20],[267,-10],[267,20],[258,30],[222,30]],...plane,
    side>0?facePanel(228,258,66,-12,22):"");
}
axial("command.pedestal", octagon(40),262,278);
prism("command.spire", [[278,-22],[310,-18],[424,-2],[430,0],[424,2],[310,18],[278,22]],-14,28,
  line(k.onTop([[286,-15],[308,-12],[386,-2],[308,-7],[286,-8]],14,P,true))
  +line(k.onTop([[286,15],[308,12],[386,2],[308,7],[286,8]],14,P,true)));
framed("command.spire.ridge",vertical,[[282,14],[416,14],[318,22],[282,24]],-2,2);
for (const y of [-6,2]) {
  slab(`command.deck.${y}`,{x:235,y,w:23,d:4,r:.5},34,3,
    hatches(237,y+.8,19,2.4,37,3));
}
slab("command.tower", { x:202,y:-10,w:24,d:20,r:.5 },34,118,
  hatches(205,-7,18,14,152,3)
  +facePanel(207,221,10,43,69)+facePanel(207,221,10,82,110)
  +facePanel(207,221,10,123,144));
slab("command.tower.cap", { x:199,y:-13,w:30,d:26,r:.5 },152,5);
framed("command.tower.foot.a",vertical,[[196,34],[202,34],[202,60]],-6,6);
framed("command.tower.foot.b",vertical,[[226,34],[232,34],[226,60]],-6,6);
for (const z of [72,113]) {
  slab(`command.tower.equipment.${z}`,{x:204,y:10,w:20,d:6,r:.3},z,7,
    hatches(206,11,16,4,z+7,4));
}
for (const y of [-6,6]) {
  slab(`command.sensor.${y}`, { x:270,y:y-1.5,w:3,d:3,r:0 },40,23);
}

A.settle(R, P);
R.items.sort((a,b) => a.key-b.key);
A.auditOrExit(R, P);
if (process.exitCode) throw new Error("Geometry audit failed; no artwork was written.");
const statics = R.items.filter(item => !item.name.startsWith("protorig."));
const envelope = { name: "rotation-envelope", at: [-105,0,0], key: k.depthOf([-105,0,0],P),
  move: [0,0,0], shapes: [A.disc(axis,-344,134,37)] };
// Sort around the whole reachable volume, not just the initial crystal pose.
const layered = { ...R, items: [...statics,envelope] };
A.settle(layered,P);
for (const item of statics) {
  const bounds=item.shapes.map(shape=>A.boundsOf(shape));
  const low=Math.min(...bounds.map(b=>b.min[2])), high=Math.max(...bounds.map(b=>b.max[2]));
  item.layer = low>=37 ? "front" : high<=-37 ? "back" : item.key < envelope.key ? "back" : "front";
}
const poses = Array.from({length:720},(_,i)=>({protorig:i*.5}));
const out = T.build({ statics, poses, verify: true });
const layerRank={back:0,core:1,front:2};
const composed=R.items.slice().sort((a,b)=>layerRank[a.layer??"core"]-layerRank[b.layer??"core"] || a.key-b.key)
  .map((item,key)=>({...item,key}));
const composition=A.depthOrder(composed,P);
if(composition.problems.length) throw new Error(`Layer composition: ${JSON.stringify(composition.problems.map(p=>[p.front,p.back]))}`);
const art = layer => statics.filter(item=>item.layer===layer).sort((a,b)=>a.key-b.key)
  .map(item => `<g data-dijiang-part="${item.name}">${item.svg}${item.overlay}</g>`).join("\n");
const license = await readFile(join(source,"LICENSE"),"utf8");
const svg = `<!-- Generated by scripts/generate-endfield-dijiang.mjs. Anatomy ${revision}.\n${license}-->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false" data-dijiang-artwork>\n${art("back")}\n${out.layerSvg("core",{width,height}).replace('class="iso-svg iso-live iso-layer"','class="iso-svg iso-live" data-dijiang-core')}\n${art("front")}\n</svg>\n`;
await writeFile(new URL("../apps/endfield/src/components/dijiang-artwork.svg",import.meta.url),svg);
await writeFile(new URL("../apps/endfield/src/components/dijiang-motion.json",import.meta.url),JSON.stringify(out.data));
// Standalone upstream runtime, minified at build-time; no engine/dependency is
// fetched at runtime. Keep the upstream notice with the generated artifact.
const { transform } = await import("esbuild");
const runtime = await readFile(join(source,"kit/turn.mjs"),"utf8");
const bundled = await transform(runtime,{minify:true,format:"esm",target:"es2022"});
await writeFile(new URL("../apps/endfield/src/components/dijiang-turn.mjs",import.meta.url),`/* Anatomy ${revision}\n${license}*/\n${bundled.code}`);
await writeFile(new URL("../apps/endfield/src/components/dijiang-turn.css",import.meta.url),
  `/* Anatomy ${revision}; license: dijiang-turn.mjs. Scoped to this decoration. */\n${out.css.split("\n").map(rule=>`.ef-dijiang ${rule}`).join("\n")}\n`);
console.log(`Wrote Dijiang artwork: ${R.items.length} solids, ${Buffer.byteLength(svg)} SVG bytes, ${out.report.proofs.length} static layer proofs.`);
if (process.argv.includes("--orbit")) {
  const TA = await import(pathToFileURL(join(source,"kit/turn-audit.mjs")));
  TA.orbitOrExit(T,R,P,{quick:process.argv.includes("--quick"),log:console.log,
    sweep:{at:angle=>({protorig:angle}),from:0,to:360,frame:.3}});
}
