//@ts-check
"use strict";

// src/resourceManagement.js

// Import necessary constants and modules
const { getTimeToTargetTech } = require('./gameData');
const { addEarmark } = require('./resourceUtils');

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 **/
function getTimeToTargetCost(world, unitType) {
  const { agent, data, resources } = world;
  const { minerals } = agent; if (minerals === undefined) return Infinity;
  const { frame } = resources.get();
  const { score } = frame.getObservation(); if (score === undefined) return Infinity;
  const { scoreDetails } = score; if (scoreDetails === undefined) return Infinity;
  const collectionRunup = frame.getGameLoop() < 292;
  let { collectionRateMinerals, collectionRateVespene } = scoreDetails; if (collectionRateMinerals === undefined || collectionRateVespene === undefined) return Infinity;
  if (collectionRunup) {
    collectionRateMinerals = 615;
    collectionRateVespene = 0;
  }
  addEarmark(data, data.getUnitTypeData(unitType));
  let earmarkTotals = data.getEarmarkTotals('');
  const { minerals: earmarkMinerals, vespene: earmarkVespene } = earmarkTotals;
  const mineralsLeft = earmarkMinerals - minerals;
  const vespeneLeft = earmarkVespene - (agent.vespene ?? 0);
  const mineralCollectionRate = collectionRateMinerals / 60;
  if (mineralCollectionRate === 0) return Infinity;
  const timeToTargetMinerals = mineralsLeft / mineralCollectionRate;
  const { vespeneCost } = data.getUnitTypeData(unitType); if (vespeneCost === undefined) return Infinity;
  const vespeneCollectionRate = collectionRateVespene / 60;
  let timeToTargetVespene = 0;
  if (vespeneCost > 0) {
    if (vespeneCollectionRate === 0) {
      return Infinity;
    } else {
      timeToTargetVespene = vespeneLeft / vespeneCollectionRate;
    }
  }
  return Math.max(timeToTargetMinerals, timeToTargetVespene);
}

/**
 * Calculates the time in seconds until the agent can afford the specified unit type.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number} The time in seconds until the unit can be afforded.
 */
function getTimeUntilCanBeAfforded(world, unitType) {
  const timeToTargetCost = getTimeToTargetCost(world, unitType);
  const timeToTargetTech = getTimeToTargetTech(world, unitType);

  // The time until the unit can be afforded is the maximum of the two times
  return Math.max(timeToTargetCost, timeToTargetTech);
}

module.exports = {
  getTimeToTargetCost,
  getTimeUntilCanBeAfforded,
};
