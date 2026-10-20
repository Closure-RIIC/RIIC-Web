"use client";

import { useLocale } from "use-intl";
import { BookOpen, ExternalLink } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { helpKnowledgeText } from "@/i18n/helpers/help_knowledge";
import { KNOWLEDGE_REPOSITORY, KNOWLEDGE_USAGE_URL, KNOWLEDGE_FAQS } from "@/help-knowledge";

export function KnowledgeHelpSection() {
  const en = useLocale() === "en";
  const t = (key: Parameters<typeof helpKnowledgeText.text>[1], values?: Record<string, string | number>) => helpKnowledgeText.text(en, key, values);
  return <section id="base-knowledge" className="scroll-mt-6 space-y-6 border-y border-border py-6" aria-labelledby="knowledge-help-title" data-help-knowledge>
    <header className="space-y-3">
      <h2 id="knowledge-help-title" className="flex items-center gap-2.5 text-lg font-semibold">
        <span className="h-5 w-1 bg-[#FFD800]" aria-hidden="true" /><BookOpen className="size-5 text-muted-foreground" />{t("title")}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("intro")}</p>
      <div className="flex flex-wrap gap-2">
        <SetupActionButton nativeButton={false} render={<a href={KNOWLEDGE_REPOSITORY} target="_blank" rel="noopener noreferrer" />}><BookOpen />{t("repository")}<ExternalLink /></SetupActionButton>
        <SetupActionButton nativeButton={false} variant="outline" render={<a href={KNOWLEDGE_USAGE_URL} target="_blank" rel="noopener noreferrer" />} >{t("usageGuide")}<ExternalLink /></SetupActionButton>
      </div>
    </header>
    <section aria-labelledby="knowledge-faq-title">
      <h3 id="knowledge-faq-title" className="mb-3 text-sm font-semibold">{t("faqTitle")}</h3>
      <Accordion>{KNOWLEDGE_FAQS.map(item => <AccordionItem key={item.id} value={item.id}>
        <AccordionTrigger>{t(`${item.id}Question`)}</AccordionTrigger>
        <AccordionPanel><div className="space-y-3 px-4 py-4">
          <p className="text-sm leading-7 text-muted-foreground">{t(`${item.id}Answer`)}</p>
        </div></AccordionPanel>
      </AccordionItem>)}</Accordion>
    </section>
    <footer className="space-y-2 text-xs leading-6 text-muted-foreground">
      <p>{t("boundary")}</p>
      <p>{t("attribution")}</p>
      <p>{t("languageNote")}</p>
    </footer>
  </section>;
}
