//@ts-check
"use strict";

/**
 * Shared logging utilities.
 * @module logging-utils
 */

/**
 * Formats a time value in seconds to a minutes:seconds representation.
 * 
 * @param {number} timeInSeconds - The time value in seconds.
 * @returns {string} The formatted time string.
 */
function formatToMinutesAndSeconds(/** @type {number} */ timeInSeconds) {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = timeInSeconds % 60;
  return `${minutes}:${str_pad_left(String(seconds), '0', 2)}`;
}

/**
 * Checks if the current time is within the specified time range.
 * 
 * @param {World} world - The world context containing data and resources.
 * @param {number} startTime - The start time in seconds.
 * @param {number} endTime - The end time in seconds.
 * 
 * @returns {boolean} - Returns true if within the range, false otherwise.
 */
function isWithinTimeRange(world, startTime, endTime) {
  const currentTime = world.resources.get().frame.timeInSeconds();
  return currentTime >= startTime && currentTime <= endTime;
}

/**
 * Left-pads a string with a specified character up to a desired length.
 * 
 * @param {string} string - The string to pad.
 * @param {number} length - The desired final length of the string.
 * @param {string} padChar - The character to use for padding.
 * @returns {string} The padded string.
 */
function str_pad_left(string, padChar, length) {
  return (new Array(length + 1).join(padChar) + string).slice(-length);
}

module.exports = {
  formatToMinutesAndSeconds,
  isWithinTimeRange,
  str_pad_left
};
