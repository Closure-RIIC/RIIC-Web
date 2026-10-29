import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import nextIntl from "@x18n/builtins/presets/next-intl";

/** Use the runtime's grammar, including nested selectors, rich tags and ICU quoting. */
export const icu = {
  id: "icu",
  example: "{name}",
  find(value) {
    let nodes;
    try { nodes = parse(value, { captureLocation: true }); }
    catch { return []; } // invalid-syntax reports the parser error separately.
    const result = [];
    function visit(elements) {
      for (const node of elements) {
        if (node.type !== TYPE.literal && node.type !== TYPE.pound) {
          const range = { start: node.location.start.offset, end: node.location.end.offset };
          result.push({ syntax: "icu", name: node.type === TYPE.tag ? `<${node.value}>` : node.value, text: value.slice(range.start, range.end), range });
        }
        if (node.children) visit(node.children);
        if (node.options) for (const option of Object.values(node.options)) visit(option.value);
      }
    }
    visit(nodes);
    return result;
  },
  validate(value) {
    try { parse(value); return []; }
    catch (error) { return [error.message]; }
  },
};

// x18n 0.1.2's regex-based ICU parser treats select bodies as parameters and
// misses non-ASCII argument names. Keep its call scanner and replace only grammar.
export function nextIntlWithRuntimeGrammar() {
  const preset = nextIntl();
  return { ...preset, plugins: preset.plugins.map(plugin => ({ ...plugin, placeholders: [icu] })) };
}
