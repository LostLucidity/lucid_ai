//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
    range: (start, stop, step) => {
      if (typeof stop == 'undefined') {
          // one param defined
          stop = start;
          start = 0;
      }
    
      if (typeof step == 'undefined') {
          step = 1;
      }
    
      if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
          return [];
      }
    
      var result = [];
      for (var i = start; step > 0 ? i < stop : i > stop; i += step) {
          result.push(i);
      }
    
      return result;
    },
    /**
     * @param {Point2D[]} points
     * @param {Point2D[]} grids
     * @returns {Boolean}
     */
    allPointsWithinGrid: (points, grids) => points.every(point => grids.some(second => distance(point, second) < 1)),
    /**
     * https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
     * @param {any[]} array 
     * @returns {any[]}
     */
    shuffle: (array) => {
        let currentIndex = array.length, randomIndex;

        // While there remain elements to shuffle...
        while (currentIndex != 0) {

            // Pick a remaining element...
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;

            // And swap it with the current element.
            [array[currentIndex], array[randomIndex]] = [
                array[randomIndex], array[currentIndex]];
        }

        return array;
    }
}