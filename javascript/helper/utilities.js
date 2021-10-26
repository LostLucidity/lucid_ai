//@ts-check
"use strict"

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
    // https://stackoverflow.com/questions/33356504/difference-and-intersection-of-two-arrays-containing-objects
    /**
     * 
     * @param {Point2D[]} firstArray 
     * @param {Point2D[]} secondArray 
     * @returns {Point2D[]}
     */
    intersectionOfPoints: (firstArray, secondArray) => firstArray.filter(first => secondArray.some(second => first.x === second.x && first.y === second.y ))
}