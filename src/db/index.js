const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.db);

// Log connection events in development
if (config.env === 'development') {
  pool.on('connect', () => {
    console.log('📦 Database connected');
  });
  
  pool.on('error', (err) => {
    console.error('❌ Database connection error:', err);
  });
}

// Helper function for single queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (config.env === 'development') {
      console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Helper function for transactions
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Get a client for manual transaction control
const getClient = () => pool.connect();

module.exports = {
  pool,
  query,
  transaction,
  getClient,
};
