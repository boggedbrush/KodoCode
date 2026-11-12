// Brand codemod: rewrites the upstream product name in string and template literals
// to `${APP_BASE_NAME}` using the TypeScript parser, so comments, keys, types and
// imports are never touched. Literals where a rewrite could change behaviour are
// reported, not guessed. Deterministic and idempotent.
import ts from "typescript-legacy";

export interface CodemodOptions {
  readonly brand: string;
  readonly expression: string;
  readonly importName: string;
  readonly importFrom: string;
  // A literal whose source text contains one of these strings is left alone.
  readonly keepTexts: ReadonlyArray<string>;
}

export interface CodemodReport {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface CodemodResult {
  readonly output: string;
  readonly rewritten: number;
  readonly kept: number;
  // Literals that need a human: left as they were.
  readonly reports: ReadonlyArray<CodemodReport>;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const SEARCH_METHODS = new Set([
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "equals",
  "localeCompare",
  "match",
  "matchAll",
  "test",
  "replace",
  "replaceAll",
  "split",
]);
const LITERAL_FACTORIES = new Set(["Literal", "Literals", "TemplateLiteral"]);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

type Context = { readonly skip: true } | { readonly report: string } | undefined;

const calleeName = (call: ts.CallLikeExpression): string | undefined => {
  if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) return undefined;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
};

// Where the literal sits decides whether it may be rewritten: `skip` is silent
// (keys, types, module specifiers), `report` asks for a human, undefined rewrites.
const classifyContext = (node: ts.Node): Context => {
  let child: ts.Node = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return { skip: true };
    if (ts.isLiteralTypeNode(parent) || ts.isImportTypeNode(parent)) return { skip: true };
    if (ts.isExternalModuleReference(parent)) return { skip: true };
    if (
      (ts.isPropertyAssignment(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isEnumMember(parent) ||
        ts.isMethodDeclaration(parent)) &&
      parent.name === child
    ) {
      return { skip: true };
    }
    if (ts.isComputedPropertyName(parent)) return { report: "computed property key" };
    if (ts.isTaggedTemplateExpression(parent)) return { report: "tagged template literal" };
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === child) {
      return { report: "element access key" };
    }
    if (ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind)) {
      return { report: "string used in a comparison" };
    }
    if (ts.isCaseClause(parent) && parent.expression === child) {
      return { report: "string used as a switch case" };
    }
    if (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) {
      const type = parent.type;
      if (ts.isTypeReferenceNode(type) && type.typeName.getText() === "const") {
        return { report: "const assertion would change the literal type" };
      }
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      const name = calleeName(parent);
      const isArgument = parent.arguments?.some((argument) => argument === child) ?? false;
      if (isArgument && name !== undefined) {
        if (SEARCH_METHODS.has(name) || name === "RegExp") {
          return { report: `argument of ${name}(), a comparison or search` };
        }
        if (LITERAL_FACTORIES.has(name)) return { report: `argument of ${name}(), a literal type` };
      }
    }
    if (
      ts.isStatement(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isReturnStatement(parent)
    ) {
      return undefined;
    }
  }
  return undefined;
};

// A string literal's body as template-literal text: quotes dropped, the
// delimiter's escape undone, and the characters a template treats specially escaped.
const stringBodyAsTemplate = (raw: string, quote: string): string => {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i] as string;
    const next = raw[i + 1];
    if (char === "\\" && next !== undefined) {
      out += next === quote ? next : `${char}${next}`;
      i++;
    } else if (char === "`") out += "\\`";
    else if (char === "$" && next === "{") out += "\\$";
    else out += char;
  }
  return out;
};

const lineOf = (sf: ts.SourceFile, position: number): number =>
  sf.getLineAndCharacterOfPosition(position).line + 1;

const preview = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 100);

export const transformBrandLiterals = (
  source: string,
  fileName: string,
  options: CodemodOptions,
): CodemodResult => {
  if (!source.includes(options.brand)) {
    return { output: source, rewritten: 0, kept: 0, reports: [] };
  }
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const interpolation = `\${${options.expression}}`;
  const edits: Edit[] = [];
  const reports: CodemodReport[] = [];
  let rewritten = 0;
  let kept = 0;

  const rewriteText = (text: string): string => text.split(options.brand).join(interpolation);

  const consider = (node: ts.Node, build: () => Edit[]) => {
    const text = node.getText(sf);
    if (!text.includes(options.brand)) return;
    if (options.keepTexts.some((keep) => text.includes(keep))) {
      kept++;
      return;
    }
    const context = classifyContext(node);
    if (context && "skip" in context) return;
    if (context) {
      reports.push({
        line: lineOf(sf, node.getStart(sf)),
        text: preview(text),
        reason: context.report,
      });
      return;
    }
    edits.push(...build());
    rewritten++;
  };

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) {
      consider(node, () => {
        const start = node.getStart(sf);
        const quote = source[start] as string;
        const body = stringBodyAsTemplate(source.slice(start + 1, node.end - 1), quote);
        return [{ start, end: node.end, text: `\`${rewriteText(body)}\`` }];
      });
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      consider(node, () => {
        const start = node.getStart(sf);
        return [
          {
            start,
            end: node.end,
            text: `\`${rewriteText(source.slice(start + 1, node.end - 1))}\``,
          },
        ];
      });
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head, ...node.templateSpans.map((span) => span.literal)];
      const text = parts.map((part) => part.text).join("");
      if (text.includes(options.brand)) {
        const keepHit = options.keepTexts.some((keep) => node.getText(sf).includes(keep));
        const context = classifyContext(node);
        if (keepHit) kept++;
        else if (context && "skip" in context) {
          // Silent: a key, type or module specifier.
        } else if (context) {
          reports.push({
            line: lineOf(sf, node.getStart(sf)),
            text: preview(node.getText(sf)),
            reason: context.report,
          });
        } else {
          for (const part of parts) {
            const start = part.getStart(sf);
            const open = 1;
            const close = part === node.head || part !== parts.at(-1) ? 2 : 1;
            const inner = source.slice(start + open, part.end - close);
            if (!inner.includes(options.brand)) continue;
            const prefix = source.slice(start, start + open);
            const suffix = source.slice(part.end - close, part.end);
            edits.push({ start, end: part.end, text: `${prefix}${rewriteText(inner)}${suffix}` });
          }
          rewritten++;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (rewritten === 0) return { output: source, rewritten, kept, reports };

  const importEdit = importEditFor(sf, source, options);
  if ("report" in importEdit) {
    return {
      output: source,
      rewritten: 0,
      kept,
      reports: [{ line: 1, text: options.importName, reason: importEdit.report }, ...reports],
    };
  }
  if (importEdit.edit) edits.push(importEdit.edit);

  const output = edits
    .toSorted((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  return { output, rewritten, kept, reports };
};

const importEditFor = (
  sf: ts.SourceFile,
  source: string,
  options: CodemodOptions,
): { readonly edit?: Edit } | { readonly report: string } => {
  const imports = sf.statements.filter(ts.isImportDeclaration);
  let present = false;
  let target: ts.ImportDeclaration | undefined;
  for (const declaration of imports) {
    const clause = declaration.importClause;
    const named = clause?.namedBindings;
    const from = (declaration.moduleSpecifier as ts.StringLiteral).text;
    const specifiers = named && ts.isNamedImports(named) ? named.elements : [];
    const hasName = specifiers.some((element) => element.name.text === options.importName);
    if (hasName && from === options.importFrom) present = true;
    else if (hasName || clause?.name?.text === options.importName) {
      return { report: `${options.importName} is already imported from ${from}` };
    }
    if (from === options.importFrom && !clause?.isTypeOnly && named && ts.isNamedImports(named)) {
      target = declaration;
    }
  }
  if (present) return {};
  const declaredElsewhere = sf.statements.some(
    (statement) =>
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (d) => d.name.getText(sf) === options.importName,
        )) ||
      (ts.isFunctionDeclaration(statement) && statement.name?.text === options.importName),
  );
  if (declaredElsewhere) return { report: `${options.importName} is declared in this file` };

  const named = target?.importClause?.namedBindings;
  if (target && named && ts.isNamedImports(named) && named.elements.length > 0) {
    const before = named.elements.find((element) => element.name.text > options.importName);
    if (before) {
      return {
        edit: {
          start: before.getStart(sf),
          end: before.getStart(sf),
          text: `${options.importName}, `,
        },
      };
    }
    const last = named.elements[named.elements.length - 1] as ts.ImportSpecifier;
    return { edit: { start: last.end, end: last.end, text: `, ${options.importName}` } };
  }
  const line = `import { ${options.importName} } from "${options.importFrom}";`;
  const last = imports.at(-1);
  if (last) return { edit: { start: last.end, end: last.end, text: `\n${line}` } };
  const shebang = source.startsWith("#!") ? source.indexOf("\n") + 1 : 0;
  return { edit: { start: shebang, end: shebang, text: `${line}\n` } };
};

// Source tokens with formatting removed: whitespace, newlines and trailing commas
// (a formatter adds and drops those). Two files with equal tokens are the same code.
export const normalizedTokens = (source: string, fileName = "file.ts"): string[] => {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tokens: string[] = [];
  const walk = (node: ts.Node) => {
    const children = node.getChildren(sf);
    if (ts.isJSDoc(node)) return;
    if (
      children.length === 0 ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push(node.getText(sf));
      return;
    }
    for (const child of children) walk(child);
  };
  walk(sf);
  return tokens.filter(
    (token, index) =>
      !(token === "," && [")", "]", "}"].includes(tokens[index + 1] ?? "")) &&
      !(token === ";" && tokens[index + 1] === "}"),
  );
};
