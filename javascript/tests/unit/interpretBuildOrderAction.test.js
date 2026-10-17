const { Upgrade, UnitType } = require('@node-sc2/core/constants');

const {
  interpretBuildOrderAction,
  loadActionMappings,
} = require('../../data/buildOrders/scripts/buildOrderUtils');

describe('interpretBuildOrderAction - Upgrade and Unit Actions', () => {
  beforeAll(async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    await loadActionMappings();
    logSpy.mockRestore();
  });

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

  test.each([
    ['Adaptive Talons', 'DIGGINGCLAWS'],
    ['Adrenal Glands', 'ZERGLINGATTACKSPEED'],
    ['Centrifugal Hooks', 'CENTRIFICALHOOKS'],
    ['Cloaking Field', 'BANSHEECLOAK'],
    ['Drilling Claws', 'DRILLCLAWS'],
    ['Grooved Spines', 'EVOLVEGROOVEDSPINES'],
    ['Infernal Pre-Igniter', 'INFERNALPREIGNITERS'],
    ['Mag-Field Accelerator', 'MAGFIELDLAUNCHERS'],
    ['Metabolic Boost', 'ZERGLINGMOVEMENTSPEED'],
    ['Muscular Augments', 'EVOLVEMUSCULARAUGMENTS'],
    ['Pneumatized Carapace', 'OVERLORDSPEED'],
    ['Protoss Ground Armor Level 1', 'PROTOSSGROUNDARMORSLEVEL1'],
    ['Protoss Ground Armor Level 2', 'PROTOSSGROUNDARMORSLEVEL2'],
    ['Psionic Storm', 'PSISTORMTECH'],
    ['Resonating Glaives', 'ADEPTPIERCINGATTACK'],
    ['Seismic Spines', 'LURKERRANGE'],
    ['Terran Infantry Armor Level 1', 'TERRANINFANTRYARMORSLEVEL1'],
    ['Terran Infantry Armor Level 2', 'TERRANINFANTRYARMORSLEVEL2'],
    ['Terran Vehicle And Ship Armor Level 1', 'TERRANVEHICLEANDSHIPARMORSLEVEL1'],
    ['Zerg Ground Armor Level 1', 'ZERGGROUNDARMORSLEVEL1'],
    ['Zerg Ground Armor Level 2', 'ZERGGROUNDARMORSLEVEL2'],
  ])('should recognize %s as upgrade %s', (action, upgradeKey) => {
    expect(interpretBuildOrderAction(action)).toEqual([
      expect.objectContaining({
        unitType: null,
        upgradeType: Upgrade[upgradeKey],
        count: 1,
        isUpgrade: true,
      }),
    ]);
  });

  test.each([
    ['Lurker', 'LURKERMP'],
    ['Lurker Den', 'LURKERDENMP'],
    ['Swarm Host', 'SWARMHOSTMP'],
    ['Templar Archives', 'TEMPLARARCHIVE'],
  ])('should recognize %s as unit %s', (action, unitKey) => {
    expect(interpretBuildOrderAction(action)).toEqual([
      expect.objectContaining({
        unitType: UnitType[unitKey],
        upgradeType: null,
        count: 1,
        isUpgrade: false,
      }),
    ]);
  });

  test('should preserve count and Chrono Boost metadata for deterministic aliases', () => {
    expect(interpretBuildOrderAction('Lurker x5')[0]).toEqual(
      expect.objectContaining({ unitType: UnitType.LURKERMP, count: 5 })
    );
    expect(interpretBuildOrderAction('Resonating Glaives (Chrono Boost)')[0]).toEqual(
      expect.objectContaining({
        upgradeType: Upgrade.ADEPTPIERCINGATTACK,
        isChronoBoosted: true,
      })
    );
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
