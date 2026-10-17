"use strict";

const findProcessPath = require.resolve('find-process');

const windowsFindProcess = require('./windowsFindProcess');

if (process.platform === 'win32') {
  require(findProcessPath);
  require.cache[findProcessPath].exports = windowsFindProcess;
}

module.exports = require('@node-sc2/core');
