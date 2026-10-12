const { UnitType } = require('@node-sc2/core/constants');
const { Race } = require('@node-sc2/core/constants/enums');

const { keepPosition } = require('../../src/core/buildingUtils');
const BuildingPlacement = require('../../src/features/construction/buildingPlacement');
const { isStructurePowered } = require('../../src/features/shared/protossUtils');
const { findPosition } = require('../../src/utils/spatial/spatialUtils');

describe('Protoss building power coverage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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
});
