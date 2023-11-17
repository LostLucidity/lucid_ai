//@ts-check
"use strict"

const getEuclideanDistance = require('./distance');

/**
 * Assigns workers to the closest mineral fields.
 * 
 * @param {Array} workers - Array of worker units.
 * @param {Array} mineralFields - Array of mineral field units.
 * @param {ActionManager} actions - SC2 actions object for commanding units.
 */
function assignWorkersToMinerals(workers, mineralFields, actions) {
  workers.forEach(async worker => {
    let closestMineralField = null;
    let minDistance = Number.MAX_VALUE;

    mineralFields.forEach(mineralField => {
      const distance = getEuclideanDistance(worker.pos, mineralField.pos);

      if (typeof distance === 'number' && distance < minDistance) {
        minDistance = distance;
        closestMineralField = mineralField;
      }
    });

    if (closestMineralField) {
      await actions.gather(worker, closestMineralField);
    }
  });
}

module.exports = {
  assignWorkersToMinerals,
};
