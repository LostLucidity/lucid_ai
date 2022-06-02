//@ts-check
"use strict"

const { RALLY_BUILDING } = require("@node-sc2/core/constants/ability");
const { Race } = require("@node-sc2/core/constants/enums");
const { rallyWorkersAbilities } = require("@node-sc2/core/constants/groups");
const { EGG, DRONE } = require("@node-sc2/core/constants/unit-type");
const { getMineralFieldAssignments } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const { getClosestExpansion } = require("./map-resource-service");
const { getClosestUnitByPath } = require("./resources-service");

const resourceManagerService = {
  /** @type {Point2D} */
  combatRally: null,
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
      if (workerSourceByPath.unitType === EGG) {
        const { orders } = workerSourceByPath;
        rallyAbility = orders.some(order => order.abilityId === data.getUnitTypeData(DRONE).abilityId) ? RALLY_BUILDING : null;
      } else {
        rallyAbility = rallyWorkersAbilities.find(ability => workerSourceByPath.abilityAvailable(ability));
      }
      if (rallyAbility) {
        const unitCommand = createUnitCommand(rallyAbility, [workerSourceByPath]);
        if (mineralTarget) {
          const [closestBase] = getClosestUnitByPath(resources, workerSourceByPath.pos, units.getBases());
          if (closestBase) {
            const [closestExpansion] = getClosestExpansion(map, closestBase.pos);
            const { mineralFields } = closestExpansion.cluster;
            const mineralFieldCounts = getMineralFieldAssignments(units, mineralFields)
              .filter(mineralFieldAssignments => mineralFieldAssignments.count < 2)
              .sort((a, b) => a.count - b.count);
            if (mineralFieldCounts.length > 0) {
              const mineralField = mineralFieldCounts[0];
              unitCommand.targetUnitTag = mineralField.mineralFieldTag;
            }
          }
        } else {
          unitCommand.targetWorldSpacePos = position;
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
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