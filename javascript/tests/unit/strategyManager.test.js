const { Race } = require('@node-sc2/core/constants/enums');

const config = require('../../config/config');
const buildOrders = require('../../data/buildOrders');
const StrategyManager = require('../../src/features/strategy/strategyManager');

const mockStrategyContext = {
  setCurrentStrategy: jest.fn(),
  getCurrentStep: jest.fn().mockReturnValue(0),
  getCurrentStrategy: jest.fn(),
  getOutpowered: jest.fn().mockReturnValue(false),
  strategySteps: [],
  currentStep: 0,
  currentStrategy: null,
  outpowered: false,
  trainingTypes: [],
  getTrainingTypes: jest.fn().mockReturnValue([]),
  initialize: jest.fn(),
  setCurrentStep: jest.fn(),
  setTrainingTypes: jest.fn(),
};

jest.mock('../../config/config');

describe('StrategyManager.initializeStrategy', () => {
  /** @type {StrategyManager} */
  let strategyManager;

  beforeEach(() => {
    buildOrders.buildOrderStore = {
      buildOrders: {
        protoss: {
          exampleProtossBuildOrder: {
            title: "Protoss Example",
            raceMatchup: "PvZ",
            steps: [],
            url: "http://example.com/protoss",
          },
        },
        terran: {
          exampleTerranBuildOrder: {
            title: "Terran Example",
            raceMatchup: "TvZ",
            steps: [],
            url: "http://example.com/terran",
          },
        },
        zerg: {
          exampleZergBuildOrder: {
            title: "Zerg Example",
            raceMatchup: "ZvP",
            steps: [],
            url: "http://example.com/zerg",
          },
        },
      },
    };
    config.debugBuildOrderKey = null;

    strategyManager = StrategyManager.getInstance();
    strategyManager.strategyContext = mockStrategyContext;
    strategyManager.initializedRaces.clear();

    jest.clearAllMocks();
  });

  test('should load build orders if they are not initialized', async () => {
    await strategyManager.initializeStrategy(Race.PROTOSS);
    expect(mockStrategyContext.setCurrentStrategy).toHaveBeenCalled();
    expect(buildOrders.buildOrderStore.buildOrders?.protoss).toBeDefined();
  });

  test('should load different build orders based on race', async () => {
    await strategyManager.initializeStrategy(Race.PROTOSS);
    expect(buildOrders.buildOrderStore.buildOrders?.protoss).toBeDefined();
    expect(mockStrategyContext.setCurrentStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ raceMatchup: 'PvZ' })
    );

    await strategyManager.initializeStrategy(Race.TERRAN);
    expect(buildOrders.buildOrderStore.buildOrders?.terran).toBeDefined();
    expect(mockStrategyContext.setCurrentStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ raceMatchup: 'TvZ' })
    );

    await strategyManager.initializeStrategy(Race.ZERG);
    expect(buildOrders.buildOrderStore.buildOrders?.zerg).toBeDefined();
    expect(mockStrategyContext.setCurrentStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ raceMatchup: 'ZvP' })
    );
  });

  test('should not reload build orders if already initialized', async () => {
    await strategyManager.initializeStrategy(Race.PROTOSS);
    expect(mockStrategyContext.setCurrentStrategy).toHaveBeenCalledTimes(1);

    await strategyManager.initializeStrategy(Race.PROTOSS);
    expect(mockStrategyContext.setCurrentStrategy).toHaveBeenCalledTimes(1);
  });

  test('should respect debugBuildOrderKey config if set', async () => {
    config.debugBuildOrderKey = 'exampleProtossBuildOrder';
    await strategyManager.initializeStrategy(Race.PROTOSS);

    expect(mockStrategyContext.setCurrentStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Protoss Example' })
    );
  });
});
