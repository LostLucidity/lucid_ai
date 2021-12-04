//@ts-check
"use strict"

const { moveAwayPosition } = require("../builds/helper");
const { distanceByPath, getClosestUnitByPath } = require("../helper/get-closest-by-path");
const { getCombatRally } = require("../helper/location");

const resourceManagerService = {
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