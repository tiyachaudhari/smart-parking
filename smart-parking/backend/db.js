const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true,
  dateStrings: true // So that DATETIME is returned as string instead of JS Date object which may add timezone complexities
};

let pool;

async function initDB() {
  try {
    // Connect without database selected
    const connection = await mysql.createConnection(dbConfig);

    // Create DB if not exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
    await connection.query(`USE \`${process.env.DB_NAME}\``);
    console.log(`Database '${process.env.DB_NAME}' checked/created.`);

    // Read and parse schema.sql
    const schemaPath = path.join(__dirname, '../sql/schema.sql');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    // We split using our custom marker
    const statements = schemaContent.split('-- SPLIT');

    console.log('Bootstrapping database schema...');
    for (let stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await connection.query(trimmed);
      }
    }
    console.log('Database schema bootstrap complete.');

    await connection.end();

    // Create the actual pool for the application to use
    pool = mysql.createPool({
      ...dbConfig,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    return pool;
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

module.exports = {
  initDB,
  getPool: () => pool
};
