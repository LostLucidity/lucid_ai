const frameService = {
  /**
   * @param {number} frames 
   * @returns {number}
   */
  getTimeInSeconds(frames) {
    return frames / 22.4;
  }
}
module.exports = frameService;