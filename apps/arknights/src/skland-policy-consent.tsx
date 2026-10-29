"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../messages/zh-CN/AK_Raw_skland_policy_consent.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_skland_policy_consent");


import { Link } from "@tanstack/react-router";
import { useId } from "react";

import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  type SklandPolicyConsentRequest,
} from "@riic/arknights-domain/legal-policy";

export function currentSklandPolicyConsent(): SklandPolicyConsentRequest {
  return {
    termsAccepted: true,
    privacyAccepted: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
  };
}

export function SklandPolicyConsent({
  termsAccepted,
  privacyAccepted,
  onTermsChange,
  onPrivacyChange,
}: {
  termsAccepted: boolean;
  privacyAccepted: boolean;
  onTermsChange: (accepted: boolean) => void;
  onPrivacyChange: (accepted: boolean) => void;
}) {
  const rawLocale = useRawLocale();
  const termsId = useId();
  const privacyId = useId();
  return (
    <div className="grid w-full gap-3 text-start text-xs leading-5 text-muted-foreground" data-skland-policy-consent>
      <div className="flex items-start gap-2">
        <input
          id={termsId}
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) => onTermsChange(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <label htmlFor={termsId}>{rawText.rich(rawLocale, "iHaveReadAndAgreeTo", { part1: richValue((<Link className="mx-1 font-medium text-foreground underline underline-offset-4" to="/terms" target="_blank">{rawText.text(rawLocale, "terms")}</Link>)) })}</label>
      </div>
      <div className="flex items-start gap-2">
        <input
          id={privacyId}
          type="checkbox"
          checked={privacyAccepted}
          onChange={(event) => onPrivacyChange(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <label htmlFor={privacyId}>{rawText.rich(rawLocale, "iHaveReadAndAgreeToThisSiteProcessing", { part1: richValue((<Link className="mx-1 font-medium text-foreground underline underline-offset-4" to="/privacy" target="_blank">{rawText.text(rawLocale, "privacy")}</Link>)) })}</label>
      </div>
    </div>
  );
}
