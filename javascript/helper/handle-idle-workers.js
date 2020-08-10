//@ts-check
"use strict"

function handleIdleWorkers(resources, idleUnit, ignorelabels=[]) {
  if (idleUnit.isWorker() && ignorelabels.some(label => !idleUnit.labels.get(label))) {
    const { actions, units } = resources.get();
    if (units.getBases().length > 0) {
      return actions.gather(idleUnit);
    }
  }
}

module.exports = handleIdleWorkers;