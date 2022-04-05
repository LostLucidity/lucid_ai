//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { ZEALOT, ZERGLING } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const unitService = require("../services/unit-service");

module.exports = createSystem({
  name: 'DetectUpgrade',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { frame, units } = resources.get();
    const unitTypes = [];
    if (!unitService.enemyCharge) {
      detectCharge(world);
      unitTypes.push(ZEALOT);
    }
    if (!unitService.enemyMetabolicBoost) {
      detectMetabolicBoost(world);
      unitTypes.push(ZERGLING);
    }
    previousUnitsPositions = units.getById(unitTypes, { alliance: Alliance.ENEMY }).map(unit => ({ 'tag': unit.tag, 'pos': unit.pos }));
    previousStepTime = frame.getGameLoop();
  },
});

/**
 * @param {World} world 
 */
function detectCharge(world) {
  const { data, resources } = world;
  const { frame, units } = resources.get();
  let timeElapsed = (frame.getGameLoop() - previousStepTime) / 22.4;
  // calculate zealot position difference of enemy.
  const unitsById = units.getById(ZEALOT, { alliance: Alliance.ENEMY });
  const fastestUnitSpeed = getFastestUnitSpeed(unitsById, timeElapsed);
  if (fastestUnitSpeed + 0.01 > data.getUnitTypeData(ZEALOT).movementSpeed) {
    unitService.enemyCharge = true;
    console.log('enemy charge detected');
  } 
}

let previousUnitsPositions = [];
let previousStepTime = 0;

/**
 * @param {World} world 
 */
function detectMetabolicBoost(world) {
  const { data, resources } = world;
  const { frame, units } = resources.get();
  let timeElapsed = (frame.getGameLoop() - previousStepTime) / 22.4;
  // calculate unit position difference of enemy.
  const unitsById = units.getById(ZERGLING, { alliance: Alliance.ENEMY });
  const fastestUnitSpeed = getFastestUnitSpeed(unitsById, timeElapsed);
  if (fastestUnitSpeed > data.getUnitTypeData(ZERGLING).movementSpeed) {
    unitService.enemyMetabolicBoost = true;
    console.log('enemy metabolic boost detected');
  }
}

/** 
 * @param {Unit[]} unitsById 
 * @param {number} timeElapsed
 */
function getFastestUnitSpeed(unitsById, timeElapsed) {
  let fastestUnitSpeed = 0;
  unitsById.forEach(unit => {
    const foundUnit = previousUnitsPositions.find(previousStepUnit => {
      return previousStepUnit.tag === unit.tag;
    });
    if (foundUnit) {
      const unitSpeed = distance(foundUnit.pos, unit.pos) / timeElapsed;
      fastestUnitSpeed = fastestUnitSpeed > unitSpeed ? fastestUnitSpeed : unitSpeed;
    }
  });
  return fastestUnitSpeed / 1.4;
}

