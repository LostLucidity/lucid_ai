//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
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
  }
}