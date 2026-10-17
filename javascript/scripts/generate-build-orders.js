"use strict";

const path = require("path");

const { generateBuildOrderFiles } = require("../data/buildOrders/scripts/buildOrderUtils");

const sourcePath = path.join(
  __dirname,
  "../data/buildOrders/scripts/scrapedBuildOrders.json"
);

generateBuildOrderFiles(sourcePath)
  .then(counts => {
    console.log(
      `Generated build orders: ${counts.protoss} Protoss, ${counts.terran} Terran, ${counts.zerg} Zerg.`
    );
  })
  .catch(error => {
    console.error(`Build-order generation failed: ${error.message}`);
    process.exitCode = 1;
  });
