//@ts-check
const { LARVA, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { Alliance } = require("@node-sc2/core/constants/enums");

async function defend(resources) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const combatUnits = units.getCombatUnits();
  const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
  let [ closestEnemyUnit ] = units.getClosest(map.getCombatRally(), enemyUnits, 1);
  if (closestEnemyUnit) {
    const supportUnits = [];
    if (closestEnemyUnit.isFlying) {
      // if no anti air in combat, use Queens.
      const findAntiAir = combatUnits.find(unit => unit.canShootUp());
      if (!findAntiAir) {
        supportUnits.push(...units.getById(QUEEN));
      }
    }
    const [ combatPoint ] = units.getClosest(closestEnemyUnit.pos, combatUnits, 1);
    if (combatPoint) {
      const pointType = combatPoint.unitType;
      const pointTypeUnits = units.getById(pointType);
      const nonPointTypeUnits = combatUnits.filter(unit => !(unit.unitType === pointType));
      await actions.attackMove(nonPointTypeUnits, combatPoint.pos)
      if (supportUnits.length > 1) {
        await actions.move(supportUnits, combatPoint.pos);
      }
      await actions.attackMove(pointTypeUnits, closestEnemyUnit.pos);
    }
  }
}

module.exports = defend;