//@ts-check
"use strict"

const { rallyWorkersAbilities } = require("@node-sc2/core/constants/groups");
const { getClosestUnitByPath } = require("../helper/get-closest-by-path");
const { createUnitCommand } = require("./actions-service");

const resourceManagerService = {
  /** @type {Point2D} */
  combatRally: null,
  /**
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  rallyWorkerToMinerals: (resources, position) => {
    const { units } = resources.get();
    const collectedActions = [];
    const [closestBaseByPath] = getClosestUnitByPath(resources, position, units.getBases());
    if (closestBaseByPath) {
      const [mineralFieldTarget] = units.getClosest(closestBaseByPath.pos, units.getMineralFields());
      const rallyAbility = rallyWorkersAbilities.find(ability => closestBaseByPath.abilityAvailable(ability));
      const unitCommand = createUnitCommand(rallyAbility, [closestBaseByPath]);
      unitCommand.targetUnitTag = mineralFieldTarget.tag;
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
  /**
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  rallyWorkerToPosition: (resources, position) => {
    const collectedActions = [];
    const [closestBaseByPath] = getClosestUnitByPath(resources, position, resources.get().units.getBases())
    if (closestBaseByPath) {
      const rallyAbility = rallyWorkersAbilities.find(ability => closestBaseByPath.abilityAvailable(ability));
      const unitCommand = createUnitCommand(rallyAbility, [closestBaseByPath]);
      unitCommand.targetWorldSpacePos = position;
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
}

module.exports = resourceManagerService;