import path from "node:path";
import { readFileSync } from "node:fs";
import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { SyntaxKind } from "typescript/unstable/ast";
import * as ts from "typescript/unstable/ast/is";

export const ADAPTER_VERSION = "assemblyscript-result-v1";

/** Check the caller against the disk source and expose its native AST and BOM offset. */
function withSourceAst(source, fileName, callback) {
  // Native API paths use forward slashes, including virtual filesystem keys.
  const file = path.resolve(fileName).replaceAll("\\", "/");
  const config = `${file}.assemblyscript.tsconfig.json`;
  // TypeScript 7 exposes AST and checker data through its native API. The
  // virtual config retains our strict, single-fixture check without writing
  // beside the canonical input or inheriting a caller's tsconfig.
  const api = new API({ fs: createVirtualFileSystem({
    [config]: JSON.stringify({
      compilerOptions: { noEmit: true, strict: true, skipLibCheck: true, target: "es2020", types: [] },
      files: [file],
    }),
  }) });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProject(config);
    const ast = project?.program.getSourceFile(file);
    // The native reader removes one leading BOM; all other text must match.
    const sourceOffset = ast && source.startsWith("\uFEFF") && ast.text === source.slice(1) ? 1 : 0;
    if (!ast || readFileSync(file, "utf8") !== source || ast.text !== source.slice(sourceOffset)) {
      throw new Error("unsupported adaptation: source changed while checking RESULT semantics");
    }
    const diagnostics = project.program.getSyntacticDiagnostics(file);
    if (diagnostics.length) {
      throw new Error(`unsupported adaptation: TypeScript parse error at ${diagnostics[0].pos}`);
    }
    return callback(ast, project.checker, sourceOffset);
  } finally {
    snapshot?.dispose();
    api.close();
  }
}

function isResultCall(statement) {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "log") return false;
  if (!ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== "console") return false;
  if (call.arguments.length !== 1 || !ts.isBinaryExpression(call.arguments[0])) return false;
  const argument = call.arguments[0];
  return argument.operatorToken.kind === SyntaxKind.PlusToken
    && ts.isStringLiteral(argument.left)
    && argument.left.text === "RESULT ";
}

/** Rewrite the final numeric RESULT call while preserving all other source text. */
export function adaptAssemblyScriptSource(source, fileName = "10-fib.ts") {
  return withSourceAst(source, fileName, (ast, checker, sourceOffset) => {
    const last = ast.statements.at(-1);
    if (!last || !isResultCall(last)) {
      throw new Error('unsupported adaptation: expected a final console.log("RESULT " + numericExpression)');
    }
    const resultCall = last.expression;
    const expression = resultCall.arguments[0].right;

    let consoleIdentifiers = 0;
    const identifiers = new Set();
    const visit = (node) => {
      if (ts.isIdentifier(node)) {
        identifiers.add(node.text);
        if (node.text === "console") {
          consoleIdentifiers++;
          if (node !== resultCall.expression.expression) {
            throw new Error("unsupported adaptation: console is referenced or shadowed outside the final RESULT output");
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(ast);
    if (consoleIdentifiers !== 1) {
      throw new Error("unsupported adaptation: console binding is not unambiguous");
    }
    const type = checker.getTypeAtLocation(expression);
    const typeName = type ? checker.typeToString(type) : "unknown";
    if (typeName !== "number" && !/^-?\d+(?:\.\d+)?$/.test(typeName)) {
      throw new Error("unsupported adaptation: RESULT expression is not statically known to be a number");
    }

    let helperName = "__assemblyscriptResultAdapter";
    let suffix = 0;
    while (identifiers.has(helperName)) helperName = `__assemblyscriptResultAdapter${++suffix}`;

    const replacement = `${helperName}(${expression.getText(ast)});`;
    const rewritten = source.slice(0, last.getStart(ast) + sourceOffset) + replacement + source.slice(last.end + sourceOffset);
    const helper = `\nfunction ${helperName}(value: f64): void {\n  assert(isFinite(value) && value % 1.0 == 0.0 && Math.abs(value) <= 9007199254740991.0);\n  console.log("RESULT " + i64(value).toString());\n}\n`;
    return {
      source: rewritten + helper,
      helperName,
      rules: [
        "replace only the final RESULT concatenation with a single helper call",
        "require TypeScript checker to infer a numeric result",
        "assert finite safe-integer value at runtime before integer formatting",
        "preserve all preceding source text and evaluate the result expression once",
      ],
    };
  });
}
