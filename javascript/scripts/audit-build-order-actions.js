"use strict";

const fs = require("fs").promises;
const path = require("path");

const {
  interpretBuildOrderAction,
  loadActionMappings,
} = require("../data/buildOrders/scripts/buildOrderUtils");

const PROJECT_ROOT = path.join(__dirname, "..");
const SOURCE_PATH = path.join(
  PROJECT_ROOT,
  "data/buildOrders/scripts/scrapedBuildOrders.json"
);
const RACE_NAMES = Object.freeze({ P: "protoss", T: "terran", Z: "zerg" });
const EXPLICIT_UNRESOLVED_CLASSIFICATIONS = Object.freeze({
  "Dark Pylon": {
    classification: "unsupported_runtime_action",
    classificationReason: "No exact installed UnitType, Upgrade, or Ability constant and no special-action executor.",
  },
  "Interference Matrix": {
    classification: "unsupported_runtime_action",
    classificationReason: "No installed Ability constant or special-action executor in this runtime.",
  },
  "crossmap for scout": {
    classification: "narrative_text",
    classificationReason: "Free-form scouting instruction with no executable action identity.",
  },
  "dont worry": {
    classification: "narrative_text",
    classificationReason: "Free-form narrative text with no executable action identity.",
  },
});

function isResolvedAction(action, comment = "") {
  const originalWarn = console.warn;
  console.warn = () => {};
  let interpreted;
  try {
    interpreted = interpretBuildOrderAction(action, comment);
  } finally {
    console.warn = originalWarn;
  }
  return interpreted.length > 0 && interpreted.every(result =>
    result.unitType !== null || result.upgradeType !== null || result.specialAction !== null
  );
}

function findResolvedPrefix(action, comment = "") {
  const words = action.trim().split(/\s+/);
  for (let length = words.length - 1; length > 0; length -= 1) {
    const candidate = words.slice(0, length).join(" ");
    if (isResolvedAction(candidate, comment)) {
      return candidate;
    }
  }
  return null;
}

function classifyUnresolvedAction(action, comment = "") {
  const explicitClassification = EXPLICIT_UNRESOLVED_CLASSIFICATIONS[action];
  if (explicitClassification) {
    return { ...explicitClassification, candidatePrefix: null };
  }

  if (/^Action(?:\s+x\d+)?$/i.test(action)) {
    return {
      classification: "generic_placeholder",
      classificationReason: "Generic source placeholder with no executable action identity.",
      candidatePrefix: null,
    };
  }

  if (/^Action\s+-/i.test(action)) {
    return {
      classification: "placeholder_with_context",
      classificationReason: "Generic source placeholder accompanied by non-authoritative context.",
      candidatePrefix: null,
    };
  }

  const candidatePrefix = findResolvedPrefix(action, comment);
  if (candidatePrefix) {
    return {
      classification: "recognized_prefix_with_unparsed_suffix",
      classificationReason: "A supported action prefix exists, but the remaining source text is not safely executable.",
      candidatePrefix,
    };
  }

  const wordCount = action.trim().split(/\s+/).filter(Boolean).length;
  return {
    classification: wordCount <= 4 ? "short_unmapped_label" : "unstructured_text",
    classificationReason: wordCount <= 4
      ? "Short label with no verified current mapping."
      : "Unstructured source text with no executable action identity.",
    candidatePrefix: null,
  };
}

async function buildUnresolvedActionReport(dataFilePath = SOURCE_PATH) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  try {
    await loadActionMappings();
    const buildOrders = JSON.parse(await fs.readFile(dataFilePath, "utf8"));
    const rows = [];

    for (const buildOrder of buildOrders) {
      const race = RACE_NAMES[buildOrder.raceMatchup?.[0]] || "unknown";
      for (const [stepIndex, step] of buildOrder.steps.entries()) {
        const actionParts = step.action.split(",").map(action => action.trim());
        const interpreted = interpretBuildOrderAction(step.action, step.comment);

        interpreted.forEach((result, actionPartIndex) => {
          const resolved = result.unitType !== null ||
            result.upgradeType !== null ||
            result.specialAction !== null;
          if (resolved) return;

          const action = actionParts[actionPartIndex] || "";
          const classification = classifyUnresolvedAction(action, step.comment);
          rows.push({
            race,
            title: buildOrder.title,
            url: buildOrder.url,
            stepIndex,
            actionPartIndex,
            supply: step.supply ?? null,
            time: step.time ?? null,
            action,
            sourceAction: step.action,
            comment: step.comment || "",
            ...classification,
          });
        });
      }
    }

    const affectedOrders = new Set(rows.map(row => `${row.race}\u0000${row.title}\u0000${row.url}`));
    const byClassification = {};
    const byRace = Object.fromEntries(
      Object.values(RACE_NAMES).map(race => [race, { unresolvedActions: 0, affectedOrders: 0 }])
    );

    for (const row of rows) {
      byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
      if (!byRace[row.race]) {
        byRace[row.race] = { unresolvedActions: 0, affectedOrders: 0 };
      }
      byRace[row.race].unresolvedActions += 1;
    }

    for (const race of Object.keys(byRace)) {
      byRace[race].affectedOrders = new Set(
        rows.filter(row => row.race === race).map(row => `${row.title}\u0000${row.url}`)
      ).size;
    }

    return {
      source: path.relative(PROJECT_ROOT, dataFilePath).replace(/\\/g, "/"),
      summary: {
        buildOrders: buildOrders.length,
        unresolvedActions: rows.length,
        affectedOrders: affectedOrders.size,
        byRace,
        byClassification,
      },
      rows,
    };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

if (require.main === module) {
  buildUnresolvedActionReport()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order action audit failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildUnresolvedActionReport,
};
