//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { avgPoints, add } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
  getCombatRally: (resources) => {
    const { map, units } = resources.get();
    return map.getNatural() ? map.getCombatRally() : module.exports.getRallyPointByBases(map, units);
  },
  getRallyPointByBases: (map, units) => {
    const averageBasePosition = avgPoints(units.getBases().map(base => base.pos))
    let [ closestEnemyBase ] = units.getClosest(averageBasePosition, units.getBases(Alliance.ENEMY), 1);
    let enemyBaseLocation = closestEnemyBase ? closestEnemyBase.pos : map.getEnemyMain() ? map.getEnemyMain().townhallPosition : module.exports.getRandomPoint(map);
    const rallyPointByBases = avgPoints([...units.getBases().map(base => base.pos), enemyBaseLocation]);
    return rallyPointByBases;
  },
  getRandomPoint: (map) => {
    return {
      x: Math.floor(Math.random() * Math.floor(map._mapSize.x)),
      y: Math.floor(Math.random() * Math.floor(map._mapSize.y)),
    };
  },
  acrossTheMap: (map) => {
    const naturalToEnemyNaturalPath = map.path(add(map.getNatural().townhallPosition, 3), add(map.getEnemyNatural().townhallPosition, 3)).map(pathItem => ({ 'x': pathItem[0], 'y': pathItem[1] }));
    const pathIncrements = Math.round(naturalToEnemyNaturalPath.length / 6);
    const targetPosition = naturalToEnemyNaturalPath[naturalToEnemyNaturalPath.length - pathIncrements - 1];
    return targetPosition;
  },
  outInFront: (map) => {
    const naturalToEnemyNaturalPath = map.path(add(map.getNatural().townhallPosition, 3), add(map.getEnemyNatural().townhallPosition, 3)).map(pathItem => ({ 'x': pathItem[0], 'y': pathItem[1] }));
    const pathIncrements = Math.round(naturalToEnemyNaturalPath.length / 6);
    const targetPosition = naturalToEnemyNaturalPath[pathIncrements - 1];
    return targetPosition;
  }
}