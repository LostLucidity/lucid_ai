const path = require('path');

const { generateBuildOrderFiles } = require('./buildOrders/buildOrderUtils'); // Adjust the path as necessary

const dataFilePath = path.join(__dirname, 'buildOrders/scrapedBuildOrders.json'); // Update the path to your JSON file

generateBuildOrderFiles(dataFilePath);