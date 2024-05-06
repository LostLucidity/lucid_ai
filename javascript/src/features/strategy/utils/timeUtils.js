/**
 * Converts a time string formatted as 'm:ss' to the total number of seconds.
 * @param {string} timeString - The time string to convert.
 * @returns {number} The total seconds.
 */
function convertTimeStringToSeconds(timeString) {
  const [minutes, seconds] = timeString.split(':').map(Number);
  return minutes * 60 + seconds;
}  


module.exports = {
  convertTimeStringToSeconds,
};
