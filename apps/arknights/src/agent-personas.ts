export type UploadedAgentPersona = {
  id: string;
  name: string;
  description: string;
  content: string;
  kind: "upload";
  filename?: string;
  avatarUrl?: string;
};

export const BUILTIN_AGENT_PERSONAS = [{
  id: "silverash",
  name: "银灰",
  description: "喀兰贸易的盟友，沉稳而敏锐，陪你权衡收益与代价。",
  kind: "builtin",
  theme: "blue",
  avatar: "silverash",
  identity: { zh: "银灰 / 喀兰贸易", en: "SILVERASH / KARLAN TRADE" },
  welcome: { zh: "盟友，从哪件事开始？", en: "My ally, where shall we start?" },
  caption: "从容判断，清楚表达，把事务交给可靠的盟友。",
}, {
  id: "exusiai",
  name: "能天使",
  description: "来自企鹅物流的活力伙伴，爽快、俏皮，办起正事也很可靠。",
  kind: "builtin",
  theme: "red",
  avatar: "exusiai",
  identity: { zh: "能天使 / 企鹅物流", en: "EXUSIAI / PENGUIN LOGISTICS" },
  welcome: { zh: "老板，今天有什么差事？", en: "Leader, what's on the list today?" },
  caption: "认真办事，轻松说话，给今天留一点好心情。",
}, {
  id: "saileach",
  name: "琴柳",
  description: "温和而坚定的执旗手，认真倾听，陪博士把眼前的事做好。",
  kind: "builtin",
  theme: "yellow",
  avatar: "saileach",
  identity: { zh: "琴柳 / 罗德岛", en: "SAILEACH / RHODES ISLAND" },
  welcome: { zh: "博士，今天需要我帮您做些什么？", en: "Doctor, how can I help you today?" },
  caption: "温柔地倾听，清楚地判断，一起找到前行的方向。",
}, {
  id: "mountain",
  name: "山",
  description: "沉稳而坦率的罗德岛近卫，重视分寸，也认真对待朋友的托付。",
  kind: "builtin",
  theme: "blue",
  avatar: "mountain",
  identity: { zh: "山 / 罗德岛", en: "MOUNTAIN / RHODES ISLAND" },
  welcome: { zh: "我在，博士。今天有什么需要处理？", en: "I'm here, Doctor. What needs our attention?" },
  caption: "从容判断，坦率沟通，认真对待每一份托付。",
}] as const;

export type BuiltinAgentPersona = typeof BUILTIN_AGENT_PERSONAS[number];
export type AgentPersona = UploadedAgentPersona | BuiltinAgentPersona;
export const AGENT_PERSONA_SELECTION_KEY = "riic.agent.persona.selection.v1";

export function builtinAgentPersona(id: unknown): BuiltinAgentPersona | undefined {
  return BUILTIN_AGENT_PERSONAS.find(persona => persona.id === id);
}

/** A missing selection preserves uploaded cards saved before built-in choices existed. */
export function resolveAgentPersonaSelection(selection: string | null, uploaded: UploadedAgentPersona | null): AgentPersona | null {
  if (selection === "default") return null;
  return builtinAgentPersona(selection) ?? uploaded;
}
