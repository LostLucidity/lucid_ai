const axios = require('axios').default;
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} BuildOrderStep
 * @property {string} supply - The supply count at this step.
 * @property {string} time - The game time for this step.
 * @property {string} action - The action to be taken at this step.
 */

/**
 * @typedef {Object} BuildOrder
 * @property {string} title - The title of the build order.
 * @property {BuildOrderStep[]} steps - The steps in the build order.
 * @property {string} url - The URL of the detailed build order page.
 * @property {string} raceMatchup - The race matchup indicator (e.g., PvZ, TvT, ZvX).
 */


/**
 * Fetches the detailed steps of a build order from its URL.
 * @param {string} buildOrderUrl - The URL of the detailed build order page.
 * @returns {Promise<BuildOrderStep[]>} A promise that resolves to an array of build order steps.
 */
async function fetchBuildOrderSteps(buildOrderUrl) {
  try {
    const { data } = await axios.get(buildOrderUrl);
    const $ = cheerio.load(data);

    /** @type {BuildOrderStep[]} */
    const steps = []; // Explicitly defining the type of 'steps' as an array of 'BuildOrderStep'

    $('tbody > tr').each((i, stepElem) => {
      steps.push({
        supply: $(stepElem).find('td:nth-child(1)').text().trim(),
        time: $(stepElem).find('td:nth-child(2)').text().trim(),
        action: $(stepElem).find('td:nth-child(3)').text().trim()
      });
    });

    return steps;
  } catch (error) {
    console.error('Error fetching build order steps:', error);
    return [];
  }
}

/**
 * Scrapes build orders from a specified URL.
 * @param {string} url - The URL to scrape build orders from.
 * @returns {Promise<void>} A promise that resolves to an array of build orders.
 */
async function scrapeBuildOrders(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    /** @type {BuildOrder[]} */
    let buildOrders = [];

    $('tbody > tr').each((i, element) => {
      const title = $(element).find('td > b > a').text().trim();
      const buildOrderUrl = $(element).find('td > b > a').attr('href');
      const raceMatchup = $(element).find('td:nth-child(3)').text().trim();

      if (buildOrderUrl) {
        buildOrders.push({
          title: title,
          steps: [], // Placeholder for steps
          raceMatchup: raceMatchup,
          url: `https://lotv.spawningtool.com${buildOrderUrl}`
        });
      }
    });

    for (let i = 0; i < buildOrders.length; i++) {
      buildOrders[i].steps = await fetchBuildOrderSteps(buildOrders[i].url);
    }

    // Write to a JSON file
    fs.writeFileSync(path.join(__dirname, 'scrapedBuildOrders.json'), JSON.stringify(buildOrders, null, 2));

    console.log('Build orders have been saved.');

  } catch (error) {
    console.error('Error scraping build orders:', error);
  }
}

scrapeBuildOrders('https://lotv.spawningtool.com/build/');