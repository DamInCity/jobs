/**
 * Scraper Index
 * Exports all scrapers and utilities
 */

const BaseScraper = require('./BaseScraper');
const BrighterMondayScraper = require('./BrighterMondayScraper');
const MyJobMagScraper = require('./MyJobMagScraper');
const KenyaCareerImporter = require('./kenya/KenyaCareerImporter');
const JSearchImporter = require('./rapidapi/JSearchImporter');
const LinkedInImporter = require('./rapidapi/LinkedInImporter');
const JobsApi14Importer = require('./rapidapi/JobsApi14Importer');

module.exports = {
  BaseScraper,
  BrighterMondayScraper,
  MyJobMagScraper,
  KenyaCareerImporter,
  JSearchImporter,
  LinkedInImporter,
  JobsApi14Importer,

  getAllScrapers: () => [
    { name: 'KenyaCareers', Class: KenyaCareerImporter },
    { name: 'JSearch', Class: JSearchImporter },
    { name: 'LinkedIn', Class: LinkedInImporter },
    { name: 'JobsAPI14', Class: JobsApi14Importer },
    { name: 'BrighterMonday', Class: BrighterMondayScraper },
    { name: 'MyJobMag', Class: MyJobMagScraper },
  ],

  runScraper: async (name, options = {}) => {
    const scrapers = {
      kenyacareers: KenyaCareerImporter,
      kenya: KenyaCareerImporter,
      jsearch: JSearchImporter,
      linkedin: LinkedInImporter,
      jobsapi14: JobsApi14Importer,
      brightermonday: BrighterMondayScraper,
      myjobmag: MyJobMagScraper,
    };

    const ScraperClass = scrapers[name.toLowerCase()];
    if (!ScraperClass) {
      throw new Error(
        `Unknown scraper: ${name}. Available: ${Object.keys(scrapers).join(', ')}`
      );
    }

    const scraper = new ScraperClass();
    return await scraper.run(options);
  },
};
