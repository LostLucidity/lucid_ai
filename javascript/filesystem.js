//@ts-check
"use strict"

const fs = require('fs');
const path = require('path');
const { getFileName } = require('./helper/get-races');

module.exports = {
  /**
   * @returns {[]}
   */
  readUnitTypeData: () => {
    return JSON.parse(fs.readFileSync(
      path.join(__dirname, 'data', `unit-type-data.json`)).toString()
    );
  },
  /**
   * @param {{}} unitTypeData 
   */
  saveUnitTypeData: (unitTypeData) => {
    fs.writeFileSync(path.join(__dirname, 'data', `unit-type-data.json`), JSON.stringify(unitTypeData));
  },
  readFromMatchup: (state, data, selfUnit, enemyUnit) => {
    try {
      state.compositions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', getFileName(data, selfUnit.unitType, enemyUnit.unitType))).toString());
    } catch (error) {
      console.log('error', error);
      fs.writeFileSync(path.join(__dirname, 'data', getFileName(data, selfUnit.unitType, enemyUnit.unitType)), JSON.stringify(state.compositions));
    }
  },
  writeToCurrent: (state) => {
    try {
      fs.writeFileSync(path.join(__dirname, 'data', `current.json`), JSON.stringify(state.compositions));
    } catch (error) {
      console.log('error', error);
    }
  }
}