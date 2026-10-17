const { UnitType } = require('@node-sc2/core/constants');
const { Race } = require('@node-sc2/core/constants/enums');

const { isProtossPositionValid, keepPosition } = require('../../src/core/buildingUtils');
const BuildingPlacement = require('../../src/features/construction/buildingPlacement');
const { isStructurePowered } = require('../../src/features/shared/protossUtils');
const StrategyContext = require('../../src/features/strategy/strategyContext');
const { findPosition, findUnitPlacements, getPlacementCandidateTelemetry, resetPlacementCandidateTelemetry } = require('../../src/utils/spatial/spatialUtils');

describe('Protoss building power coverage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetPlacementCandidateTelemetry();
  });

  test('requires the full Gateway footprint to be inside a Pylon power field', () => {
    const powerSources = [{ pos: { x: 0, y: 0 }, radius: 6.5 }];

    expect(isStructurePowered(UnitType.GATEWAY, { x: 6, y: 0 }, powerSources)).toBe(false);
    expect(isStructurePowered(UnitType.GATEWAY, { x: 5, y: 0 }, powerSources)).toBe(true);
  });

  test('skips an edge-powered Gateway candidate and selects a fully powered one', () => {
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);

    const pylon = { pos: { x: 0, y: 0 } };
    const map = {
      hasCreep: jest.fn(() => false),
      isPlaceable: jest.fn(() => true),
    };
    const units = {
      getById: jest.fn(unitType => unitType === UnitType.PYLON ? [pylon] : []),
    };
    const world = {
      agent: {
        powerSources: [{ pos: pylon.pos, radius: 6.5 }],
        race: Race.PROTOSS,
      },
      data: {
        getUnitTypeData: jest.fn(() => ({ race: Race.PROTOSS })),
      },
      resources: {
        get: jest.fn(() => ({ map, units })),
      },
    };

    const position = findPosition(world, UnitType.GATEWAY, [
      { x: 6, y: 0 },
      { x: 5, y: 0 },
    ]);

    expect(position).toEqual({ x: 5, y: 0 });
    expect(getPlacementCandidateTelemetry()).toEqual({
      GATEWAY: {
        attempts: 1,
        inputCandidates: 2,
        acceptedCandidates: 1,
        rejections: { insufficientPylonPower: 1 },
      },
    });
  });

  test('invalidates a cached Gateway position whose footprint crosses the power edge', () => {
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);

    const units = {
      getById: jest.fn(() => [{ pos: { x: 0, y: 0 } }]),
    };
    const world = {
      agent: { race: Race.PROTOSS },
      resources: {
        get: jest.fn(() => ({
          map: { isPlaceableAt: jest.fn(() => true) },
          units,
        })),
      },
    };

    const isGasPlacement = jest.fn(() => false);

    expect(keepPosition(world, UnitType.GATEWAY, { x: 6, y: 0 }, isGasPlacement)).toBe(false);
    expect(keepPosition(world, UnitType.GATEWAY, { x: 5, y: 0 }, isGasPlacement)).toBe(true);
  });

  test('keeps the final placement power view aligned when agent power sources are stale', () => {
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);

    const pylon = { pos: { x: 0, y: 0 } };
    const world = {
      agent: {
        powerSources: [],
        race: Race.PROTOSS,
      },
      resources: {
        get: jest.fn(() => ({
          map: { isPlaceableAt: jest.fn(() => true) },
          units: {
            getById: jest.fn(unitType => unitType === UnitType.PYLON ? [pylon] : []),
          },
        })),
      },
    };

    const position = { x: 5, y: 0 };

    expect(isProtossPositionValid(world, position, UnitType.GATEWAY)).toBe(true);
    expect(keepPosition(world, UnitType.GATEWAY, position, jest.fn(() => false))).toBe(true);
  });
});

describe('Protoss generated placement fallback', () => {
  const edge = { x: 38, y: 32 };
  const powered = { x: 37, y: 32 };
  let previousWallPositions;

  beforeEach(() => {
    previousWallPositions = BuildingPlacement.naturalThreeByThreePositions;
    BuildingPlacement.naturalThreeByThreePositions = [edge];
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);
    jest.spyOn(StrategyContext.getInstance(), 'getCurrentStrategy').mockReturnValue({ steps: [] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    BuildingPlacement.naturalThreeByThreePositions = previousWallPositions;
    jest.restoreAllMocks();
    resetPlacementCandidateTelemetry();
  });

  function createWorld() {
    const main = {
      townhallPosition: { x: 10, y: 10 },
      areas: { mineralLine: [], placementGrid: [] },
    };
    const natural = {
      townhallPosition: { x: 90, y: 90 },
      areas: { mineralLine: [], placementGrid: [], hull: [] },
    };
    const pylon = { pos: { x: 32, y: 32 }, buildProgress: 1 };
    const base = { pos: main.townhallPosition };
    const map = {
      getExpansions: () => [main, natural],
      getSize: () => ({ x: 128, y: 128 }),
      isPlaceable: jest.fn(() => true),
      isPlaceableAt: jest.fn(() => true),
    };
    const units = {
      getById: jest.fn(type => type === UnitType.PYLON ? [pylon] : []),
      getBases: () => [base],
      getClosest: () => [base],
      getStructures: () => [],
      getWorkers: () => [],
    };
    return {
      agent: { race: Race.PROTOSS, powerSources: [{ pos: pylon.pos, radius: 6.5 }] },
      data: { getUnitTypeData: () => ({ race: Race.PROTOSS }) },
      resources: { get: () => ({ map, units, frame: { getGameLoop: () => 4200 } }) },
    };
  }

  test.each([UnitType.GATEWAY, UnitType.TWILIGHTCOUNCIL])(
    'falls back when the only preferred wall position lacks full power (%s)', unitType => {
      const world = createWorld();
      expect(isStructurePowered(unitType, edge, world.agent.powerSources)).toBe(false);

      const candidates = findUnitPlacements(world, unitType);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates).not.toContainEqual(edge);
      expect(candidates.every(pos => isStructurePowered(unitType, pos, world.agent.powerSources))).toBe(true);
      expect(findPosition(world, unitType, candidates)).toBeTruthy();
    }
  );

  test('filters preferred positions before random selection and retains a powered wall position', () => {
    BuildingPlacement.naturalThreeByThreePositions = [edge, powered];
    expect(findUnitPlacements(createWorld(), UnitType.GATEWAY)).toEqual([powered]);
  });

  test('filters fallback power before the twenty-candidate limit', () => {
    const world = createWorld();
    const { map } = world.resources.get();
    BuildingPlacement.naturalThreeByThreePositions = [];
    map.getExpansions()[0].areas.placementGrid = [...Array(21).fill(edge), powered];
    // Isolate the expansion candidate pool from generated Pylon-circle grids.
    map.getSize = () => ({ x: 0, y: 0 });

    expect(findUnitPlacements(world, UnitType.GATEWAY)).toEqual([powered]);
  });

  test('returns no placement when neither preferred nor fallback positions have power', () => {
    const world = createWorld();
    world.agent.powerSources = [];
    world.resources.get().units.getById.mockReturnValue([]);

    expect(findUnitPlacements(world, UnitType.GATEWAY)).toEqual([]);
    expect(findPosition(world, UnitType.GATEWAY, [])).toBeFalsy();
  });

  test('does not bypass blocked footprints to find a fallback', () => {
    const world = createWorld();
    world.resources.get().map.isPlaceable.mockReturnValue(false);

    expect(findUnitPlacements(world, UnitType.GATEWAY)).toEqual([]);
  });
});
