const nodeSc2Constants = require("@node-sc2/core/constants");
const { UnitType } = nodeSc2Constants;

const { BUFF_IDS } = require("../../src/core/constants");
const { getBuildTimeLeft } = require("../../src/features/shared/timeUtils");
const StrategyManager = require("../../src/features/strategy/strategyManager");
const { getMovementSpeed } = require("../../src/utils/movementUtils");

describe("node-sc2 buff compatibility", () => {
  it("owns the Blizzard stable buff IDs that node-sc2 does not export", () => {
    expect(nodeSc2Constants.Buff).toBeUndefined();
    expect(BUFF_IDS).toEqual({
      STIMPACK: 27,
      CHRONOBOOSTENERGYCOST: 281,
    });
  });

  it("applies the Stimpack movement-speed multiplier", () => {
    const unit = {
      alliance: 1,
      buffIds: [BUFF_IDS.STIMPACK],
      data: () => ({ movementSpeed: 3 }),
      pos: { x: 10, y: 10 },
      unitType: UnitType.MARINE,
    };

    expect(getMovementSpeed({ hasCreep: () => false }, unit, {})).toBe(4.5);
  });

  it("applies the Chrono Boost build-time reduction", () => {
    const unit = { buffIds: [BUFF_IDS.CHRONOBOOSTENERGYCOST] };

    expect(getBuildTimeLeft(unit, 90, 0)).toBe(60);
  });

  it("detects Chrono Boost in the strategy path", () => {
    const abilityId = 123;
    const trainingUnit = {
      buffIds: [BUFF_IDS.CHRONOBOOSTENERGYCOST],
      orders: [{ abilityId }],
    };
    const units = {
      getById: () => [{}],
      getStructures: () => [trainingUnit],
    };
    const world = {
      data: { getUnitTypeData: () => ({ abilityId }) },
      resources: { get: () => ({ units }) },
    };

    expect(StrategyManager.checkChronoBoostBuff(world, UnitType.ZEALOT)).toBe(true);
  });
});
