const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 10000;

// Security & Middleware Configuration
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from the 'public' folder at the root directory
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Cloud Database Connection (Aiven with SSL Enabled)
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: {
    rejectUnauthorized: false
  },
  connectTimeout: 30000
};

let db;

function handleDatabaseConnection() {
  db = mysql.createConnection(dbConfig);

  db.connect((err) => {
    if (err) {
      console.error('Database connection failed:', err.message);
      // Attempt to reconnect after 5 seconds if connection fails on startup
      setTimeout(handleDatabaseConnection, 5000);
      return;
    }
    console.log('Connected to Aiven Cloud MySQL successfully!');
  });

  db.on('error', (err) => {
    console.error('MySQL database error:', err.message);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      handleDatabaseConnection();
    } else {
      throw err;
    }
  });
}

// Initialize the database connection
handleDatabaseConnection();

// --- API ROUTES ---

// System Status Check
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', message: 'Heart Monitoring API is running live 24/7!' });
});

// Endpoint for ESP8266 to push live telemetry data
app.post('/api/data', (req, res) => {
  const { heart_rate, SpO2 } = req.body;

  if (!heart_rate) {
    return res.status(400).json({ error: 'Missing heart_rate data' });
  }

  const query = 'INSERT INTO heart_rate_logs (heart_rate, SpO2) VALUES (?, ?)';
  db.query(query, [heart_rate, SpO2 || 0], (err, results) => {
    if (err) {
      console.error('Error inserting telemetry data:', err);
      return res.status(500).json({ error: 'Database insertion failed' });
    }
    res.status(201).json({ success: true, message: 'Telemetry logged successfully to Aiven!' });
  });
});

// Endpoint to fetch recent heart rate logs for the web dashboard
app.get('/api/readings', (req, res) => {
  const query = 'SELECT * FROM heart_rate_logs ORDER BY timestamp DESC LIMIT 50';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching logs:', err);
      return res.status(500).json({ error: 'Failed to retrieve logs' });
    }
    res.json(results);
  });
});

// Fallback Route for Single Page Application routing (serves index.html)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running and listening on port ${PORT}`);
});