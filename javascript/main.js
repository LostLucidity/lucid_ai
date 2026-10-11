"use strict";

// Stable package and ladder entrypoint. The actively maintained bot lives in
// src/starcraftBot.js; keeping this wrapper preserves the existing main.js
// contract without loading the abandoned pre-refactor system graph.
const bot = require('./src/starcraftBot');

if (require.main === module) {
  bot.run().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = bot;
