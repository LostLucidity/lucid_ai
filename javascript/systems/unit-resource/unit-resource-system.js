//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { SIEGETANKSIEGED, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { readUnitTypeData } = require("../../filesystem");
const { supplyDepotBehavior } = require("../../helper/behavior/unit-behavior");
const { getDistance } = require("../../services/position-service");
const unitResourceService = require("./unit-resource-service");
const { landingAbilities } = require("@node-sc2/core/constants/groups");
const { flyingTypesMapping } = require("../../helper/groups");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const unitService = require("../../services/unit-service");

module.exports = createSystem({
  name: 'UnitResourceSystem',
  type: 'agent',
  async onGameStart() {
    unitResourceService.unitTypeData = readUnitTypeData();
    console.log(unitResourceService.unitTypeData);
  },
  async onStep(world) {
    const { resources } = world;
    const { map, units } = resources.get();
    unitResourceService.seigeTanksSiegedGrids = [];
    units.getByType(SIEGETANKSIEGED).forEach(unit => {
      unitResourceService.seigeTanksSiegedGrids.push(...gridsInCircle(unit.pos, unit.radius, { normalize: true }))
    });
    const supplyDepots = units.getByType([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]);
    supplyDepots.forEach(supplyDepot => {
      const cells = cellsInFootprint(supplyDepot.pos, getFootprint(supplyDepot.unitType));
      cells.forEach(cell => {
        if (supplyDepot.unitType === SUPPLYDEPOT) {
          map.setPathable(cell, false);
        } else {
          map.setPathable(cell, true);
        }
      });
    });
    unitResourceService.landingGrids = getLandingGrids(units);
    maintainPlaceableGridsForFlyingStructures(resources);
  },
  async onUnitDamaged(world, unit) {
    const { data, resources } = world;
    const { units } = resources.get();
    const { pos, radius } = unit; if (pos === undefined || radius === undefined) { return; }
    const enemy = units.getAlive({ alliance: Alliance.ENEMY }).filter(enemy => {
      const { pos: enemyPos, radius: enemyRadius, unitType } = enemy; if (enemyPos === undefined || enemyRadius === undefined || unitType === undefined) { return false; }
      const distance = getDistance(pos, enemyPos);
      const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit); if (weapon === undefined) { return false; }
      const { range } = weapon; if (range === undefined) { return false; }
      return distance <= range + radius + enemyRadius;
    });
    enemy.forEach(enemy => {
      enemy.labels.set('hasAttacked', true);
    });
  },
  async onUnitFinished(world, unit) {
    const { resources } = world;
    const { unitType } = unit; if (unitType === undefined) return;
    if (unitType === SUPPLYDEPOT) {
      supplyDepotBehavior(resources);
    }
  }
});

/**
 * @param {UnitResource} units
 * @returns {Point2D[]}
 */
function getLandingGrids(units) {
  return units.getStructures().reduce((/** @type {Point2D[]} */gridList, structure) => {
    const { orders, pos, radius, unitType } = structure; if (orders === undefined || pos === undefined || radius === undefined || unitType === undefined) return gridList;
    const landingOrder = orders.find(order => order.abilityId && landingAbilities.includes(order.abilityId)); if (landingOrder === undefined) return gridList;
    const { targetWorldSpacePos } = landingOrder; if (targetWorldSpacePos === undefined) return gridList;
    const footprint = getFootprint(flyingTypesMapping.get(unitType)); if (footprint === undefined) return gridList;
    const cells = cellsInFootprint(createPoint2D(targetWorldSpacePos), footprint);
    gridList.push(...cells);
    return gridList;
  }, []);
}

/**
 * @param {ResourceManager} resources
 * @returns {void}
 */
function maintainPlaceableGridsForFlyingStructures(resources) {
  const { map, units } = resources.get();
  units.getStructures().forEach(structure => {
    const { tag, pos, unitType } = structure; if (tag === undefined || pos === undefined || unitType === undefined) { return; }
    const { flyingStructures } = unitResourceService;
    const isExisting = flyingStructures.has(tag);
    if (!isExisting && flyingTypesMapping.get(unitType)) {
      unitResourceService.flyingStructures.set(tag, unitType);
      const footprint = getFootprint(flyingTypesMapping.get(unitType)); if (footprint === undefined) return;
      cellsInFootprint(pos, footprint).forEach(cell => map.setPlaceable(cell, true));
    }
    if (isExisting) {
      const landedStructure = flyingStructures.get(tag) !== unitType; if (!landedStructure) return;
      flyingStructures.delete(tag);
      const footprint = getFootprint(unitType); if (footprint === undefined) return;
      cellsInFootprint(pos, footprint).forEach(cell => map.setPlaceable(cell, false));
    }
  });
}

