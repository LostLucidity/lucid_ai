//@ts-check
"use strict"

const { rallyWorkersAbilities } = require("@node-sc2/core/constants/groups");
const { distanceByPath, getClosestUnitByPath } = require("../helper/get-closest-by-path");
const { getCombatRally } = require("../helper/location");
const { createUnitCommand } = require("./actions-service");
const { moveAwayPosition } = require("./position-service");

const resourceManagerService = {
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
  /**
   * @param {ResourceManager} resources 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {Point2D}
   */
  retreatToExpansion: (resources, unit, targetUnit) => {
    const { map } = resources.get();
    // retreat to rally if closer, else to closest expansion.
    const combatRallyPosition = getCombatRally(resources)
    if (
      distanceByPath(resources, targetUnit.pos, combatRallyPosition) > 16 &&
      distanceByPath(resources, unit.pos, combatRallyPosition) <= distanceByPath(resources, targetUnit.pos, combatRallyPosition)
    ) {
      return combatRallyPosition;
    } else {
      if (!unit['expansions']) { unit['expansions'] = new Map(); }
      if (!targetUnit['expansions']) { targetUnit['expansions'] = new Map(); }
      const candidateExpansionsCentroid = map.getExpansions().filter(expansion => {
        const centroidString = expansion.centroid.x.toString() + expansion.centroid.y.toString();
        if (!(centroidString in targetUnit['expansions'])) {
          let [closestToExpansion] = getClosestUnitByPath(resources, expansion.centroid, targetUnit['selfUnits']);
          targetUnit['expansions'][centroidString] = {
            'closestToExpansion': closestToExpansion,
            'distanceByPath': distanceByPath(resources, closestToExpansion.pos, expansion.centroid),
          }
        }
        if (!(centroidString in unit['expansions'])) {
          unit['expansions'][centroidString] = {
            'distanceByPath': distanceByPath(resources, unit.pos, expansion.centroid),
          }
        }
        const distanceByPathToCentroid = unit['expansions'][centroidString].distanceByPath;
        return distanceByPathToCentroid !== 500 && distanceByPathToCentroid <= targetUnit['expansions'][centroidString].distanceByPath;
      }).map(expansion => expansion.centroid);
      const [largestPathDifferenceCentroid] = candidateExpansionsCentroid
        .sort((a, b) => (distanceByPath(resources, unit.pos, a) - distanceByPath(resources, targetUnit.pos, a)) - (distanceByPath(resources, unit.pos, b) - distanceByPath(resources, targetUnit.pos, b)))
        .filter(centroid => distanceByPath(resources, targetUnit.pos, centroid) > 16);
      const { movementSpeed } = unit.data();
      return largestPathDifferenceCentroid ? largestPathDifferenceCentroid : moveAwayPosition(targetUnit.pos, unit.pos, movementSpeed);
    }
  },
}

module.exports = resourceManagerService;