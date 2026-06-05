/**
 * Scraper Index
 * Exports all scrapers and utilities
 */

const BaseScraper = require('./BaseScraper');
const BrighterMondayScraper = require('./BrighterMondayScraper');
const MyJobMagScraper = require('./MyJobMagScraper');

module.exports = {
  BaseScraper,
  BrighterMondayScraper,
  MyJobMagScraper,
  
  // Helper to get all available scrapers
  getAllScrapers: () => [
    { name: 'BrighterMonday', Class: BrighterMondayScraper },
    { name: 'MyJobMag', Class: MyJobMagScraper },
  ],
  
  // Helper to run a specific scraper
  runScraper: async (name, options = {}) => {
    const scrapers = {
      brightermonday: BrighterMondayScraper,
      myjobmag: MyJobMagScraper,
    };
    
    const ScraperClass = scrapers[name.toLowerCase()];
    if (!ScraperClass) {
      throw new Error(`Unknown scraper: ${name}. Available: ${Object.keys(scrapers).join(', ')}`);
    }
    
    const scraper = new ScraperClass();
    return await scraper.run(options);
  },
};
