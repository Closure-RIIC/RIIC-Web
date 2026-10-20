"use client";

import { useEffect, useState } from "react";
import { Check, EyeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Wish = { id: string; title: string; content: string; imageUrls?: string[]; status: string };

export default function AdminWishesPage() {
  const [items, setItems] = useState<Wish[]>([]);
  const [donation, setDonation] = useState({ enabled: false, imageUrl: null as string | null });
  const [donationImage, setDonationImage] = useState<string | null>(null);
  async function load() { const response = await fetch("/api/admin/wishes"); const data = await response.json(); setItems(data.data?.items ?? []); const settingsResponse = await fetch("/api/admin/wishes/settings"); const settings = await settingsResponse.json(); setDonation(settings.data?.donation ?? { enabled: false, imageUrl: null }); }
  useEffect(() => { void load(); }, []);
  async function review(id: string, status: string) { await fetch("/api/admin/wishes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) }); await load(); }
 async function saveDonation() { await fetch("/api/admin/wishes/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: donation.enabled, imageUrl: donationImage ?? donation.imageUrl }) }); await load(); }
 return <main id="admin-content" className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6"><header><h1 className="text-3xl font-semibold">许愿审核</h1><p className="mt-2 text-sm text-muted-foreground">审核通过的内容会展示在公开许愿页。</p></header><section className="grid gap-3 border border-border bg-card p-5"><h2 className="font-semibold">赞赏码预留设置</h2><p className="text-sm text-muted-foreground">默认关闭。上传后开启，才会显示在许愿页。</p><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setDonationImage(String(reader.result)); reader.readAsDataURL(file); }} className="text-sm" /><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={donation.enabled} onChange={(event) => setDonation((current) => ({ ...current, enabled: event.target.checked }))} />开放赞赏码</label><Button size="sm" onClick={saveDonation}>保存设置</Button></div></section><section className="grid gap-3">{items.map((item) => <article key={item.id} className="border border-border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">{item.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.content}</p>{item.imageUrls?.length ? <div className="mt-3 grid grid-cols-4 gap-2">{item.imageUrls.map((src) => <img key={src} src={src} alt="许愿附图" className="aspect-square object-cover" />)}</div> : null}<span className="mt-3 inline-block text-xs text-muted-foreground">{item.status}</span></div><div className="flex shrink-0 gap-2"><Button size="sm" onClick={() => review(item.id, "approved")}><Check />通过</Button><Button size="sm" variant="outline" onClick={() => review(item.id, "rejected")}><X />驳回</Button><Button size="sm" variant="ghost" onClick={() => review(item.id, "hidden")}><EyeOff />下架</Button></div></div></article>)}{!items.length ? <p className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">暂无许愿。</p> : null}</section></main>;
}
