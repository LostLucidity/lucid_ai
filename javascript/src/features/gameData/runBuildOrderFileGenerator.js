const fs = require('fs');
const path = require('path');

const { generateBuildOrderFiles } = require('../buildOrders/buildOrderUtils');

// Ensure the path is updated according to the actual location of the scrapedBuildOrders.json file
const dataFilePath = path.join(__dirname, '../../features/buildOrders/scrapedBuildOrders.json');

// Adding a function to check the existence of the file before attempting to generate build order files
function runBuildOrderFileGenerator() {
  try {
    // Check if the file exists before proceeding
    if (fs.existsSync(dataFilePath)) {
      console.log('Found build orders data file. Generating build order files...');
      generateBuildOrderFiles(dataFilePath);
      console.log('Build order files have been successfully generated.');
    } else {
      console.error(`No data file found at ${dataFilePath}. Please check the path and try again.`);
    }
  } catch (error) {
    console.error('An error occurred while generating build order files:', error);
  }
}

runBuildOrderFileGenerator();