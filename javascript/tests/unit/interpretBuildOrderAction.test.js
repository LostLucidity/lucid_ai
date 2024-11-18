const { Upgrade, UnitType } = require('@node-sc2/core/constants');

const { interpretBuildOrderAction } = require('../../data/buildOrders/scripts/buildOrderUtils');

describe('interpretBuildOrderAction - Upgrade and Unit Actions', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => { });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should recognize "Charge" as an upgrade action', () => {
    const result = interpretBuildOrderAction("Charge");

    expect(result).toEqual([
      {
        unitType: null,
        upgradeType: Upgrade.CHARGE,
        count: 1,
        isUpgrade: true,
        isChronoBoosted: false,
        specialAction: null
      }
    ]);
  });

  test('should recognize "Phoenix (Chrono Boost)" as a unit action with chrono boost', () => {
    const result = interpretBuildOrderAction("Phoenix (Chrono Boost)");

    expect(result).toEqual([
      {
        unitType: UnitType.PHOENIX,
        upgradeType: null,
        count: 1,
        isUpgrade: false,
        isChronoBoosted: true,
        specialAction: null
      }
    ]);
  });

  test('should handle "Viking" as a VIKINGFIGHTER unit action', () => {
    const result = interpretBuildOrderAction("Viking");

    expect(result).toEqual([
      {
        unitType: UnitType.VIKINGFIGHTER,
        upgradeType: null,
        count: 1,
        isUpgrade: false,
        isChronoBoosted: false,
        specialAction: null
      }
    ]);
  });

  test('should handle unknown action gracefully', () => {
    const result = interpretBuildOrderAction("Unknown Action");

    expect(result).toEqual([
      {
        unitType: null,
        upgradeType: null,
        count: 1,
        isUpgrade: false,
        isChronoBoosted: false,
        specialAction: null,
      }
    ]);

    expect(console.warn).toHaveBeenCalledWith('Unrecognized action: Unknown Action');
  });
});
