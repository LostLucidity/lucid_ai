//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { PYLON } = require("@node-sc2/core/constants/unit-type");

module.exports = {
  abilityOrder: (data, resources, abilityId, targetCount, unitTypes) => {
    const collectedActions = [];
    const { units } = resources.get();
    if (typeof targetCount !== 'undefined') {
      if (units.getById(unitTypes).length !== targetCount) {
        return collectedActions;
      } 
    }
    const canDo = data.findUnitTypesWithAbility(abilityId);
    let unitCanDo = units.getByType(canDo).find(u => u.abilityAvailable(abilityId));
    if (unitCanDo) {
      collectedActions.push({ abilityId, unitTags: [unitCanDo.tag] });
    }
    return collectedActions;
  },
  checkBuildingCount: (data, resources, targetCount, placementConfig) => {
    const {
      units,
    } = resources.get();
    const buildAbilityId = data.getUnitTypeData(placementConfig.toBuild).abilityId;
    let count = units.withCurrentOrders(buildAbilityId).length;
    placementConfig.countTypes.forEach(type => {
      count += units.getById(type).length;
    });
    return count === targetCount;
  },
  buildBuilding: async (agent, data, resources, placementConfig, candidatePositions) => {
    const {
      actions,
      units,
    } = resources.get();
    const collectedActions = [];
    // find placement on main
    if (agent.canAfford(placementConfig.toBuild)) {
      const foundPosition = await findPosition(actions, placementConfig.placement, candidatePositions);
      if (foundPosition) {
        const builders = [
          ...units.getMineralWorkers(),
          ...units.getWorkers().filter(w => w.noQueue),
          ...units.withLabel('builder').filter(w => !w.isConstructing()),
        ];
        const [ builder ] = units.getClosest(foundPosition, builders);
        if (builder) {
          const unitCommand = {
            abilityId: data.getUnitTypeData(placementConfig.toBuild).abilityId,
            unitTags: [builder.tag],
            targetWorldSpacePos: foundPosition,
          };
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  },
  findPlacements: (agent, resources) => {
    const { race } = agent;
    const { map, units } = resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
    let placements = [];
    if (race === Race.PROTOSS) {
      const pylonsNearProduction = units.getById(PYLON)
        .filter(u => u.buildProgress >= 1)
        .filter(pylon => distance(pylon.pos, main.townhallPosition) < 50);
      placements.filter((point) => {
        return (
          (distance(natural.townhallPosition, point) > 4.5) &&
          (pylonsNearProduction.some(p => distance(p.pos, point) < 6.5)) &&
          (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
          (natural.areas.hull.every(hp => distance(hp, point) > 2)) &&
          (units.getStructures({ alliance: Alliance.SELF })
            .map(u => u.pos)
            .every(eb => distance(eb, point) > 3))
        );
      });
    } else if (race === Race.ZERG) {
      placements = map.getCreep()
        .filter((point) => {
          return (
            (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
            (units.getStructures({ alliance: Alliance.SELF })
              .map(u => u.pos)
              .every(eb => distance(eb, point) > 3))
          );
        });
    }
    return placements;
  },
  upgradeOrder(data, resources, upgradeId) {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const { abilityId } = data.getUpgradeData(upgradeId);
    const upgrader = units.getUpgradeFacilities(upgradeId).find(u => u.noQueue && u.availableAbilities(abilityId));
    if (upgrader) {
      collectedActions.push({ abilityId, unitTags: [upgrader.tag] });
    }
    return collectedActions;
  }
}

async function findPosition(actions, unitType, candidatePositions) {
  const randomPositions = candidatePositions
    .map(pos => ({ pos, rand: Math.random() }))
    .sort((a, b) => a.rand - b.rand)
    .map(a => a.pos)
    .slice(0, 20);
  return await actions.canPlace(unitType, randomPositions);
}