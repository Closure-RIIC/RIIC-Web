"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_app_wishes_wishes_client.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_app_wishes_wishes_client");


import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Music2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Wish = { id: string; title: string; content: string; imageUrls?: string[]; createdAt: string };

export function WishesClient() {
  const rawLocale = useRawLocale();
  const [items, setItems] = useState<Wish[]>([]);
  const [donation, setDonation] = useState<{ enabled: boolean; imageUrl: string | null }>({ enabled: false, imageUrl: null });
  const [supporting, setSupporting] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<keyof typeof RawMessages | "">("");
  const [images, setImages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => { fetch("/api/wishes").then((response) => response.json()).then((data) => { setItems(data.data?.items ?? []); setDonation(data.data?.donation ?? { enabled: false, imageUrl: null }); }); }, []);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().catch(() => setAudioPlaying(false));
  }, []);
  function playAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().catch(() => setAudioPlaying(false));
  }
  function pauseAudio() {
    audioRef.current?.pause();
  }
  function toggleAudio() {
    if (audioPlaying) {
      pauseAudio();
      return;
    }
    playAudio();
  }
  async function addImageFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/")).slice(0, 4 - images.length);
    const encoded = await Promise.all(files.map((file) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); })));
    setImages((current) => [...current, ...encoded]);
  }
  async function handleImages(event: ChangeEvent<HTMLInputElement>) {
    await addImageFiles(event.target.files ?? []);
    event.target.value = "";
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); void addImageFiles(event.dataTransfer.files);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/wishes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content, imageUrls: images }) });
    if (response.status === 401) { setMessage("signInFirst"); return; }
    if (!response.ok) { setMessage("submitFailed"); return; }
    setTitle(""); setContent(""); setImages([]); setMessage("submitted");
  }
  const visibleItems = items.length ? items : [{ id: "example-wish", title: rawText.text(rawLocale, "exampleTitle"), content: rawText.text(rawLocale, "exampleContent"), imageUrls: [] }];
  return <main className="relative min-h-screen overflow-hidden bg-muted/30"><div className="pointer-events-none absolute inset-0 bg-[url('/images/wishes/wish-background.png')] bg-cover bg-center bg-no-repeat opacity-55" aria-hidden="true" /><div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#102b30]/75 via-[#162a2c]/68 to-[#241713]/82" aria-hidden="true" /><div className="relative mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:py-12">
    <div className="wish-banner-stage relative hidden aspect-[3200/1486] overflow-hidden bg-transparent md:block" role="img" aria-label={rawText.text(rawLocale, "untilEveryWishComesTrue")}>
      <img src="/images/wishes/wish-banner.png" alt="" className="wish-banner-main absolute inset-0 size-full object-contain [clip-path:polygon(0_0,100%_0,100%_72%,0_72%)]" />
      <img src="/images/wishes/wish-banner.png" alt="" className="wish-banner-sub absolute inset-0 size-full object-contain [clip-path:polygon(0_72%,100%_72%,100%_100%,0_100%)]" />
    </div>
    <div className="wish-cg-stage relative aspect-[1706/960] overflow-hidden bg-[#8cc5ee] shadow-[0_18px_42px_rgba(4,13,15,0.32)] md:hidden" role="img" aria-label={rawText.text(rawLocale, "animatedSceneUntilTheEarthBecomesALime")}>
      <img src="/previews/act53side/act53side_01__bg.png" alt="" className="wish-cg-layer wish-cg-bg" />
      <img src="/previews/act53side/act53side_01__tower.png" alt="" className="wish-cg-layer wish-cg-tower" />
      <img src="/previews/act53side/act53side_01__things.png" alt="" className="wish-cg-layer wish-cg-things" />
      <img src="/previews/act53side/act53side_01__smoke.png" alt="" className="wish-cg-layer wish-cg-smoke" />
      <img src="/previews/act53side/act53side_01__wind.png" alt="" className="wish-cg-layer wish-cg-wind" />
      <img src="/previews/act53side/act53side_01__img_fx_ray.png" alt="" className="wish-cg-layer wish-cg-ray" />
      <img src="/previews/act53side/act53side_01__blur_paper_01.png" alt="" className="wish-cg-layer wish-cg-paper wish-cg-paper-one" />
      <img src="/previews/act53side/act53side_01__blur_paper_02.png" alt="" className="wish-cg-layer wish-cg-paper wish-cg-paper-two" />
    </div>
    <div className="grid justify-items-center gap-3 text-center"><span className="wish-label-font text-sm font-bold uppercase tracking-[0.18em] text-[#70d6ff]">WISH BOARD</span><h1 className="wish-wall-title text-6xl sm:text-8xl">{rawText.text(rawLocale, "wishWall")}</h1><div className="flex items-center gap-3"><span className="h-1 w-16 bg-[#ffd35a] sm:w-24" /><span className="h-1 w-5 bg-[#70d6ff]" /><span className="h-1 w-16 bg-[#ffd35a] sm:w-24" /></div></div>
    <form onSubmit={submit} className="relative grid justify-items-center gap-4 overflow-hidden border border-[#ffd35a]/60 bg-[#10282d]/72 p-5 text-center text-white shadow-[0_18px_45px_rgba(4,13,15,0.38),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-md before:absolute before:left-0 before:top-0 before:h-1 before:w-full before:bg-gradient-to-r before:from-[#ffd35a] before:via-[#70d6ff] before:to-transparent sm:p-7">
      <div className="w-full"><label htmlFor="wish-title" className="wish-label-font text-base text-[#ffe79a]">{rawText.text(rawLocale, "title")}</label><input id="wish-title" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={rawText.text(rawLocale, "forExampleSupportAnotherScheduleImportFormat")} className="mt-2 h-11 w-full border border-white/20 bg-white/12 px-3 text-center text-sm text-white outline-none placeholder:text-white/45 focus:border-[#70d6ff] focus:ring-2 focus:ring-[#70d6ff]/35" /></div>
      <div className="w-full"><label htmlFor="wish-content" className="wish-label-font text-base text-[#ffe79a]">{rawText.text(rawLocale, "description")}</label><textarea id="wish-content" required maxLength={5000} value={content} onChange={(event) => setContent(event.target.value)} placeholder={rawText.text(rawLocale, "describeHowYouWouldUseItAndWhatProblem")} className="mt-2 min-h-32 w-full resize-y border border-white/20 bg-white/12 p-3 text-center text-sm text-white outline-none placeholder:text-white/45 focus:border-[#70d6ff] focus:ring-2 focus:ring-[#70d6ff]/35" /></div>
      <div className="grid w-full justify-items-center"><label htmlFor="wish-images" className="wish-label-font flex items-center gap-2 text-base text-[#ffe79a]">{rawText.rich(rawLocale, "attachments", { part1: richValue((<ImagePlus className="size-4" />)), part2: richValue((<span className="text-sm font-normal text-white/62">{rawText.text(rawLocale, "upTo4Images")}</span>)) })}</label><div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className={`mt-2 w-full border border-dashed p-4 transition-colors ${dragging ? "border-[#70d6ff] bg-[#70d6ff]/15" : "border-white/24 bg-white/10"}`}><input id="wish-images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={handleImages} className="mx-auto block w-fit max-w-full text-sm text-white file:mr-3 file:border-0 file:bg-[#fff8dc] file:px-3 file:py-2 file:text-sm file:text-[#242424]" /><p className="mt-2 text-xs text-white/58">{rawText.text(rawLocale, "youCanAlsoDragImagesHere")}</p></div>{images.length ? <div className="mt-3 grid w-full grid-cols-4 gap-2">{images.map((src, index) => <div key={src} className="group relative aspect-square overflow-hidden border border-white/24"><img src={src} alt={rawText.text(rawLocale, "preview", { index: index + 1 })} className="size-full object-cover" /><button type="button" aria-label={rawText.text(rawLocale, "removeImage")} onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1 top-1 grid size-6 place-items-center bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"><X className="size-4" /></button></div>)}</div> : null}</div>
      <div className="grid justify-items-center gap-3 border-t border-white/18 pt-4"><span className="text-sm text-white/62">{rawText.text(rawLocale, "signInToSubmitUpTo5WishesPer")}</span><Button type="submit" className="bg-[#ffd35a] text-[#242424] hover:bg-[#ffe28a]">{rawText.rich(rawLocale, "submitWish", { part1: richValue((<Send />)) })}</Button></div>
      {message ? <p className="text-sm text-[#ffe79a]">{rawText.text(rawLocale, message)}</p> : null}
    </form>
    <section className="grid gap-4 text-white"><div><h2 className="wish-label-font text-3xl text-[#ffe79a] drop-shadow-[0_2px_0_rgba(36,36,36,0.65)]">{rawText.text(rawLocale, "publishedWishes")}</h2><p className="mt-1 text-sm text-white/66">{rawText.text(rawLocale, "allWishesShownHereHaveBeenReviewedByAn")}</p></div>{visibleItems.map((item) => <article key={item.id} className="relative grid gap-4 overflow-hidden border border-white/18 bg-[#132327]/70 p-5 shadow-[0_16px_36px_rgba(4,13,15,0.3),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-[#70d6ff] sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="wish-label-font text-xl text-white">{item.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/68">{item.content}</p></div><Button type="button" variant="outline" size="sm" onClick={() => setSupporting(item.id)} className="border-[#ffd35a]/70 bg-[#fff8dc] text-[#242424] hover:bg-[#ffe79a]">{rawText.rich(rawLocale, "support", { part1: richValue((<Sparkles />)) })}</Button></div>{item.imageUrls?.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{item.imageUrls.map((src) => <img key={src} src={src} alt={rawText.text(rawLocale, "wishAttachment")} className="aspect-square w-full border border-white/18 object-cover" />)}</div> : null}{supporting === item.id ? <div className="flex flex-col items-center gap-3 border-t border-white/18 pt-4 text-center"><h4 className="font-medium text-[#ffe79a]">{rawText.text(rawLocale, "supportThisWish")}</h4>{donation.enabled && donation.imageUrl ? <><p className="text-sm text-white/62">{rawText.text(rawLocale, "thankYouForYourSupportScanTheCodeTo")}</p><img src={donation.imageUrl} alt={rawText.text(rawLocale, "donationCode")} className="max-w-56" /></> : <p className="text-sm text-white/62">{rawText.text(rawLocale, "donationsAreNotAvailableYetThankYouForYour")}</p>}<Button type="button" variant="ghost" size="sm" onClick={() => setSupporting(null)} className="text-white hover:bg-white/10 hover:text-white">{rawText.text(rawLocale, "collapse")}</Button></div> : null}</article>)}</section>
    <audio ref={audioRef} loop preload="metadata" src="/audio/wish-wall-bgm.mp3" aria-label={rawText.text(rawLocale, "wishWallBackgroundMusic")} onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)} onEnded={() => setAudioPlaying(false)} />
    <button type="button" aria-label={audioPlaying ? rawText.text(rawLocale, "pauseMusic") : rawText.text(rawLocale, "playMusic")} title={audioPlaying ? rawText.text(rawLocale, "pauseMusic") : rawText.text(rawLocale, "playMusic")} onClick={toggleAudio} className="fixed bottom-5 right-5 z-20 grid size-14 place-items-center border border-[#ffd35a]/65 bg-[#10282d]/90 text-[#ffd35a] shadow-[0_12px_28px_rgba(4,13,15,0.4)] backdrop-blur-md hover:bg-[#173a40]">
      <Music2 className={`wish-music-note size-8 ${audioPlaying ? "is-playing" : ""}`} />
    </button>
  </div></main>;
}
