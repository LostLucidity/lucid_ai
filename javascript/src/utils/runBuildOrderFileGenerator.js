const path = require('path');

const { generateBuildOrderFiles } = require('../features/buildOrders/buildOrderUtils');

const dataFilePath = path.join(__dirname, 'buildOrders/scrapedBuildOrders.json'); // Update the path to your JSON file

generateBuildOrderFiles(dataFilePath);