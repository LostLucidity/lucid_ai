//@ts-check
"use strict"

const { DifficultyId, RaceId } = require('@node-sc2/core/constants/enums');
const fs = require('fs');
const path = require('path');
const scoutService = require('../systems/scouting/scouting-service');
const agentService = require('./agent-service');
const loggingService = require('./logging-service');

const fileSavingService = {
  saveReplay: (replay) => {
    fs.writeFileSync(path.join(__dirname, '../replays', `${Date.now()}.SC2Replay`), replay.data);
  },
  /**
   * 
   * @param {World['agent']} agent 
   * @param {string} map 
   */
  saveExecutedStepsLog: (agent, map) => {
    let selfRace = RaceId[agent.race];
    let opponentRace = RaceId[scoutService.opponentRace];
    let difficulty = DifficultyId[agentService.difficulty];
    const file = fs.createWriteStream(path.join(__dirname, '../logs', `${Date.now()}_Lucid_${difficulty}_${selfRace.charAt(0)}v${opponentRace.charAt(0)}_${map.replace(/\s+/g, '')}.txt`));
    loggingService.executedSteps.forEach(step => {
      file.write(`${JSON.stringify(step).replace(/,/g, ', ')},` + '\n');
    });
  },
}

module.exports = fileSavingService;