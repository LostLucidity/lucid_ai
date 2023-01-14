//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { SIEGETANKSIEGED, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { readUnitTypeData } = require("../../filesystem");
const { getDistance } = require("../../services/position-service");
const { getWeaponThatCanAttack } = require("../../services/unit-service");
const unitResourceService = require("./unit-resource-service");

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
  },
  async onUnitDamaged(world, unit) {
    const { data, resources } = world;
    const { units } = resources.get();
    const { pos, radius } = unit; if (pos === undefined || radius === undefined) { return; }
    const enemy = units.getAlive({ alliance: Alliance.ENEMY }).filter(enemy => {
      const { pos: enemyPos, radius: enemyRadius, unitType } = enemy; if (enemyPos === undefined || enemyRadius === undefined || unitType === undefined) { return false; }
      const distance = getDistance(pos, enemyPos);
      const weapon = getWeaponThatCanAttack(data, unitType, unit); if (weapon === undefined) { return false; }
      const { range } = weapon; if (range === undefined) { return false; }
      return distance <= range + radius + enemyRadius;
    });
    enemy.forEach(enemy => {
      enemy.labels.set('hasAttacked', true);
    });
  }
});