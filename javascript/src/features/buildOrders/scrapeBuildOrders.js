const axios = require('axios').default;
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { interpretBuildOrderAction } = require('./buildOrderUtils');

/**
 * Extracts build order steps from the page content.
 * @param {string} data - The HTML content of the page.
 * @returns {import('../../utils/core/globalTypes').BuildOrderStep[]} A promise that resolves to an array of build order steps.
 */
function extractSteps(data) {
  const $ = cheerio.load(data);
  
  /** @type {import('../../utils/core/globalTypes').BuildOrderStep[]} */
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
      interpretedAction: interpretedActions,
      comment
    });
  });
  return steps;
}

/**
 * Fetches the detailed steps of a build order from its URL and all subsequent pages.
 * @param {string} initialUrl - The URL of the detailed build order page.
 * @returns {Promise<import('../../utils/core/globalTypes').BuildOrderStep[]>} A promise that resolves to an array of build order steps.
 */
async function fetchBuildOrderSteps(initialUrl) {
  const visitedUrls = new Set();
  return await scrapePage(initialUrl, visitedUrls);
}

/**
 * Scrapes build orders from a specified URL.
 * @param {string} url - The URL to scrape build orders from.
 * @param {number} maxPages - Maximum number of pages to scrape.
 * @returns {Promise<void>} A promise that resolves once scraping is done.
 */
async function scrapeBuildOrders(url, maxPages = 10) {
  /** @type {string|null} */
  let nextPageUrl = url;
  const visitedUrls = new Set();
  const allBuildOrders = [];
  let pageCount = 0;

  try {
    while (nextPageUrl && pageCount < maxPages) {
      if (visitedUrls.has(nextPageUrl)) {
        console.log('Stopping: URL already visited');
        break;
      }

      console.log(`Fetching URL: ${nextPageUrl}`);
      visitedUrls.add(nextPageUrl);
      const { data } = await axios.get(nextPageUrl);
      const $ = cheerio.load(data);
      /** @type {import('../../utils/core/globalTypes').BuildOrder[]} */
      const buildOrders = [];

      $('tbody > tr').each((i, element) => {
        const title = $(element).find('td > b > a').text().trim();
        const buildOrderUrl = $(element).find('td > b > a').attr('href');
        const raceMatchup = $(element).find('td:nth-child(3)').text().trim();

        if (buildOrderUrl) {
          const fullUrl = new URL(buildOrderUrl, url).href;  // URL construction moved out of loop
          buildOrders.push({
            title,
            url: fullUrl,
            raceMatchup,
            steps: []
          });
        }
      });

      await Promise.all(buildOrders.map(async order => {
        order.steps = await fetchBuildOrderSteps(order.url);
      }));

      allBuildOrders.push(...buildOrders);

      const nextPageLink = $('a.pull-right').attr('href');
      nextPageUrl = nextPageLink ? new URL(nextPageLink, nextPageUrl).href : null;
      pageCount++;
    }

    fs.writeFileSync(path.join(__dirname, 'scrapedBuildOrders.json'), JSON.stringify(allBuildOrders, null, 2));
    console.log('All build orders have been saved.');
  } catch (error) {
    console.error('Error scraping build orders:', error);
  }
}

/**
 * Recursively fetches the detailed steps of a build order from its URL, handling pagination.
 * @param {string} url - The URL of the detailed build order page.
 * @param {Set<string>} visitedUrls - A set of URLs that have already been visited to prevent cycles.
 * @returns {Promise<import('../../utils/core/globalTypes').BuildOrderStep[]>} A promise that resolves to an array of build order steps.
 */
async function scrapePage(url, visitedUrls) {
  if (visitedUrls.has(url)) {
    console.log("URL already visited, skipping:", url);
    return [];
  }

  visitedUrls.add(url);
  console.log("Fetching URL:", url);
  try {
    const { data } = await axios.get(url);
    const steps = extractSteps(data);

    const $ = cheerio.load(data);
    const nextPageLink = $('a.pull-right').attr('href');
    if (nextPageLink) {
      const fullNextPageUrl = new URL(nextPageLink, url).href;
      console.log("Next page link found:", fullNextPageUrl);
      const nextPageSteps = await scrapePage(fullNextPageUrl, visitedUrls);
      return steps.concat(nextPageSteps);
    }
    return steps;
  } catch (error) {
    console.error('Error fetching build order steps from URL:', url, error);
    return [];
  }
}

// Example usage
scrapeBuildOrders('https://lotv.spawningtool.com/build/', 3); // Limit to 5 pages for testing