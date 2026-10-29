import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import test from "node:test";

test("client modules do not translate before the feature's messages are loaded", () => {
  const eager = [];
  for (const directory of ["apps/arknights/src", "apps/endfield/src", "packages/shell", "packages/arknights-domain/src"]) {
    for (const name of fs.readdirSync(directory, { recursive: true })) {
      if (!/\.tsx?$/.test(name) || /node_modules|generated|\.test\.|[\\/]server[\\/]/.test(name)) continue;
      const file = `${directory}/${name}`, source = fs.readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const visit = (node, depth = 0) => {
        if (ts.isFunctionLike(node)) depth++;
        if (!depth && ts.isCallExpression(node) && /\.(text|rich)$/.test(node.expression.getText())) eager.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        ts.forEachChild(node, child => visit(child, depth));
      };
      visit(ast);
    }
  }
  assert.deepEqual(eager, [], "Module initialization must not depend on a current or preloaded locale");
});
