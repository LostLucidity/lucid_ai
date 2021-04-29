//@ts-check
"use strict"

const path = require('path');

module.exports = {
  target: "node",
  entry: {
    app: ["./main.js"]
  },
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "LucidZ.js"
  }
  node: {
    __dirname: false,
  },
};