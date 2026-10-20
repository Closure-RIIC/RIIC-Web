import { useTranslations } from "use-intl";
import { Route as RootRoute } from "@/routes/__root";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { LegalUpdates } from "@/components/legal/LegalUpdates";

import { LEGAL_EFFECTIVE_DATE } from "@/legal-policy";

export default function TermsPage() {
  const t = useTranslations("app_terms_page");
  const meta = useTranslations("Metadata");
  const { identity, sklandEnabled } = RootRoute.useLoaderData().publicConfig;
  const englishOperatorName = identity.operatorName === "\u53ef\u9732\u5e0c\u5c14\u57fa\u5efa\u7ec8\u7aef\u9879\u76ee\u7ef4\u62a4\u8005" ? "Closure Infrastructure Terminal maintainers" : identity.operatorName;

  return (
    <LegalDocument eyebrow={meta("siteTitle")} title={meta("terms")} effectiveDate={LEGAL_EFFECTIVE_DATE}>{t.rich("content", { element1: (chunks) => (<section>{chunks}</section>), element2: (chunks) => (<h2>{chunks}</h2>), element3: (chunks) => (<ul>{chunks}</ul>), element4: (chunks) => (<li>{chunks}</li>), element5: (chunks) => (<h2 className="font-number">{chunks}</h2>), element6: (chunks) => (<p>{chunks}</p>), value7: () => (englishOperatorName), element8: (chunks) => (<a href="https://assets.skland.com/protocols/agreement.html">{chunks}</a>), element9: (chunks) => (<a href="https://assets.skland.com/protocols/privacy.html">{chunks}</a>), element10: (chunks) => (<a href={identity.contactUrl}>{chunks}</a>), element11: (chunks) => (<a href={`mailto:${identity.contactEmail}`}>{chunks}</a>), value12: () => (identity.contactEmail), value13: () => (identity.operatorName), choice1: (sklandEnabled) ? "yes" : "no", choice2: (identity.contactEmail) ? "yes" : "no" })}<LegalUpdates document="terms" /></LegalDocument>
  );
}
