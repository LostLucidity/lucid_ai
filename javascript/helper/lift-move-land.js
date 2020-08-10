//@ts-check
"use strict"

const PromiseBluebird = require('bluebird');

const Ability = require('@node-sc2/core/constants/ability');

function liftMoveLand(actions, building, position) {
  PromiseBluebird.all([
    actions.do(Ability.LIFT, building.tag),
  ])
  .delay(200)
  .then(() => {
    return PromiseBluebird.all([
      actions.move([building], position, true),
    ]);
  })
  .delay(100)
  .then(() => {
    return PromiseBluebird.all([
      actions.do(Ability.LAND, building.tag, { target: position, queue: true }),
    ]);
  })
  .delay(100)
  .catch((e) => {
    console.log(e);
  });
}

module.exports = liftMoveLand;