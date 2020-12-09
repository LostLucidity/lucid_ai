"use strict";
// //@ts-check
// "use strict"
// import fs from 'fs';
// import path from 'path';
// import {
//   createAgent, 
//   createEngine, 
//   createPlayer
// } from '@node-sc2/core';
Object.defineProperty(exports, "__esModule", { value: true });
// // const path = require('path');
// const {  } = require('');
// const {
//   Difficulty,
//   PlayerType,
//   Race,
// } = require('@node-sc2/core/constants/enums');
// const maps = require('../src/maps')
// const systems = require('./builds/systems/systems');
// const race = Race.ZERG;
// const map = maps[Math.floor(Math.random() * maps.length)];
// const settings = {
//   type: PlayerType.PARTICIPANT,
//   race: race,
// }
// const blueprint = {
//   settings: {
//     type: PlayerType.PARTICIPANT,
//     race: race,
//   },
// }
// const bot = createAgent(blueprint);
// for(let system of systems) {
//   bot.use(system);
// }
// const engine = createEngine();
// engine.connect().then(async () => {
//   console.log('map', map);
//   return engine.runGame(
//     map,
//     [
//       createPlayer({ 
//         race: settings.race 
//       }, bot),
//       createPlayer({ 
//         race: Race.RANDOM, 
//         difficulty: Difficulty.VERYHARD 
//       }),
//     ]
//   );
// }).then(async ([world, results]) => {
//   console.log('GAME RESULTS: ', results);
//   const { actions } = world.resources.get();
//   const replay = await actions._client.saveReplay();
//   fs.writeFileSync(path.join(__dirname, 'replays', `${Date.now()}.sc2replay`), replay.data);
// }).catch(error => {
//   console.log('connect error', error)
// });
var service_container_1 = require("./service-container");
var service = service_container_1.default.container.action_service;
