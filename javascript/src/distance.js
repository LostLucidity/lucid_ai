/**
 * Calculate the Euclidean distance between two points.
 * 
 * @param {SC2APIProtocol.Point | undefined} point1
 * @param {SC2APIProtocol.Point | undefined} point2
 * @returns {number | undefined} The distance, or undefined if either point or their properties are undefined.
 */
function getEuclideanDistance(point1, point2) {
  if (point1 && point2 && typeof point1.x === 'number' && typeof point1.y === 'number' && typeof point2.x === 'number' && typeof point2.y === 'number') {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return undefined;
}

module.exports = getEuclideanDistance;
