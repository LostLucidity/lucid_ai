//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { PYLON, NEXUS, ASSIMILATOR } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require("@node-sc2/core/utils/get-random");
const { workerSendOrBuild } = require("../helper");
const { getOccupiedExpansions } = require("./expansions");
const { getCombatRally } = require("./location");
const { findPosition } = require("./placement-helper");

module.exports = {
  findWarpInLocations: (resources) => {
    const { units } = resources.get();
    const pylonsNearProduction = units.getById(PYLON)
      .filter(pylon => pylon.buildProgress >= 1)
      .filter(pylon => {
        const [ closestBase ] = getOccupiedExpansions(resources).map(expansion => expansion.getBase())
        if (closestBase) {
          return distance(pylon.pos, closestBase.pos) < 6.89
        }
      })
      .filter(pylon => {
        const [closestUnitOutOfRange] = units.getClosest(pylon.pos, units.getCombatUnits(Alliance.ENEMY));
        if (closestUnitOutOfRange) {
          return distance(pylon.pos, closestUnitOutOfRange.pos) > 16
        }
      });
    let closestPylon;
    if (pylonsNearProduction.length > 0) {
      [closestPylon] = units.getClosest(getCombatRally(resources), pylonsNearProduction);
      return closestPylon.pos;
    } else {
      const pylons = units.getById(PYLON)
        .filter(pylon => pylon.buildProgress >= 1)
        .filter(pylon => {
          const [closestUnitOutOfRange] = units.getClosest(pylon.pos, units.getCombatUnits(Alliance.ENEMY));
          if (closestUnitOutOfRange) {
            return distance(pylon.pos, closestUnitOutOfRange.pos) > 16
          }
        });
        if (pylons) {
          [closestPylon] = units.getClosest(getCombatRally(resources), pylons);
          return closestPylon.pos;
        }
    }
  },
  restorePower: async ({ data, resources }) => {
    const { actions, units } = resources.get();
    const collectedActions = [];
    const selfPowered = [ NEXUS, PYLON, ASSIMILATOR ];
    const unpoweredStructure = getRandom(units.getStructures().filter(structure => !structure.isPowered && !selfPowered.includes(structure.unitType) && structure.buildProgress >= 1));
    if (unpoweredStructure) {
      const candidatePositions = gridsInCircle(unpoweredStructure.pos, 6.5 - unpoweredStructure.radius);
      const foundPosition = await findPosition(actions, unpoweredStructure.unitType, candidatePositions);
      if (foundPosition) {
        collectedActions.push(...workerSendOrBuild(resources, data.getUnitTypeData(PYLON).abilityId, foundPosition));
      }
    }
    return collectedActions;
  },
  warpIn: async (resources, assemblePlan, unitType) => {
    const { actions } = resources.get();
    let nearPosition;
    if (assemblePlan.state.defenseMode && assemblePlan.outSupplied) {
      nearPosition = module.exports.findWarpInLocations(resources);
    } else {
      nearPosition = getCombatRally(resources);
    }
    try { await actions.warpIn(unitType, { nearPosition: nearPosition }) } catch (error) { console.log(error); }
  }
}