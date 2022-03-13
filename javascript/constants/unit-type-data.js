'use strict';

const unitTypeData = {
  "4": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 150,
    "weaponCooldownMax": 23.980224609375
  },
  "5": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "6": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "healthMax": 1500,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "19": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.25,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "20": {
    "healthMax": 500,
    "isFlying": false,
    "radius": 1.6875,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "21": {
    "healthMax": 1000,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "22": {
    "healthMax": 850,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "23": {
    "healthMax": 250,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 11.296875
  },
  "24": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0
  },
  "27": {
    "healthMax": 1250,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "28": {
    "healthMax": 1300,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "29": {
    "healthMax": 750,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 43.838623046875
  },
  "33": {
    "healthMax": 175,
    "isFlying": false,
    "radius": 0.875,
    "shieldMax": 0,
    "weaponCooldownMax": 15.134521484375
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
    "weaponCooldownMax": 29.48974609375
  },
  "37": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "38": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "39": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "42": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "45": {
    "healthMax": 45,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 21.586181640625
  },
  "47": {
    "healthMax": 400,
    "isFlying": false,
    "radius": 1.25,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "48": {
    "healthMax": 45,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 14.7587890625
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
    "weaponCooldownMax": 23.8720703125
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
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "shieldMax": 1000,
    "weaponCooldownMax": 0
  },
  "60": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 200,
    "weaponCooldownMax": 0
  },
  "61": {
    "healthMax": 300,
    "isFlying": false,
    "radius": 1.6875,
    "shieldMax": 300,
    "weaponCooldownMax": 0
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
    "shieldMax": 150,
    "weaponCooldownMax": 16.3818359375
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
    "shieldMax": 550,
    "weaponCooldownMax": 0
  },
  "73": {
    "healthMax": 100,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 50,
    "weaponCooldownMax": 20.757568359375
  },
  "74": {
    "healthMax": 80,
    "isFlying": false,
    "radius": 0.625,
    "shieldMax": 80,
    "weaponCooldownMax": 28.9189453125
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
    "shieldMax": 40,
    "weaponCooldownMax": 0
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
    "shieldMax": 100,
    "weaponCooldownMax": 0
  },
  "82": {
    "healthMax": 40,
    "isFlying": true,
    "radius": 0.5,
    "shieldMax": 20,
    "weaponCooldownMax": 0
  },
  "83": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 0.75,
    "shieldMax": 100,
    "weaponCooldownMax": 22.197021484375
  },
  "84": {
    "healthMax": 20,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 20,
    "weaponCooldownMax": 22.476318359375
  },
  "86": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "87": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1,
    "shieldMax": 0
  },
  "88": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.6875,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "89": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "90": {
    "healthMax": 750,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "91": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "93": {
    "healthMax": 850,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "94": {
    "healthMax": 0,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "97": {
    "healthMax": 850,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
  "101": {
    "healthMax": 2500,
    "isFlying": false,
    "radius": 2.75,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "102": {
    "healthMax": 1000,
    "isFlying": false,
    "radius": 1.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "103": {
    "healthMax": 200,
    "isFlying": false,
    "radius": 0.125,
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "112": {
    "healthMax": 200,
    "isFlying": true,
    "radius": 0.625,
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "133": {
    "healthMax": 500,
    "isFlying": false,
    "radius": 1.8125,
    "shieldMax": 500,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "268": {
    "healthMax": 60,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "289": {
    "healthMax": 30,
    "isFlying": false,
    "radius": 0.375,
    "shieldMax": 0,
    "weaponCooldownMax": 0
  },
  "311": {
    "healthMax": 70,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 70,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 0
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
    "shieldMax": 0,
    "weaponCooldownMax": 14.832275390625
  },
  "694": {
    "healthMax": 100,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 100,
    "weaponCooldownMax": 0
  },
  "733": {
    "healthMax": 100,
    "isFlying": false,
    "radius": 0.5,
    "shieldMax": 100,
    "weaponCooldownMax": 0
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