"use client";

import { Link } from "@tanstack/react-router";
import { useId } from "react";

import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  type SklandPolicyConsentRequest,
} from "@/legal-policy";

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
        <label htmlFor={termsId}>
          我已阅读并同意
          <Link className="mx-1 font-medium text-foreground underline underline-offset-4" to="/terms" target="_blank">本站服务条款</Link>
          。
        </label>
      </div>
      <div className="flex items-start gap-2">
        <input
          id={privacyId}
          type="checkbox"
          checked={privacyAccepted}
          onChange={(event) => onPrivacyChange(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <label htmlFor={privacyId}>
          我已阅读
          <Link className="mx-1 font-medium text-foreground underline underline-offset-4" to="/privacy" target="_blank">本站隐私政策</Link>
          ，并同意本站为登录和数据同步处理我的森空岛凭证、角色、干员与基建数据。
        </label>
      </div>
    </div>
  );
}
