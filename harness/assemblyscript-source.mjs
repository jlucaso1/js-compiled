import ts from "typescript";

export const ADAPTER_VERSION = "assemblyscript-result-v1";

function sourceAst(source, fileName) {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) {
    throw new Error(`unsupported adaptation: TypeScript parse error at ${ast.parseDiagnostics[0].start ?? 0}`);
  }
  return ast;
}

function numericType(source, fileName) {
  const options = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    types: [],
  };
  const program = ts.createProgram([fileName], options);
  const checkedAst = program.getSourceFile(fileName);
  if (!checkedAst || checkedAst.text !== source) {
    throw new Error("unsupported adaptation: source changed while checking RESULT semantics");
  }
  const checkedLast = checkedAst.statements.at(-1);
  if (!checkedLast || !isResultCall(checkedLast)) {
    throw new Error("unsupported adaptation: type-checked source no longer has the supported final RESULT output");
  }
  const checkedExpression = checkedLast.expression.arguments[0].right;
  const checker = program.getTypeChecker();
  const type = checker.getTypeAtLocation(checkedExpression);
  const typeName = checker.typeToString(type);
  if (typeName !== "number" && !/^-?\d+(?:\.\d+)?$/.test(typeName)) {
    throw new Error("unsupported adaptation: RESULT expression is not statically known to be a number");
  }
  return type;
}

function isResultCall(statement) {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "log") return false;
  if (!ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== "console") return false;
  if (call.arguments.length !== 1 || !ts.isBinaryExpression(call.arguments[0])) return false;
  const argument = call.arguments[0];
  return argument.operatorToken.kind === ts.SyntaxKind.PlusToken
    && ts.isStringLiteral(argument.left)
    && argument.left.text === "RESULT ";
}

export function adaptAssemblyScriptSource(source, fileName = "10-fib.ts") {
  const ast = sourceAst(source, fileName);
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
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (consoleIdentifiers !== 1) {
    throw new Error("unsupported adaptation: console binding is not unambiguous");
  }
  numericType(source, fileName);

  let helperName = "__assemblyscriptResultAdapter";
  let suffix = 0;
  while (identifiers.has(helperName)) helperName = `__assemblyscriptResultAdapter${++suffix}`;

  const replacement = `${helperName}(${expression.getText(ast)});`;
  const rewritten = source.slice(0, last.getStart(ast)) + replacement + source.slice(last.end);
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
}
