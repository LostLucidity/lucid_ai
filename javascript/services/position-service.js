//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance, createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const positionService = {
  /**
   * @param {Point2D[]} points
   * @param {number} eps
   * @param {number} minPts
   * @returns {Point2D[]}
   */
  dbscan(points, eps = 1.5, minPts = 1) {
  let clusters = [];
  let visited = new Set();
  let noise = new Set();

  function rangeQuery(p) {
    return points.filter((point) => {
      const distance = positionService.getDistance(p, point); // Assume getDistance is defined
      return distance <= eps;
    });
  }

  points.forEach((point) => {
    if (!visited.has(point)) {
      visited.add(point);

      let neighbors = rangeQuery(point);

      if (neighbors.length < minPts) {
        noise.add(point);
      } else {
        let cluster = new Set([point]);

        for (let point2 of neighbors) {
          if (!visited.has(point2)) {
            visited.add(point2);

            let neighbors2 = rangeQuery(point2);

            if (neighbors2.length >= minPts) {
              neighbors = neighbors.concat(neighbors2);
            }
          }

          if (!Array.from(cluster).includes(point2)) {
            cluster.add(point2);
          }
        }

        clusters.push(cluster);
      }
    }
  });

  // Return center of each cluster
    return clusters.map((cluster) => {
      let x = 0;
      let y = 0;
      for (let point of cluster) {
        x += point.x;
        y += point.y;
      }

      return {
        x: x / cluster.size,
        y: y / cluster.size
      };
    });
  },
  /**
   * @param {{point: Point2D, unit: Unit}[]} pointsWithUnits
   * @param {number} eps
   * @param {number} minPts
   * @returns {{center: Point2D, units: Unit[]}[]}
   */
  dbscanWithUnits(pointsWithUnits, eps = 1.5, minPts = 1) {
    let clusters = [];
    let visited = new Set();
    let noise = new Set();

    function rangeQuery(p) {
      return pointsWithUnits.filter(({ point }) => {
        const distance = positionService.getDistance(p, point); // Assume getDistance is defined
        return distance <= eps;
      });
    }

    pointsWithUnits.forEach(({ point }) => {
      if (!visited.has(point)) {
        visited.add(point);

        let neighbors = rangeQuery(point);

        if (neighbors.length < minPts) {
          noise.add(point);
        } else {
          let cluster = new Set([point]);

          for (let { point: point2 } of neighbors) {
            if (!visited.has(point2)) {
              visited.add(point2);

              let neighbors2 = rangeQuery(point2);

              if (neighbors2.length >= minPts) {
                neighbors = neighbors.concat(neighbors2);
              }
            }

            if (!Array.from(cluster).includes(point2)) {
              cluster.add(point2);
            }
          }

          const clusterUnits = pointsWithUnits.filter(pt => cluster.has(pt.point)).map(pt => pt.unit);
          const center = {
            x: Array.from(cluster).reduce((a, b) => a + b.x, 0) / cluster.size,
            y: Array.from(cluster).reduce((a, b) => a + b.y, 0) / cluster.size
          };

          clusters.push({ center, units: clusterUnits });
        }
      }
    });

    return clusters;
  },
  /**
   * @param {Point2D} pos
   * @param {Number} radius
   * @returns {Point2D[]}
   */
  getBorderPositions(pos, radius) {
    const positions = [];
    for (let i = 0; i < 360; i += 10) {
      const { x, y } = pos; if (x === undefined || y === undefined) { return []; }
      const angle = i * Math.PI / 180;
      const x1 = x + radius * Math.cos(angle);
      const y1 = y + radius * Math.sin(angle);
      positions.push({ x: x1, y: y1 });
    }
      return positions;
  },
  /**
   * @param {Point2D[]} points
   * @param {number} eps
   * @param {number} minPts
   * @returns {Point2D[]}
   */
  getClusters(points, eps = 1.5, minPts = 1) {
    return positionService.dbscan(points, eps, minPts);
  },
  /**
   * @param {Point2D} posA
   * @param {Point2D} posB
   * @returns {number}
   */
  getDistance(posA, posB) {
    return distance(posA, posB);
  },
  /**
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @returns {Point2D}
   */
  getMiddleOfStructure(position, unitType ) {
    if (gasMineTypes.includes(unitType)) return position;
    let { x, y } = position;
    if (x === undefined || y === undefined) return position;
    const footprint = getFootprint(unitType);
    if (footprint === undefined) return position;
    if (footprint.h % 2 === 1) {
      x += 0.5;
      y += 0.5;
    }
    return { x, y };
  },
  /**
   * @param {Point2D} position
   * @param {Unit[]} structures
   * @returns {Point2D[]}
   */
  getStructureCells(position, structures) {
    return structures.reduce((/** @type {Point2D[]} */ acc, structure) => {
      const { pos, unitType } = structure;
      if (pos === undefined || unitType === undefined) return acc;
      if (positionService.getDistance(pos, position) <= 1) {
        const footprint = getFootprint(unitType);
        if (footprint === undefined) return acc;
        acc.push(...cellsInFootprint(createPoint2D(pos), footprint));
      }
      return acc;
    }, []);
  },
  /**
   * return position directly away from targetPosition based on position
   * @param {Point2D} targetPosition 
   * @param {Point2D} position 
   * @param {number} distance 
   * @returns {Point2D}
 */
  moveAwayPosition(targetPosition, position, distance = 2) {
    const angle = toDegrees(Math.atan2(targetPosition.y - position.y, targetPosition.x - position.x));
    const oppositeAngle = angle + 180 % 360;
    const awayPoint = {
      x: Math.cos(oppositeAngle * Math.PI / 180) * distance + position.x,
      y: Math.sin(oppositeAngle * Math.PI / 180) * distance + position.y
    }
    return awayPoint;
  },
}

module.exports = positionService;