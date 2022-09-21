//@ts-check
"use strict"

const { RALLY_BUILDING } = require("@node-sc2/core/constants/ability");
const { Race } = require("@node-sc2/core/constants/enums");
const { rallyWorkersAbilities, gasMineTypes, townhallTypes } = require("@node-sc2/core/constants/groups");
const { EGG, DRONE } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getMineralFieldAssignments } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const { getClosestExpansion, getPathablePositions } = require("./map-resource-service");
const { getClosestUnitByPath, distanceByPath, getClosestPositionByPath } = require("./resources-service");

const resourceManagerService = {
  /** @type {Point2D} */
  combatRally: null,
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
  /**
   * @param {ResourceManager} resources
   * @returns {Boolean}
   */
  shortOnWorkers: (resources) => {
    const { units } = resources.get();
    let idealHarvesters = 0
    let assignedHarvesters = 0
    const mineralCollectors = [...units.getBases(), ...units.getById(gasMineTypes)]
    mineralCollectors.forEach(mineralCollector => {
      const { buildProgress, assignedHarvesters: assigned, idealHarvesters: ideal, unitType } = mineralCollector;
      if (buildProgress === undefined || assigned === undefined || ideal === undefined || unitType === undefined) return;
      if (buildProgress === 1) {
        assignedHarvesters += assigned;
        idealHarvesters += ideal;
      } else {
        if (townhallTypes.includes(unitType)) {
          const mineralFields = units.getMineralFields().filter(mineralField => {
            const { pos } = mineralField;
            const { pos: townhallPos } = mineralCollector;
            if (pos === undefined || townhallPos === undefined) return false;
            if (distance(pos, townhallPos) < 16) {
              const closestPositionByPath = resourceManagerService.getClosestUnitPositionByPath(resources, townhallPos, pos);
              if (closestPositionByPath === undefined) return false;
              const closestByPathDistance = distanceByPath(resources, pos, closestPositionByPath);
              return closestByPathDistance <= 16;
            } else {
              return false;
            }
          });
          idealHarvesters += mineralFields.length * 2 * buildProgress;
        } else {
          idealHarvesters += 3 * buildProgress;
        }
      }
    });
    return idealHarvesters > assignedHarvesters;
  }
}

module.exports = resourceManagerService;

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