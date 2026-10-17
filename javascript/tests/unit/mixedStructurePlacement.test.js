const { UnitType } = require('@node-sc2/core/constants');
const { Race } = require('@node-sc2/core/constants/enums');

const buildOrder = require('../../data/buildOrders/protoss/2_bases_chargelot_sentry_and_immortal');
const { buildingPositions } = require('../../src/state');
const { determineBuildingPosition } = require('../../src/core/buildingUtils');
const BuildingPlacement = require('../../src/features/construction/buildingPlacement');
const StrategyContext = require('../../src/features/strategy/strategyContext');
const { findUnitPlacements } = require('../../src/utils/spatial/spatialUtils');

describe('placement ownership in a mixed build-order step', () => {
  const pylonPosition = { x: 35, y: 35 };
  let previousPositions;
  let previousStrategy;
  let previousStep;
  let previousWallPositions;

  beforeEach(() => {
    const context = StrategyContext.getInstance();
    previousPositions = new Map(buildingPositions);
    previousStrategy = context.getCurrentStrategy();
    previousStep = context.getCurrentStep();
    previousWallPositions = BuildingPlacement.naturalThreeByThreePositions;
    buildingPositions.clear();
    context.setCurrentStrategy(buildOrder);
    context.setCurrentStep(27);
    BuildingPlacement.naturalThreeByThreePositions = [];
  });

  afterEach(() => {
    const context = StrategyContext.getInstance();
    buildingPositions.clear();
    previousPositions.forEach((position, step) => buildingPositions.set(step, position));
    context.setCurrentStrategy(previousStrategy);
    context.setCurrentStep(previousStep);
    BuildingPlacement.naturalThreeByThreePositions = previousWallPositions;
  });

  test('keeps the Pylon position for Immortal, Pylon', () => {
    BuildingPlacement.setBuildingPosition(UnitType.PYLON, pylonPosition);

    expect(BuildingPlacement.buildingPosition).toEqual(pylonPosition);
    expect(BuildingPlacement.getCurrentStepUnitTypeAndPosition()).toEqual({
      unitType: UnitType.PYLON,
      position: pylonPosition,
    });
  });

  test('reuses the mixed-step Pylon position on the next placement request', () => {
    const world = {
      agent: { race: Race.PROTOSS },
      resources: { get: () => ({ map: { isPlaceableAt: () => true } }) },
    };
    const findPlacements = jest.fn(() => [pylonPosition]);
    const choosePosition = jest.fn((gameWorld, unitType, candidates) => candidates[0]);
    const assignPosition = (unitType, position) => BuildingPlacement.setBuildingPosition(unitType, position);

    const first = determineBuildingPosition(
      world, UnitType.PYLON, [], undefined, findPlacements, choosePosition, assignPosition
    );
    const second = determineBuildingPosition(
      world, UnitType.PYLON, [], BuildingPlacement.buildingPosition,
      findPlacements, choosePosition, assignPosition
    );

    expect(first).toEqual(pylonPosition);
    expect(second).toEqual(pylonPosition);
    expect(findPlacements).toHaveBeenCalledTimes(1);
    expect(choosePosition).toHaveBeenCalledTimes(1);
  });

  test('includes the mixed-step Pylon in planned power', () => {
    buildingPositions.set(27, pylonPosition);

    expect(BuildingPlacement.getPlannedPylonPositions()).toContainEqual(pylonPosition);
  });

  test('identifies the sole structure in a raw mixed action', () => {
    expect(BuildingPlacement.getPlacementUnitTypeForStep({ action: 'Immortal, Pylon' }))
      .toBe(UnitType.PYLON);
    expect(BuildingPlacement.getPlacementUnitTypeForStep({ action: 'Gateway, Pylon' }))
      .toBeNull();
  });

  test('reserves the mixed-step Pylon footprint even when earlier steps have cached positions', () => {
    for (let step = 0; step < 10; step++) {
      buildingPositions.set(step, { x: 110, y: 110 });
    }
    BuildingPlacement.naturalThreeByThreePositions = [pylonPosition];

    const main = { townhallPosition: { x: 10, y: 10 }, areas: { mineralLine: [], placementGrid: [] } };
    const natural = { townhallPosition: { x: 90, y: 90 }, areas: { mineralLine: [], placementGrid: [], hull: [] } };
    const base = { pos: main.townhallPosition };
    const world = {
      agent: {
        race: Race.PROTOSS,
        powerSources: [{ pos: pylonPosition, radius: 6.5 }],
      },
      data: { getUnitTypeData: () => ({ race: Race.PROTOSS }) },
      resources: {
        get: () => ({
          frame: { getGameLoop: () => 4200 },
          map: {
            getExpansions: () => [main, natural],
            getSize: () => ({ x: 128, y: 128 }),
            isPlaceable: () => true,
            isPlaceableAt: () => true,
          },
          units: {
            getById: () => [],
            getBases: () => [base],
            getClosest: () => [base],
            getStructures: () => [],
            getWorkers: () => [],
          },
        }),
      },
    };

    expect(findUnitPlacements(world, UnitType.GATEWAY)).toContainEqual(pylonPosition);
    buildingPositions.set(27, pylonPosition);
    expect(findUnitPlacements(world, UnitType.GATEWAY)).not.toContainEqual(pylonPosition);
  });

  test('preserves a plain Pylon step', () => {
    StrategyContext.getInstance().setCurrentStep(13);
    BuildingPlacement.setBuildingPosition(UnitType.PYLON, pylonPosition);

    expect(BuildingPlacement.buildingPosition).toEqual(pylonPosition);
    expect(BuildingPlacement.getPlannedPylonPositions()).toContainEqual(pylonPosition);
  });
});
