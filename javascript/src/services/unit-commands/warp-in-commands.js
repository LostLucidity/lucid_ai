//@ts-check
"use strict"

const { WarpUnitAbility, UnitType } = require("@node-sc2/core/constants");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { nClosestPoint } = require("@node-sc2/core/utils/geometry/point");
const { getDistance } = require("../../../services/position-service");
const { shuffle } = require("../../../helper/utilities");
const { createUnitCommand } = require("../../shared-utilities/command-utilities");
const { getCombatRally } = require("../shared-config/combatRallyConfig");

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Object?} opts
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function warpInCommands(world, unitType, opts = {}) {
  const { agent, resources } = world;
  const { powerSources } = agent; if (powerSources === undefined) return [];
  const { units, map } = resources.get();
  const abilityId = WarpUnitAbility[unitType];
  const n = opts.maxQty || 1;
  /** @type {Point2D} */
  const nearPosition = opts.nearPosition || map.getCombatRally();
  const qtyToWarp = world.agent.canAffordN(unitType, n);
  const selectedMatricies = units.getClosest(nearPosition, powerSources, opts.nearPosition ? 1 : 3);
  let myPoints = selectedMatricies
    .map(matrix => matrix.pos && matrix.radius ? gridsInCircle(matrix.pos, matrix.radius) : [])
    .reduce((acc, arr) => acc.concat(arr), [])
    .filter(p => map.isPathable(p) && !map.hasCreep(p));
  if (opts.highground) {
    myPoints = myPoints
      .map(p => ({ ...p, z: map.getHeight(p) }))
      .sort((a, b) => b.z - a.z)
      .filter((p, i, arr) => p.z === arr[0].z);
  }
  const myStructures = units.getStructures();
  const points = nClosestPoint(nearPosition, myPoints, 100)
    .filter((/** @type {Point2D} */ point) => myStructures.every(structure => structure.pos && getDistance(structure.pos, point) > 2));
  const warpGates = units.getById(UnitType.WARPGATE).filter(wg => wg.abilityAvailable(abilityId)).slice(0, qtyToWarp);
  /** @type {Point2D[]} */
  const destPoints = shuffle(points).slice(0, warpGates.length);
  return warpGates.map((warpGate, i) => {
    const unitCommand = createUnitCommand(abilityId, [warpGate]);
    unitCommand.targetWorldSpacePos = destPoints[i];
    return unitCommand;
  });
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function warpInSync(world, unitType) {
  const { resources } = world;
  const collectedActions = []
  const nearPosition = getCombatRally(resources);
  console.log('nearPosition', nearPosition);
  collectedActions.push(...warpInCommands(world, unitType, { nearPosition }));
  return collectedActions;
}

module.exports = {
  warpInSync
}

