'use strict';

const unitTypeData = {
  "4": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 150
  },
  "8": {
    "healthMax": 50,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "9": {
    "healthMax": 30,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "12": {
    "healthMax": 5,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "16": {
    "healthMax": 35,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "18": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0
  },
  "19": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.25,
    "shieldMax": 0
  },
  "20": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.6875,
    "shieldMax": 0
  },
  "21": {
    "healthMax": 1000,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "22": {
    "healthMax": 850,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "23": {
    "healthMax": 250,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "24": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "31": {
    "healthMax": 150,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "32": {
    "healthMax": 175,
    "isFlying": false,
    "radius": 0.875,
    "shieldMax": 0
  },
  "33": {
    "healthMax": 175,
    "isFlying": false,
    "radius": 0.875,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "34": {
    "healthMax": 135,
    "isFlying": false,
    "radius": 0.75,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "35": {
    "healthMax": 135,
    "isFlying": true,
    "radius": 0.75,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "37": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0
  },
  "38": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0
  },
  "45": {
    "healthMax": 45,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "47": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.25,
    "shieldMax": 0
  },
  "48": {
    "healthMax": 45,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "49": {
    "healthMax": 60,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "51": {
    "healthMax": 125,
    "isFlying": false,
    "radius": 0.5625,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "52": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 0
  },
  "53": {
    "healthMax": 90,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 0
  },
  "54": {
    "healthMax": 150,
    "isFlying": true,
    "radius": 0.75,
    "shieldMax": 0
  },
  "55": {
    "healthMax": 140,
    "isFlying": true,
    "radius": 0.75,
    "shieldMax": 0
  },
  "56": {
    "healthMax": 140,
    "isFlying": true,
    "radius": 0.625,
    "shieldMax": 0
  },
  "57": {
    "healthMax": 550,
    "isFlying": true,
    "radius": 1.25,
    "shieldMax": 0
  },
  "59": {
    "healthMax": 1000,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 1000
  },
  "60": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 200
  },
  "61": {
    "healthMax": 300,
    "isFlying": false,
    "radius": 1.6875,
    "shieldMax": 300
  },
  "62": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "63": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 400
  },
  "65": {
    "healthMax": 500,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 500
  },
  "66": {
    "healthMax": 150,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 150
  },
  "68": {
    "healthMax": 500,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 500
  },
  "70": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "71": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "72": {
    "healthMax": 550,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 550
  },
  "73": {
    "healthMax": 100,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 50
  },
  "74": {
    "healthMax": 80,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 80
  },
  "76": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "77": {
    "healthMax": 40,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 40
  },
  "78": {
    "healthMax": 120,
    "isFlying": true,
    "radius": 0.75,
    "shieldMax": 60
  },
  "80": {
    "healthMax": 150,
    "isFlying": true,
    "radius": 1,
    "shieldMax": 100
  },
  "81": {
    "healthMax": 80,
    "isFlying": true,
    "radius": 0.875,
    "shieldMax": 100
  },
  "82": {
    "healthMax": 0,
    "isFlying": true,
    "radius": 0.5,
    "shieldMax": 0
  },
  "83": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 0.75,
    "shieldMax": 100
  },
  "84": {
    "healthMax": 20,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 20
  },
  "86": {
    "healthMax": 1500,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0
  },
  "87": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 0
  },
  "88": {
    "healthMax": 500,
    "isFlying": false,
    "radius": 1.6875,
    "shieldMax": 0
  },
  "89": {
    "healthMax": 1000,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "90": {
    "healthMax": 750,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "91": {
    "healthMax": 850,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "97": {
    "healthMax": 850,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "98": {
    "healthMax": 300,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0
  },
  "99": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 0.875,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "100": {
    "healthMax": 2000,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0
  },
  "103": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 0.125,
    "shieldMax": 0
  },
  "104": {
    "healthMax": 40,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 21.979248046875
  },
  "105": {
    "healthMax": 35,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 10.13525390625
  },
  "106": {
    "healthMax": 200,
    "isFlying": true,
    "radius": 1,
    "shieldMax": 0
  },
  "107": {
    "healthMax": 90,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 0,
    "weaponCooldownMax": 11.1875
  },
  "110": {
    "healthMax": 145,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 0,
    "weaponCooldownMax": 30.99853515625
  },
  "111": {
    "healthMax": 90,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 0
  },
  "112": {
    "healthMax": 200,
    "isFlying": true,
    "radius": 0.625,
    "shieldMax": 0
  },
  "117": {
    "healthMax": 90,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 0
  },
  "118": {
    "healthMax": 145,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 0
  },
  "119": {
    "healthMax": 35,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "125": {
    "healthMax": 175,
    "isFlying": false,
    "radius": 0.875,
    "shieldMax": 0
  },
  "126": {
    "healthMax": 175,
    "isFlying": false,
    "radius": 0.875,
    "shieldMax": 0,
    "weaponCooldownMax": 13.4599609375
  },
  "127": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 0
  },
  "128": {
    "healthMax": 200,
    "isFlying": true,
    "radius": 1,
    "shieldMax": 0
  },
  "129": {
    "healthMax": 200,
    "isFlying": true,
    "radius": 1,
    "shieldMax": 0
  },
  "130": {
    "healthMax": 1500,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0
  },
  "132": {
    "healthMax": 1500,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0
  },
  "133": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "136": {
    "healthMax": 80,
    "isFlying": true,
    "radius": 0.875,
    "shieldMax": 100
  },
  "137": {
    "healthMax": 50,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 0
  },
  "138": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 0
  },
  "141": {
    "healthMax": 10,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 350
  },
  "142": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0
  },
  "151": {
    "healthMax": 25,
    "isFlying": false,
    "radius": 0.125,
    "shieldMax": 0
  },
  "268": {
    "healthMax": 60,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "289": {
    "healthMax": 30,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0
  },
  "311": {
    "healthMax": 70,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 70
  },
  "484": {
    "healthMax": 135,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 0
  },
  "498": {
    "healthMax": 90,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 0
  },
  "500": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 0
  },
  "687": {
    "healthMax": 100,
    "isFlying": false,
    "radius": 0.75,
    "shieldMax": 0
  },
  "688": {
    "healthMax": 120,
    "isFlying": false,
    "radius": 0.75,
    "shieldMax": 0
  },
  "689": {
    "healthMax": 180,
    "isFlying": true,
    "radius": 0.75,
    "shieldMax": 0
  },
  "692": {
    "healthMax": 120,
    "isFlying": false,
    "radius": 0.75,
    "shieldMax": 0
  },
  "734": {
    "healthMax": 180,
    "isFlying": true,
    "radius": 0.75,
    "shieldMax": 0
  },
  "830": {
    "healthMax": 1,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 0
  },
  "893": {
    "healthMax": 200,
    "isFlying": true,
    "radius": 1,
    "shieldMax": 0
  }
}

module.exports = unitTypeData;