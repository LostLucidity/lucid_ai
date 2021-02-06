//@ts-check
"use strict"

module.exports = {
  filterLabels: (unit, labels) => {
    return labels.every(label => !unit.labels.get(label))
  }
} 