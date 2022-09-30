//@ts-check
"use strict"

const { RALLY_BUILDING, SMART } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { rallyWorkersAbilities } = require("@node-sc2/core/constants/groups");
const { EGG, DRONE } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getMineralFieldAssignments, getTargetedByWorkers, setPendingOrders } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const { getClosestExpansion, getPathablePositions } = require("./map-resource-service");
const { getClosestUnitByPath,  getClosestPositionByPath, getClosestUnitFromUnit } = require("./resources-service");

const resourceManagerService = {
  /** @type {Point2D} */
  combatRally: null,
  /**
   * @param {ResourceManager} resources
   * @param {Unit} unit 
   * @param {Unit | null} mineralField
   * @param {boolean} queue 
   * @returns {SC2APIProtocol.ActionRawUnitCommand | null}
   */
  gather: (resources, unit, mineralField, queue = true) => {
    const { units } = resources.get();
    const { pos: unitPos } = unit;
    if (unitPos === undefined) { return null; }
    if (unit.labels.has('command') && queue === false) {
      console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
      queue = true;
    }
    const ownBases = units.getBases(Alliance.SELF).filter(b => b.buildProgress >= 1);
    let target;
    if (mineralField && mineralField.tag) {
      target = mineralField;
    } else {
      let targetBase;
      const needyBases = ownBases.filter(base => {
        const { assignedHarvesters, idealHarvesters } = base;
        if (assignedHarvesters === undefined || idealHarvesters === undefined) { return false; }
        return assignedHarvesters < idealHarvesters
      });
      if (needyBases.length > 0) {
        targetBase = getClosestUnitFromUnit(resources, unit, needyBases);
        if (targetBase === undefined || targetBase.pos === undefined) { return null; }
        [target] = getUnitsWithinDistance(targetBase.pos, units.getMineralFields(), 8).sort((a, b) => {
          const targetedByWorkersACount = getTargetedByWorkers(units, a).length;
          const targetedByWorkersBCount = getTargetedByWorkers(units, b).length;
          return targetedByWorkersACount - targetedByWorkersBCount;
        });
      } else {
        targetBase = getClosestUnitFromUnit(resources, unit, ownBases);
        [target] = getUnitsWithinDistance(unitPos, units.getMineralFields(), 8).sort((a, b) => {
          const targetedByWorkersACount = getTargetedByWorkers(units, a).length;
          const targetedByWorkersBCount = getTargetedByWorkers(units, b).length;
          return targetedByWorkersACount - targetedByWorkersBCount;
        });
      }
    }
    if (target) {
      const sendToGather = createUnitCommand(SMART, [unit]);
      sendToGather.targetUnitTag = target.tag;
      sendToGather.queueCommand = queue;
      setPendingOrders(unit, sendToGather);
      return sendToGather;
    }
    return null;
  },
  /**
   * @param {ResourceManager} resources
   * @param {Point2D} unitPosition
   * @param {Point2D} position
   * @returns {Point2D}
   */
  getClosestUnitPositionByPath: (resources, unitPosition, position) => {
    const { map } = resources.get();
    const pathablePositions = getPathablePositions(map, unitPosition);
    const [closestPositionByPath] = getClosestPositionByPath(resources, position, pathablePositions);
    return closestPositionByPath;
  },
  /**
   * @param {World} world 
   * @param {Point2D} position 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  rallyWorkerToTarget: (world, position, mineralTarget = false) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const workerSourceByPath = getWorkerSourceByPath(world, position);
    let rallyAbility = null;
    if (workerSourceByPath) {
      const { orders, pos } = workerSourceByPath;
      if (pos === undefined) return collectedActions;
      if (workerSourceByPath.unitType === EGG) {
        rallyAbility = orders.some(order => order.abilityId === data.getUnitTypeData(DRONE).abilityId) ? RALLY_BUILDING : null;
      } else {
        rallyAbility = rallyWorkersAbilities.find(ability => workerSourceByPath.abilityAvailable(ability));
      }
      if (rallyAbility) {
        const unitCommand = createUnitCommand(rallyAbility, [workerSourceByPath]);
        if (mineralTarget) {
          const [closestExpansion] = getClosestExpansion(map, pos);
            const { mineralFields } = closestExpansion.cluster;
            const mineralFieldCounts = getMineralFieldAssignments(units, mineralFields)
              .filter(mineralFieldAssignments => mineralFieldAssignments.count < 2)
              .sort((a, b) => a.count - b.count);
            if (mineralFieldCounts.length > 0) {
              const mineralField = mineralFieldCounts[0];
              unitCommand.targetUnitTag = mineralField.mineralFieldTag;
            }
        } else {
          unitCommand.targetWorldSpacePos = position;
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },

}

module.exports = resourceManagerService;
 
/**
 * @param {Point2D} pos 
 * @param {Unit[]} units 
 * @param {Number} maxDistance
 * @returns {Unit[]}
 */
function getUnitsWithinDistance(pos, units, maxDistance) {
  return units.filter(unit => {
    const { pos: unitPos } = unit;
    if (unitPos === undefined) { return false; }
    return distance(unitPos, pos) <= maxDistance;
  });
}

/**
 * @param {World} world
 * @param {Point2D} position
 */
function getWorkerSourceByPath(world, position) {
  const { agent, resources } = world;
  const { units } = resources.get();
  // worker source is base or larva.
  let closestUnitByPath = null;
  if (agent.race === Race.ZERG) {
    [closestUnitByPath] = getClosestUnitByPath(resources, position, units.getById(EGG));
  } else {
    [closestUnitByPath] = getClosestUnitByPath(resources, position, units.getBases());
  }
  return closestUnitByPath;
}