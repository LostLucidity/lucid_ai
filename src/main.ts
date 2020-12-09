import fs from 'fs';
import path from 'path';
import {
  createAgent, 
  createEngine, 
  createPlayer
} from '@node-sc2/core';

import {
  Difficulty,
  PlayerType,
  Race,
} from '@node-sc2/core/constants/enums';
import { maps } from './maps';
import { systems } from './systems/systems';

//Question: Why is the race being setup here
const race = Race.ZERG;
const map = maps[Math.floor(Math.random() * maps.length)];

const bot = createAgent({
  settings: {
    type: PlayerType.PARTICIPANT,
    race: race,
  },
});

for(let system of systems) {
  bot.use(system.createSystem());
}

const engine = createEngine();

engine.connect().then(async () => {
  console.log('map', map);
  return engine.runGame(
    map,
    [
      createPlayer({ 
        race: race
      }, bot),
      createPlayer({ 
        race: Race.RANDOM, 
        difficulty: Difficulty.VERYHARD 
      }),
    ]
  );
}).then(async ([world, results]) => {
  console.log('GAME RESULTS: ', results);
  const { actions } = world.resources.get();

  const replay = await actions._client.saveReplay();
  fs.writeFileSync(path.join(__dirname, 'replays', `${Date.now()}.sc2replay`), replay.data);
}).catch(error => {
  console.log('connect error', error)
});
