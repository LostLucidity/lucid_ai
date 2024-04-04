/**
 * @param {number} frames 
 * @returns {number}
 */
function getTimeInSeconds(frames) {
  return frames / 22.4;
}

/**
 * Checks if a line between two points is traversable on the map.
 * @param {MapResource} map - The map object.
 * @param {Point2D} start - The start point of the line.
 * @param {Point2D} end - The end point of the line.
 * @returns {boolean} - True if the line is traversable, false otherwise.
 */
function isLineTraversable(map, start, end) {
  // Ensure both points have defined x and y values
  if (typeof start.x !== 'number' || typeof start.y !== 'number' ||
    typeof end.x !== 'number' || typeof end.y !== 'number') {
    throw new Error("Start or end points are not properly defined.");
  }

  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;

  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);

  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;

  let err = dx + dy;

  // Use the coordinates comparison as the loop condition
  while (!(x0 === x1 && y0 === y1)) {
    if (!map.isPathable({ x: x0, y: y0 })) {
      return false;
    }

    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }

  return true;
}

module.exports = { getTimeInSeconds, isLineTraversable };
