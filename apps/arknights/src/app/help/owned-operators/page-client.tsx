"use client";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { IssueSolutionPicker } from "@/components/help/IssueSolutionPicker";

const steps = [
  {
    zh: messageRecord("zh", "app_help_owned_operators_page_content").value as [string, string],
    en: messageRecord("en", "app_help_owned_operators_page_content").value as [string, string],
  },
  {
    zh: messageRecord("zh", "app_help_owned_operators_page_content2").value as [string, string],
    en: messageRecord("en", "app_help_owned_operators_page_content2").value as [string, string],
  },
  {
    zh: messageRecord("zh", "app_help_owned_operators_page_content3").value as [string, string],
    en: messageRecord("en", "app_help_owned_operators_page_content3").value as [string, string],
  },
  {
    zh: messageRecord("zh", "app_help_owned_operators_page_content4").value as [string, string],
    en: messageRecord("en", "app_help_owned_operators_page_content4").value as [string, string],
  },
  {
    zh: messageRecord("zh", "app_help_owned_operators_page_content5").value as [string, string],
    en: messageRecord("en", "app_help_owned_operators_page_content5").value as [string, string],
  },
];

export default function OwnedOperatorsHelpPage() {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  return (
    <article className="flex w-full flex-col gap-5 pt-5">
      <header>
        <Link className="inline-flex min-h-10 items-center gap-2 text-xs text-muted-foreground underline-offset-4 outline-none hover:underline hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" to="/help">
          <ArrowLeft className="size-3.5" aria-hidden="true" />{intl("app_help_owned_operators_page.backToHelp")}
        </Link>
        <div className="mt-2 flex min-w-0 items-center gap-2.5">
          <span className="h-7 w-1.5 shrink-0 bg-[#FFD501]" aria-hidden="true" />
          <h1 className="truncate text-[21px] font-medium leading-none text-[#313131]">{intl("app_help_owned_operators_page.useTheOperatorsYouOwn")}</h1>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{intl("app_help_owned_operators_page.useThisGuideIfYouLoadedTheAllOperator")}</p>
      </header>

      <IssueSolutionPicker>
      <div className="grid gap-7 rounded-[4px] border border-border bg-background p-4 sm:p-5">
        <section className="rounded-[4px] border border-amber-300 bg-amber-50 p-4 text-amber-950" aria-labelledby="sample-warning-title">
          <h2 id="sample-warning-title" className="text-lg font-semibold">{intl("app_help_owned_operators_page.firstCheckWhetherTheSourceIs243MaxLevel")}</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">{intl("app_help_owned_operators_page.ifSoSeeingOperatorsYouDoNotOwnIs")}</p>
        </section>

        <section aria-labelledby="switch-steps-title">
          <h2 id="switch-steps-title" className="text-lg font-semibold">{intl("app_help_owned_operators_page.switchStepByStep")}</h2>
          <ol className="mt-3 divide-y divide-border border-y border-border">
            {steps.map((step, index) => {
              const [title, description] = en ? step.en : step.zh;
              return <li key={index} className="grid gap-3 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                <span className="font-number text-sm text-[#313131]/38" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              </li>;
            })}
          </ol>
        </section>

        <section aria-labelledby="import-method-title" className="hidden">
          <h2 id="import-method-title" className="text-3xl font-semibold sm:text-4xl">两种导入方式</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="skland-method-title">
              <h3 id="skland-method-title" className="text-2xl font-semibold">森空岛同步</h3>
              <ol className="mt-4 grid gap-3 text-lg leading-8 text-muted-foreground">
                <li><strong className="text-foreground">1.</strong> 点「前往森空岛同步」。</li>
                <li><strong className="text-foreground">2.</strong> 勾选并确认两项协议。</li>
                <li><strong className="text-foreground">3.</strong> 二维码显示后，用森空岛 App 扫码并在 App 内确认。</li>
                <li><strong className="text-foreground">4.</strong> 授权成功后 Box 自动应用；再点「继续配置布局」或「前往生成排班」。</li>
              </ol>
              <p className="mt-5 rounded-lg bg-muted/60 p-4 text-base leading-7 text-muted-foreground">二维码过期时刷新二维码；同步暂不可用时可改用 MAA。</p>
            </section>

            <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="maa-method-title">
              <h3 id="maa-method-title" className="text-2xl font-semibold">MAA 文件导入</h3>
              <ol className="mt-4 grid gap-3 text-lg leading-8 text-muted-foreground">
                <li><strong className="text-foreground">1.</strong> 在 MAA 导出干员数据文件。</li>
                <li><strong className="text-foreground">2.</strong> 上传 <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">Arknights_OperBox_Export.json</code>。</li>
                <li><strong className="text-foreground">3.</strong> 也可展开「粘贴 JSON」，粘贴完整内容后导入。</li>
              </ol>
              <p className="mt-5 rounded-lg bg-muted/60 p-4 text-base leading-7 text-muted-foreground">不要上传排班文件或本站导出的 MAA 排班 JSON。当前 MAA 导入需要已验证的网站账号。</p>
            </section>
          </div>
          <Link className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-lg border border-border px-5 text-lg font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" to="/help/import-operators">
            查看含截图位的详细导入教程<ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>

        <section aria-labelledby="source-check-title" className="hidden">
          <h2 id="source-check-title" className="text-3xl font-semibold sm:text-4xl">怎么判断切换成功</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <table className="w-full border-collapse text-left text-base sm:text-lg">
              <thead className="bg-muted/70 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">当前数据显示</th><th className="px-4 py-3 font-medium">代表什么</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr><td className="px-4 py-3 font-medium">243 全精二示例</td><td className="px-4 py-3 text-muted-foreground">仍是体验数据，还没换成自己的 Box。</td></tr>
                <tr><td className="px-4 py-3 font-medium">森空岛 / 上次同步的森空岛数据</td><td className="px-4 py-3 text-muted-foreground">正在使用森空岛角色数据。</td></tr>
                <tr><td className="px-4 py-3 font-medium">JSON 文件名 / MAA 导入</td><td className="px-4 py-3 text-muted-foreground">正在使用 MAA 干员数据。</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-5 text-lg leading-8 text-sky-950">
            <strong className="text-xl">数量不完全一致不一定是失败。</strong>
            <p className="mt-2 text-sky-900">使用 MAA 文件时先对比“名可用”，不要拿文件总条目数当持有数。游戏内概况总数可能不计部分联动干员，而导入数据会包含你实际拥有的联动干员。建议再抽查具体干员。</p>
          </div>
        </section>

        <section aria-labelledby="recovery-title" className="hidden">
          <h2 id="recovery-title" className="text-3xl font-semibold sm:text-4xl">切换后仍出现未拥有干员</h2>
          <ol className="mt-5 grid gap-3 text-lg leading-8 text-muted-foreground">
            <li><strong className="text-foreground">1.</strong> 确认弹窗里的当前数据不再是全精二示例。</li>
            <li><strong className="text-foreground">2.</strong> 确认“名可用”不是 <span className="font-number">0</span>。若只差联动干员数量，通常不代表导入失败。</li>
            <li><strong className="text-foreground">3.</strong> 点完「完成」后重新生成，不要继续查看旧排班。</li>
            <li><strong className="text-foreground">4.</strong> 仍有问题时重新导出最新 Box，并在反馈中写明异常干员名称与当前数据来源。</li>
          </ol>
        </section>

        <section className="hidden flex-wrap items-center justify-between gap-4 rounded-xl bg-foreground p-5 text-background" aria-label="返回计算器">
          <div><strong className="block text-2xl">准备好了</strong><p className="mt-2 text-lg text-background/75">回到计算器，按步骤更换并重新生成。</p></div>
          <Link className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-background px-5 text-lg font-semibold text-foreground outline-none hover:bg-background/90 focus-visible:ring-2 focus-visible:ring-background" to="/">
            返回基建计算器
          </Link>
        </section>
      </div>
      </IssueSolutionPicker>
    </article>
  );
}
