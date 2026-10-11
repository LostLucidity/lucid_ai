const fs = require("fs");
const path = require("path");

const parser = require("@babel/parser");
const nodeSc2Constants = require("@node-sc2/core/constants");

const SOURCE_ROOT = path.resolve(__dirname, "../../src");
const CONSTANTS_MODULE = "@node-sc2/core/constants";

function listActiveSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "old" ? [] : listActiveSourceFiles(entryPath);
    }

    return /\.jsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;

  visit(node);
  Object.values(node).forEach(value => {
    if (Array.isArray(value)) {
      value.forEach(child => walkAst(child, visit));
    } else {
      walkAst(value, visit);
    }
  });
}

function getNamedConstantsImports(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const ast = parser.parse(source, { sourceType: "unambiguous" });
  const importedNames = [];

  walkAst(ast.program, node => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "ObjectPattern") return;
    if (node.init?.type !== "CallExpression" || node.init.callee?.name !== "require") return;

    const [moduleArgument] = node.init.arguments || [];
    if (moduleArgument?.type !== "StringLiteral" || moduleArgument.value !== CONSTANTS_MODULE) return;

    node.id.properties.forEach(property => {
      if (property.type !== "ObjectProperty") return;
      const importedName = property.key?.name || property.key?.value;
      if (typeof importedName === "string") importedNames.push(importedName);
    });
  });

  return importedNames;
}

describe("active node-sc2 constants imports", () => {
  it("imports only symbols exported by the installed package", () => {
    const missingExports = listActiveSourceFiles(SOURCE_ROOT).flatMap(filePath =>
      getNamedConstantsImports(filePath)
        .filter(importedName => !Object.prototype.hasOwnProperty.call(nodeSc2Constants, importedName))
        .map(importedName => ({
          file: path.relative(SOURCE_ROOT, filePath),
          importedName,
        }))
    );

    expect(missingExports).toEqual([]);
  });
});
