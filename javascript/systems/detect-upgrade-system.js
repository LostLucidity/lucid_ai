//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { ZEALOT } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const unitService = require("../services/unit-service");

module.exports = createSystem({
  name: 'DetectUpgrade',
  type: 'agent',
  async onStep(world) {
    if (!unitService.enemyCharge) {
      detectCharge(world.resources);
    }
  },
});

/**
 * @param {ResourceManager} resources 
 */
function detectCharge(resources) {
  const { frame, units } = resources.get();
  let timeElapsed = (frame.getGameLoop() - previousStepTime) / 22.4;
  // calculate zealot position difference of enemy.
  const enemyZealots = units.getById(ZEALOT, { alliance: Alliance.ENEMY });
  let fastestZealot = 0;
  enemyZealots.forEach(zealot => {
    const foundZealot = previousZealotsPositions.find(previousStepZealot => {
      return previousStepZealot.tag === zealot.tag;
    });
    if (foundZealot) {
      const zealotSpeed = distance(foundZealot.pos, zealot.pos) / timeElapsed;
      fastestZealot = fastestZealot > zealotSpeed ? fastestZealot : zealotSpeed; 
    }
  });
  if (fastestZealot > 3.15) {
    unitService.enemyCharge = true;
    console.log('enemy charge detected');
  } 
  previousZealotsPositions = enemyZealots.map(zealot => ({ 'tag': zealot.tag, 'pos': zealot.pos }));
  previousStepTime = frame.getGameLoop();
}

let previousZealotsPositions = [];
let previousStepTime = 0;