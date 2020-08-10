const debugDefenseSystem = require('debug')('sc2:debug:DefenseSystem');
const { createSystem } = require('@node-sc2/core');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { SupplyUnitRace } = require('@node-sc2/core/constants/race-map');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { getFootprint } = require('@node-sc2/core/utils/geometry/units');
const { distance, avgPoints } = require('@node-sc2/core/utils/geometry/point');
const getRandom = require('@node-sc2/core/utils/get-random');

const Color = require('@node-sc2/core/constants/color');
const { PYLON } = require('@node-sc2/core/constants/unit-type');

module.exports = createSystem({
  name: 'WallBuilder',
  setup({ resources }) {
    resources.set({
      placer: this,
    });
  },
  async onGameStart({ resources }) {
    const { map } = resources.get();
    const wall = map.getNatural().getWall();
    this.setState({
      wallL: wall,
      wallR: wall.slice().reverse(),
    });
  },
  place({ agent, resources }, building) {
    const {
      debug,
      map,
      units,
    } = resources.get();
    const myPylons = units.getById(SupplyUnitRace[agent.race]);
    if (myPylons.length === 0) {
      return findSupplyPositions(resources);
    }
    const remaining = this.state.wallL.filter(cell => map.isPlaceable(cell));
    if (remaining.length <= 1) return;
    if (remaining.every(c => map.hasCreep(c))) return;
    const first = remaining[0];
    const last = remaining[remaining.length - 1];
    const d = Math.round(distance(first, last));
    if (remaining.length === 4 && d === 3) {
      if (getFootprint(building).w !== 3) return;
    } else if (d <= 4) {
      if (getFootprint(building).w !== 2) return;
    }

    const indexL = this.state.wallL.findIndex(cell => map.isPlaceable(cell));
    const indexR = this.state.wallR.findIndex(cell => map.isPlaceable(cell));

    if (indexL === -1 && indexR === -1) return;

    let cell;

    if (indexL === -1) {
      cell = this.state.wallR[indexR];
    } else if (indexR === -1) {
      cell = this.state.wallL[indexL];
    } else if (indexL === indexR) {
      cell = getRandom([this.state.wallL[indexL], this.state.wallR[indexR]]);
    } else {
      cell = indexL < indexR ? this.state.wallL[indexL] : this.state.wallR[indexR];
    }

    const cellNeighbors = cellsInFootprint(cell, { w: 3, h: 3 });
    const possiblePlacements = cellNeighbors.filter(neighbor => map.isPlaceable(neighbor));

    debug.setDrawCells('placeableNeighbors', possiblePlacements.map(p => ({ pos: p, color: Color.WHITE, text: `(${p.x},${p.y})` })), { includeText: true });

    const placeables = possiblePlacements.filter(placement => map.isPlaceableAt(building, placement))
      .map((placeable) => {
        const cells = cellsInFootprint(placeable, getFootprint(building));
        placeable.coverage = remaining.filter(wallCell => cells.find(cell => wallCell.x === cell.x && wallCell.y === cell.y)).length;
        return placeable;
      }).sort((a, b) => b.coverage - a.coverage);

    return placeables.filter(placement => placement.coverage && remaining.length !== placement.coverage);
  },
  async onStep({ resources }) {
    // manage keeping a dude on hold position here
    const { units, map, frame, actions } = resources.get();
    if (units.getBases().filter(u => u.isFinished()).length <= 1) {
      const [buildy] = units.withLabel('builder');
      const natPlacements = avgPoints(map.getNatural().getWall());
      if (!buildy && frame.timeInSeconds() > 5) {
        const builder = getRandom(units.getMineralWorkers());
        if (!builder) return;
        builder.labels.set('builder', { idle: natPlacements });
      } else if (buildy) {
        if (distance(buildy.pos, natPlacements) > 6) {
          if (buildy.noQueue || !buildy.isConstructing()) {
            await actions.move(buildy, buildy.labels.get('builder').idle);
          }
        }
      }
    }
  },
  async onUnitCreated({ resources }, unit) {
    const { units, map } = resources.get();
    if (unit.is(PYLON) && distance(avgPoints(map.getNatural().getWall()), unit.pos) < 6.5) {
      const [buildy] = units.withLabel('builder');
      buildy.addLabel('builder', { idle: unit.pos });
    }
  },
});

function findSupplyPositions(resources) {
  const { map } = resources.get();
  const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
  // front of natural pylon for great justice
  const naturalWall = map.getNatural().getWall();
  let possiblePlacements = frontOfGrid({ resources }, map.getNatural().areas.areaFill)
      .filter(point => naturalWall.every(wallCell => (
          (distance(wallCell, point) <= 6.5) &&
          (distance(wallCell, point) >= 3)
      )));

  if (possiblePlacements.length <= 0) {
      possiblePlacements = frontOfGrid({ resources }, map.getNatural().areas.areaFill)
          .map(point => {
              point.coverage = naturalWall.filter(wallCell => (
                  (distance(wallCell, point) <= 6.5) &&
                  (distance(wallCell, point) >= 1)
              )).length;
              return point;
          })
          .sort((a, b) => b.coverage - a.coverage)
          .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
  }

  return possiblePlacements;
}