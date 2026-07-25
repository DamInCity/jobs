/**
 * Upsert categories only (safe to re-run).
 * Usage: node src/db/seedCategories.js
 */

require('dotenv').config();
const db = require('./index');
const { categories } = require('./categories');

async function seedCategories() {
  console.log('🌱 Upserting categories...');
  try {
    for (const cat of categories) {
      await db.query(
        `INSERT INTO categories (name, slug, icon, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           icon = EXCLUDED.icon,
           description = EXCLUDED.description,
           updated_at = CURRENT_TIMESTAMP`,
        [cat.name, cat.slug, cat.icon, cat.description]
      );
    }
    const count = await db.query('SELECT COUNT(*)::int AS n FROM categories');
    console.log(`✅ Categories upserted (${count.rows[0].n} total)`);
  } catch (error) {
    console.error('❌ Category seed failed:', error);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) {
  seedCategories();
}

module.exports = { seedCategories };
