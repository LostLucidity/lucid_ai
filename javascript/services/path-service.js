//@ts-check
"use strict"

const pathService = {
  /**
   * @param {number[][]} path 
   * @returns {Point2D[]}
   */
  getPathCoordinates(path) {
    return path.map(path => ({ 'x': path[0], 'y': path[1] }));
  }
}

module.exports = pathService;