//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { avgPoints, add } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require("@node-sc2/core/utils/get-random");
const resourceManagerService = require("../services/resource-manager-service");

const location = {
  /**
   * @param {MapResource} map 
   * @param {Point2D} position 
   * @returns {boolean}
   */
  existsInMap: (map, position) => {
    const mapSize = map.getSize();
    // return true if the position is within the map
    return (
      position.x >= 0 &&
      position.x < mapSize.x &&
      position.y >= 0 &&
      position.y < mapSize.y
    );
  },
  /**
   * @param {ResourceManager} resources 
   * @returns {Point2D}
   */
  getCombatRally: (resources) => {
    const { map, units } = resources.get();
    return resourceManagerService.combatRally ?
      resourceManagerService.combatRally :
      map.getNatural() ?
        map.getCombatRally() : location.getRallyPointByBases(map, units);
  },
  getRallyPointByBases: (map, units) => {
    const averageBasePosition = avgPoints(units.getBases().map(base => base.pos))
    let [ closestEnemyBase ] = units.getClosest(averageBasePosition, units.getBases(Alliance.ENEMY), 1);
    let enemyBaseLocation = closestEnemyBase ? closestEnemyBase.pos : map.getEnemyMain() ? map.getEnemyMain().townhallPosition : location.getRandomPoint(map);
    const rallyPointByBases = avgPoints([...units.getBases().map(base => base.pos), enemyBaseLocation]);
    return rallyPointByBases;
  },
  getRandomPoint: (map) => {
    return {
      x: Math.floor(Math.random() * Math.floor(map._mapSize.x)),
      y: Math.floor(Math.random() * Math.floor(map._mapSize.y)),
    };
  },
  /**
   * @param {MapResource} map 
   * @param {number} numberOfPoints 
   * @param {Point2D[]} area 
   * @returns {Point2D[]}
   */
  getRandomPoints: (map, numberOfPoints, area) => {
    const points = [];
    for (let point = 0; point < numberOfPoints; point++) {
      points.push(area ? getRandom(area) : location.getRandomPoint(map));
    }
    return points;
  },
  getAcrossTheMap: (map) => {
    const naturalToEnemyNaturalPath = map.path(add(map.getNatural().townhallPosition, 3), add(map.getEnemyNatural().townhallPosition, 3)).map(pathItem => ({ 'x': pathItem[0], 'y': pathItem[1] }));
    const pathIncrements = Math.round(naturalToEnemyNaturalPath.length / 6);
    const targetPosition = naturalToEnemyNaturalPath[naturalToEnemyNaturalPath.length - pathIncrements - 1];
    return targetPosition;
  },
  getOutInFront: (map) => {
    const naturalToEnemyNaturalPath = map.path(add(map.getNatural().townhallPosition, 3), add(map.getEnemyNatural().townhallPosition, 3)).map(pathItem => ({ 'x': pathItem[0], 'y': pathItem[1] }));
    const pathIncrements = Math.round(naturalToEnemyNaturalPath.length / 6);
    const targetPosition = naturalToEnemyNaturalPath[pathIncrements - 1];
    return targetPosition;
  }
}

module.exports = location;