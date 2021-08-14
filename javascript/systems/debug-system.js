//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Color } = require("@node-sc2/core/constants");
const { unbuildablePlateTypes } = require("@node-sc2/core/constants/groups");
const { frontOfGrid } = require("@node-sc2/core/utils/map/region");
const flat = require('array.prototype.flat');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D, getNeighbors, distance, avgPoints, closestPoint, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const bresenham = require('bresenham');
const enemyTrackingService = require("./enemy-tracking/enemy-tracking-service");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA } = require("@node-sc2/core/constants/unit-type");
const { getBuildingFootprintOfOrphanAddons } = require("../services/placement-service");
const debugDrawWalls = require('debug')('sc2:DrawDebugWalls');

module.exports = createSystem({
  name: 'Debug',
  type: 'agent',
  async onGameStart(world) {
    // debugMapHeights(world);

  },
  async onStep(world) {
    debugWalls(world);
    debugArmySupplies(world);
  }
});

function debugPlacements(world) {
  const { debug, units } = world.resources.get();
  debug.setDrawCells('enemyUnit.selfSupply', getBuildingFootprintOfOrphanAddons(units).map(position => ({ pos: position, text: `footprint` })), { size: 0.50, color: Color.RED, cube: true, persistText: true });
}

function debugArmySupplies(world) {
  const { debug, units } = world.resources.get();
  debug.setDrawCells('enemyUnit.selfSupply', enemyTrackingService.mappedEnemyUnits.filter(unit => !(unit.unitType === LARVA) && unit.selfSupply).map(enemyUnit => ({ pos: enemyUnit.pos, text: `(${enemyUnit.selfSupply})` })), { size: 0.50, color: Color.RED, cube: true, });
  debug.setDrawCells('selfUnit.selfSupply', units.getAlive(Alliance.SELF).filter(unit => !(unit.unitType === LARVA) && unit.selfSupply).map(selfUnit => ({ pos: selfUnit.pos, text: `(${selfUnit.selfSupply})` })), { size: 0.50, color: Color.GREEN, cube: true, });
}

function debugMapHeights(world) {
  const { debug, map } = world.resources.get();
  debug.setDrawCells('Height', map._grids.height.reduce((cells, row, y) => {
    row.forEach((node, x) => {
      cells.push({
        pos: { x, y },
        text: `${map.getHeight({ x, y })}`,
        color: Color.GREEN,
      });
    });
    return cells;
  }, []));
}

function debugVisibilityMap(world) {
  const { debug, map } = world.resources.get();
  // debug.setDrawCells('visiblityMap', map._mapState.visibility.map((visibilityPoint, index) => ({ pos: {x: visibilityPoint[index], y: index} })), { size: 1, color: Color.RED, cube: true, persistText: true });
  debug.setDrawCells('visiblityMap', map._mapState.visibility.reduce((cells, row, y) => {
    row.forEach((node, x) => {
      if (map.isVisible({ x, y })) {
        cells.push({
          pos: { x, y },
          text: `visible`,
          color: Color.GREEN,
        });
      } else {
        cells.push({
          pos: { x, y },
          text: `not visible`,
          color: Color.RED,
        });
      }
    });
    return cells;
  }, []));
}

function debugEnemyUnitPosition(world) {
  const { debug } = world.resources.get();
  // debug.setDrawCells('enemyUnit', enemyTrackingService.enemyUnits.map(enemyUnit => ({ pos: enemyUnit.pos, text: `(${enemyUnit.unitType})` })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });
  debug.setDrawCells('mappedEnemyUnit', enemyTrackingService.mappedEnemyUnits.map(enemyUnit => ({ pos: enemyUnit.pos, text: `(${enemyUnit.unitType})` })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });
}

function debugUnitTypes(world) {
  const { units, debug } = world.resources.get();
  const aliveUnits = units.getAlive();
  debug.setDrawCells('unitType', aliveUnits.map(alive => ({ pos: alive.pos, text: `(${alive.unitType})` })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });
}

function debugWalls(world) {
  const { map } = world.resources.get();
  if (!map.getNatural().getWall()) {
    calculateWall(world, map.getNatural());
  }
  if (!map.getEnemyNatural().getWall()) {
    calculateWall(world, map.getEnemyNatural());
  }
}

/** 
 * Natural wall only for now
 * @param {World} world
 */
function calculateWall(world, expansion) {
  const { map, units, debug } = world.resources.get();
  const { placement } = map.getGrids();

  const hull = expansion.areas.hull;
  const foeHull = frontOfGrid(world, hull);
  debug.setDrawCells('fonHull', foeHull.map(fh => ({ pos: fh, text: `(${fh.x},${fh.y})` })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });

  /**
   * @FIXME: this is duplicated logic and can prolly be consolidated
   */


  const plates = units.getByType(unbuildablePlateTypes);
  const cellsBlockedByUnbuildableUnit = flat(
    plates.map(plate => {
      const footprint = getFootprint(plate.unitType);
      return cellsInFootprint(createPoint2D(plate.pos), footprint);
    })
  );
  debug.setDrawCells('blockedCells', cellsBlockedByUnbuildableUnit.map(fh => ({ pos: fh })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });

  /**
   * 
   * @param {Boolean} [rampDesired]
   * @returns {Array<Point2D[]>}
   */
  function findAllPossibleWalls(rampDesired = true) {
    const rampTest = (/** @type {Point2D} */ point) => rampDesired ? map.isRamp(point) : !map.isRamp(point);
    /** @type {{ liveHull: any[]; deadHull: any[]; }} */
    const { deadHull, liveHull } = foeHull.reduce((/** @type {{ liveHull: Point2D[]; deadHull: any[]; }} */ decomp, /** @type {Point2D} */ point) => {
      const neighbors = getNeighbors(point, false);
      const diagNeighbors = getNeighbors(point, true, true);

      const deadNeighbors = neighbors.filter(point => !map.isPathable(point));
      const deadDiagNeighbors = diagNeighbors.filter(point => !map.isPathable(point));

      if ((deadNeighbors.length <= 0) && (deadDiagNeighbors.length <= 0)) {
        if (neighbors.some(rampTest)) {
          if (
            (!neighbors.some(point => cellsBlockedByUnbuildableUnit.some(cell => areEqual(cell, point))))
            && (!diagNeighbors.some(point => cellsBlockedByUnbuildableUnit.some(cell => areEqual(cell, point))))
          ) {
            decomp.liveHull.push(point);
          } else {
            // the ether...
          }
        } else {
          // the ether...
        }
      }

      decomp.deadHull = decomp.deadHull.concat(
        deadNeighbors.filter((neighborCell) => {
          const neighborsNeighbors = getNeighbors(neighborCell);
          return neighborsNeighbors.some(rampTest);
        })
      );

      return decomp;
    }, { deadHull: [], liveHull: [] });

    debug.setDrawCells(`liveHull-${Math.floor(expansion.townhallPosition.x)}`, liveHull.map(fh => ({ pos: fh })), { size: 0.75, color: Color.LIME_GREEN, cube: true });
    debug.setDrawCells(`deadHull-${Math.floor(expansion.townhallPosition.x)}`, deadHull.map(fh => ({ pos: fh })), { size: 0.75, color: Color.RED, cube: true });
    let liveHullDiameter = 0;
    liveHull.forEach((hull, index) => liveHull.forEach((inHull, inIndex) => {
      if (index === inIndex) { return }
      liveHullDiameter = distance(hull, inHull) > liveHullDiameter ? distance(hull, inHull) : liveHullDiameter;
    }));

    const deadHullClusters = deadHull.reduce((clusters, deadHullCell) => {
      if (clusters.length <= 0) {
        const newCluster = [deadHullCell];
        newCluster.centroid = deadHullCell;
        clusters.push(newCluster);
        return clusters;
      }

      const clusterIndex = clusters.findIndex(cluster => distance(cluster.centroid, deadHullCell) < liveHullDiameter);
      if (clusterIndex !== -1) {
        clusters[clusterIndex].push(deadHullCell);
        clusters[clusterIndex].centroid = avgPoints(clusters[clusterIndex]);
      } else {
        const newCluster = [deadHullCell];
        newCluster.centroid = deadHullCell;
        clusters.push(newCluster);
      }

      return clusters;
    }, []);

    // debug.setDrawTextWorld(`liveHullLength-${Math.floor(expansion.townhallPosition.x)}`, [{ pos: createPoint2D(avgPoints(liveHull)), text: `${liveHull.length}` }]);

    // deadHullClusters.forEach((cluster, i) => {
    //   debug.setDrawCells(`dhcluster-${Math.floor(expansion.townhallPosition.x)}-${i}`, cluster.map(fh => ({ pos: fh })), { size: 0.8, cube: true });
    // });

    return deadHullClusters.reduce((walls, cluster, i) => {
      const possibleWalls = flat(
        cluster.map(cell => {
          const notOwnClusters = deadHullClusters.filter((c, j) => j !== i);
          return notOwnClusters.map(jcluster => {
            const closestCell = closestPoint(cell, jcluster);
            const line = [];
            bresenham(cell.x, cell.y, closestCell.x, closestCell.y, (x, y) => line.push({ x, y }));
            return line;
          });
        })
      );

      return walls.concat(possibleWalls);
    }, [])
      .map(wall => {
        const first = wall[0];
        const last = wall[wall.length - 1];

        const newGraph = map.newGraph(placement.map(row => row.map(cell => cell === 0 ? 1 : 0)));

        newGraph.setWalkableAt(first.x, first.y, true);
        newGraph.setWalkableAt(last.x, last.y, true);
        return map.path(wall[0], wall[wall.length - 1], { graph: newGraph, diagonal: true })
          .map(([x, y]) => ({ x, y }));
      })
      .map(wall => {
        // debug.setDrawCells(`middleWallCalc-${Math.floor(expansion.townhallPosition.x)}`, wall.map(fh => ({ pos: fh })), { size: 1, color: Color.HOT_PINK, cube: false });
        return wall.filter(cell => map.isPlaceable(cell));
      })
      .sort((a, b) => a.length - b.length)
      .filter(wall => wall.length >= liveHullDiameter)
      .filter(wall => distance(avgPoints(wall), avgPoints(liveHull)) <= liveHullDiameter)
  }

  // try first assuming we have a nat ramp
  let allPossibleWalls = findAllPossibleWalls(true);

  if (!allPossibleWalls[0]) {
    // now try assuming there is no ramp
    allPossibleWalls = findAllPossibleWalls(false);
  }

  /**
   * @FIXME: we just sort of assume we always found a wall here... should be some contingency 
   */
  const [shortestWall] = allPossibleWalls;

  if (shortestWall) {
    if (debugDrawWalls.enabled) {
      debug.setDrawCells(
        `dhwall`,
        shortestWall.map(fh => ({ pos: fh })),
        { size: 0.9, color: Color.FUCHSIA, cube: true, persistText: true }
      );
    }

    expansion.areas.wall = shortestWall;
    expansion.areas.areaFill = expansion.areas.areaFill.filter(areaPoint => {
      return shortestWall.every(wallPoint => (
        distance(wallPoint, expansion.townhallPosition) > distance(areaPoint, expansion.townhallPosition)
      ));
    });
  }
}
