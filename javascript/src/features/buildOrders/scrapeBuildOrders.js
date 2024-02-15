const axios = require('axios').default;
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const { interpretBuildOrderAction } = require('./buildOrderUtils');

/**
 * Fetches the detailed steps of a build order from its URL.
 * @param {string} buildOrderUrl - The URL of the detailed build order page.
 * @returns {Promise<import('../../utils/gameLogic/globalTypes').BuildOrderStep[]>} A promise that resolves to an array of build order steps.
 */
async function fetchBuildOrderSteps(buildOrderUrl) {
  try {
    const { data } = await axios.get(buildOrderUrl);
    const $ = cheerio.load(data);

    /** @type {import('../../utils/gameLogic/globalTypes').BuildOrderStep[]} */
    const steps = [];

    $('tbody > tr').each((i, stepElem) => {
      const supply = $(stepElem).find('td:nth-child(1)').text().trim();
      const time = $(stepElem).find('td:nth-child(2)').text().trim();
      const action = $(stepElem).find('td:nth-child(3)').text().trim();
      const comment = $(stepElem).find('td:nth-child(4)').text().trim();

      const interpretedActions = interpretBuildOrderAction(action, comment);
      steps.push({
        supply,
        time,
        action,
        interpretedAction: interpretedActions, // Now assigning the array directly
        comment
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

    /** @type {import('../../utils/gameLogic/globalTypes').BuildOrder[]} */
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