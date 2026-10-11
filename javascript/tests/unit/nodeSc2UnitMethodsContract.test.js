const fs = require("fs");
const path = require("path");

const parser = require("@babel/parser");

const SOURCE_ROOT = path.resolve(__dirname, "../../src");
const CREATE_UNIT_PATH = path.join(
  path.dirname(require.resolve("@node-sc2/core")),
  "engine/create-unit.js"
);
const UNIT_RECEIVER_PATTERN = /(?:^u$|unit|worker|mule|probe|scv|drone|base|townhall|structure|building|builder|field|geyser|mine|larva|warpgate|trainer|upgrader|producer|addon|scout|depot|nexus|orbitalcommand)$/i;
const UNIT_METHOD_PATTERN = /^(?:ability|available|addLabel|getLabel|getLife|has|is|can|removeLabel|update|inject|blink|burrow|toggle)/;

function parseFile(filePath) {
  return parser.parse(fs.readFileSync(filePath, "utf8"), {
    sourceType: "unambiguous",
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

function listActiveSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "old" ? [] : listActiveSourceFiles(entryPath);
    }

    return /\.jsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function getInstalledUnitMethods() {
  const methods = new Set();

  walkAst(parseFile(CREATE_UNIT_PATH).program, node => {
    if (node.type !== "VariableDeclarator" || node.id?.name !== "blueprint") return;
    if (node.init?.type !== "ObjectExpression") return;

    node.init.properties.forEach(property => {
      if (property.type !== "ObjectMethod") return;
      const methodName = property.key?.name || property.key?.value;
      if (typeof methodName === "string") methods.add(methodName);
    });
  });

  return methods;
}

function getDirectUnitMethodCalls(filePath, installedMethods) {
  const calls = [];

  walkAst(parseFile(filePath).program, node => {
    if (node.type !== "CallExpression" || node.callee?.type !== "MemberExpression") return;
    if (node.callee.computed || node.callee.object?.type !== "Identifier") return;

    const receiver = node.callee.object.name;
    const method = node.callee.property?.name;
    if (!UNIT_METHOD_PATTERN.test(method)) return;

    calls.push({ method, receiver });
  });

  const installedMethodReceivers = new Set(
    calls
      .filter(({ method }) => installedMethods.has(method) && method !== "update")
      .map(({ receiver }) => receiver)
  );

  return calls.filter(({ receiver }) =>
    UNIT_RECEIVER_PATTERN.test(receiver) || installedMethodReceivers.has(receiver)
  );
}

describe("active node-sc2 unit method calls", () => {
  it("uses only helpers implemented by the installed create-unit factory", () => {
    const installedMethods = getInstalledUnitMethods();
    const directUnitMethodCalls = listActiveSourceFiles(SOURCE_ROOT).flatMap(filePath =>
      getDirectUnitMethodCalls(filePath, installedMethods)
        .map(({ method, receiver }) => ({
          file: path.relative(SOURCE_ROOT, filePath),
          method,
          receiver,
        }))
    );
    const missingMethods = directUnitMethodCalls
        .filter(({ method }) => !installedMethods.has(method))
        .map(({ file, method, receiver }) => ({ file, method, receiver }));

    expect(installedMethods.has("isGathering")).toBe(true);
    expect(directUnitMethodCalls.length).toBeGreaterThan(0);
    expect(missingMethods).toEqual([]);
  });
});
