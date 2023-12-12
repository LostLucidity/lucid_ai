//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");

module.exports = createSystem({
  name: 'WallOffRamp',
  type: 'agent',
  async onGameStart({ resources }) {
  // async onStep({ resources }) {
    const { map } = resources.get();
    // resources.get().debug.setDrawCells('rmps', map._ramps.map(r => ({ pos: r })), { size: 1, cube: true });
    const main = map.getMain(); if (main === undefined) return;
    const { areas } = main;
    const { pathFromMain } = map.getNatural();
    if (pathFromMain === undefined) return;
    const pathFromMainToNatural = getPathCoordinates(pathFromMain);
    adjacentToRampGrids = areas.placementGrid.filter(grid => {
      const adjacentGrids = getNeighbors(grid);
      const isAdjacent = adjacentGrids.some(adjacentGrid => map.isRamp(adjacentGrid));
      const isOnPath = pathFromMainToNatural.some(pathGrid => distance(pathGrid, grid) <= 4);
      return isAdjacent && isOnPath;
    });
    // resources.get().debug.setDrawCells('adToRamp', wallOffRampService.adjacentToRampGrids.map(r => ({ pos: r })), { size: 1, cube: true });
    setWallOffRampPlacements(map);
  },
});

