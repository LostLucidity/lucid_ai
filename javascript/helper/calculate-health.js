//@ts-check
"use strict"

module.exports = {
  calculateTotalHealthRatio: (unit) => {
    const totalHealthShield = unit.health + unit.shield;
    const maxHealthShield = unit.healthMax + unit.shieldMax;
    return totalHealthShield / maxHealthShield;
  }
}