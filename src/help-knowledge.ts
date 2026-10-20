// Help summaries reviewed against this source snapshot; links remain reproducible.
export const KNOWLEDGE_REPOSITORY = 'https://github.com/lejciy/RIIC-knowledge';
export const KNOWLEDGE_REVISION = 'f6373bd07f9d5f96f3093ecd5d64e831cbfb581e';
export function knowledgeSourceUrl(path: string) {
  return `${KNOWLEDGE_REPOSITORY}/blob/${KNOWLEDGE_REVISION}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
const usage = 'docs/4-排班算法/可露希尔基建终端使用问答.md';
const mechanism = 'docs/4-排班算法/可露希尔基建终端排班机制.md';
export const KNOWLEDGE_USAGE_URL = knowledgeSourceUrl(usage);
export const KNOWLEDGE_FAQS = [
  { id: 'maa', source: usage }, { id: 'box', source: usage },
  { id: 'filler', source: usage }, { id: 'shifts', source: mechanism },
  { id: 'drones', source: usage }, { id: 'fiammetta', source: usage },
  { id: 'dorm', source: usage }, { id: 'busy', source: usage },
] as const;
