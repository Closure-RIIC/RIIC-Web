import "@tanstack/react-start/server-only";

export const DEFAULT_LEGAL_OPERATOR_NAME = "可露希尔基建终端项目维护者";
export const DEFAULT_LEGAL_CONTACT_URL =
  "https://github.com/KnightCodeSquareMatrix/RIIC-Web/issues";

export interface LegalIdentity {
  operatorName: string;
  contactEmail: string | null;
  contactUrl: string;
}

export function legalIdentity(): LegalIdentity {
  const contactUrl = process.env.LEGAL_CONTACT_URL?.trim();
  const contactEmail = process.env.LEGAL_CONTACT_EMAIL?.trim();
  return {
    operatorName: process.env.LEGAL_OPERATOR_NAME?.trim() || DEFAULT_LEGAL_OPERATOR_NAME,
    contactEmail: contactEmail || null,
    contactUrl: contactUrl || DEFAULT_LEGAL_CONTACT_URL,
  };
}
