const { UnitType } = require('@node-sc2/core/constants');
const { Race } = require('@node-sc2/core/constants/enums');

const buildOrder = require('../../data/buildOrders/protoss/2_bases_chargelot_sentry_and_immortal');

jest.mock('../../src/core/builderUtils', () => ({
  handleCannotAffordBuilding: jest.fn(),
  getBuilder: jest.fn(),
  prepareBuilderForConstruction: jest.fn(() => ({ tag: 1 })),
  handleSpecialUnits: jest.fn(),
}));

const BuildingPlacement = require('../../src/features/construction/buildingPlacement');
const StrategyContext = require('../../src/features/strategy/strategyContext');
const { buildingPositions } = require('../../src/state');
const {
  commandPlaceBuilding,
  getPowerPlacementDeferrals,
  getPowerPlacementDeferralsByStep,
  isProtossPositionValid,
  resetPowerPlacementDeferrals,
} = require('../../src/core/buildingUtils');

describe('Protoss build dispatch power', () => {
  const position = { x: 5, y: 0 };
  const pylonPosition = { x: 0, y: 0 };

  afterEach(() => {
    jest.restoreAllMocks();
    resetPowerPlacementDeferrals();
    StrategyContext.getInstance().setCurrentStep(-1);
  });

  function createWorld(pylons = [], powerSources = []) {
    return {
      agent: {
        race: Race.PROTOSS,
        powerSources,
        canAfford: () => true,
        hasTechFor: () => true,
      },
      data: {
        getUnitTypeData: () => ({ race: Race.PROTOSS, abilityId: 987654 }),
        findUnitTypesWithAbility: () => [],
      },
      resources: {
        get: () => ({
          map: { isPlaceableAt: () => true },
          units: { getById: type => type === UnitType.PYLON ? pylons : [] },
        }),
      },
    };
  }

  function dispatch(world, unitType = UnitType.GATEWAY) {
    const commandBuilder = jest.fn(() => [{ kind: 'build' }]);
    const premoveBuilder = jest.fn(() => [{ kind: 'move' }]);
    const actions = commandPlaceBuilding(
      world, unitType, position, commandBuilder, jest.fn(), premoveBuilder,
      jest.fn(() => false), jest.fn()
    );
    return { actions, commandBuilder, premoveBuilder };
  }

  test.each([UnitType.GATEWAY, UnitType.TWILIGHTCOUNCIL])(
    'defers a build supported only by a planned Pylon (%s)', unitType => {
      jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([pylonPosition]);

      const result = dispatch(createWorld(), unitType);

      expect(result.commandBuilder).not.toHaveBeenCalled();
      expect(result.premoveBuilder).toHaveBeenCalledTimes(1);
      expect(result.actions).toEqual([{ kind: 'move' }]);
      expect(getPowerPlacementDeferrals()).toEqual({
        [unitType === UnitType.GATEWAY ? 'GATEWAY' : 'TWILIGHTCOUNCIL']: 1,
      });
    }
  );

  test('defers a build supported only by an unfinished observed Pylon', () => {
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);
    const result = dispatch(createWorld([{ pos: pylonPosition, buildProgress: 0.5 }]));

    expect(result.commandBuilder).not.toHaveBeenCalled();
    expect(result.actions).toEqual([{ kind: 'move' }]);
  });

  test('attributes a deferred Gateway to the active build-order step', () => {
    StrategyContext.getInstance().setCurrentStep(20);
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([pylonPosition]);

    dispatch(createWorld());

    expect(getPowerPlacementDeferrals()).toEqual({ GATEWAY: 1 });
    expect(getPowerPlacementDeferralsByStep()).toEqual({
      20: { GATEWAY: 1 },
    });
  });

  test('reproduces step 15 waiting for step 13 Pylon power', () => {
    const context = StrategyContext.getInstance();
    const previousStrategy = context.getCurrentStrategy();
    const previousStep = context.getCurrentStep();
    const previousPositions = new Map(buildingPositions);

    try {
      buildingPositions.clear();
      buildingPositions.set(13, pylonPosition);
      context.setCurrentStrategy(buildOrder);
      context.setCurrentStep(15);
      const unfinishedPylon = { pos: pylonPosition, buildProgress: 0.5 };
      const world = createWorld([unfinishedPylon]);

      expect(buildOrder.steps[13].action).toBe('Pylon');
      expect(buildOrder.steps[15].action).toBe('Twilight Council');
      expect(isProtossPositionValid(world, position, UnitType.TWILIGHTCOUNCIL)).toBe(true);

      const deferred = dispatch(world, UnitType.TWILIGHTCOUNCIL);
      expect(deferred.commandBuilder).not.toHaveBeenCalled();
      expect(deferred.premoveBuilder).toHaveBeenCalledTimes(1);
      expect(getPowerPlacementDeferralsByStep()).toEqual({
        15: { TWILIGHTCOUNCIL: 1 },
      });

      unfinishedPylon.buildProgress = 1;
      const dispatched = dispatch(world, UnitType.TWILIGHTCOUNCIL);
      expect(dispatched.commandBuilder).toHaveBeenCalledTimes(1);
      expect(dispatched.actions).toEqual([{ kind: 'build' }]);
    } finally {
      buildingPositions.clear();
      previousPositions.forEach((storedPosition, step) => buildingPositions.set(step, storedPosition));
      context.setCurrentStrategy(previousStrategy);
      context.setCurrentStep(previousStep);
    }
  });

  test('builds with a completed observed Pylon when agent sources lag', () => {
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);
    const result = dispatch(createWorld([{ pos: pylonPosition, buildProgress: 1 }]));

    expect(result.commandBuilder).toHaveBeenCalledTimes(1);
    expect(result.actions).toEqual([{ kind: 'build' }]);
    expect(getPowerPlacementDeferrals()).toEqual({});
  });

  test('builds with an active agent power source', () => {
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);
    const result = dispatch(createWorld([], [{ pos: pylonPosition, radius: 6.5 }]));

    expect(result.commandBuilder).toHaveBeenCalledTimes(1);
    expect(result.actions).toEqual([{ kind: 'build' }]);
  });

  test('does not impose a power requirement on Pylons', () => {
    jest.spyOn(BuildingPlacement, 'getPlannedPylonPositions').mockReturnValue([]);
    const result = dispatch(createWorld(), UnitType.PYLON);

    expect(result.commandBuilder).toHaveBeenCalledTimes(1);
    expect(result.actions).toEqual([{ kind: 'build' }]);
  });
});
