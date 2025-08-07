const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const os = require('os');

const app = express();

// Configuration
const PROXY_PORT = process.env.PORT || 3000; // Railway provides PORT automatically
const RAILWAY_SERVER = process.env.RAILWAY_SERVER || 'https://gate-controller-system-production.up.railway.app';

console.log('🚀 Starting ESP32 ↔ Railway Proxy Server...');
console.log('🎯 Target Railway Server:', RAILWAY_SERVER);
console.log('🌐 Proxy Port:', PROXY_PORT, '(Railway assigned)');
console.log('🔧 Environment:', process.env.NODE_ENV || 'development');

// In your Railway proxy-server.js, add this middleware BEFORE other routes:
app.use((req, res, next) => {
  // Accept HTTP requests from cellular without redirecting
  if (req.headers['user-agent'] && req.headers['user-agent'].includes('ESP32')) {
    // Allow HTTP for ESP32 requests
    next();
  } else if (req.header('x-forwarded-proto') !== 'https') {
    // Redirect browsers to HTTPS but not ESP32
    res.redirect(301, `https://${req.header('host')}${req.url}`);
  } else {
    next();
  }
});

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Get local IP address for logging
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ESP32-Railway-Proxy',
    timestamp: new Date().toISOString(),
    target: RAILWAY_SERVER,
    uptime: process.uptime()
  });
});

// Proxy configuration
const proxyOptions = {
  target: RAILWAY_SERVER,
  changeOrigin: true,
  secure: true, // Enable SSL verification for Railway HTTPS
  followRedirects: true,
  timeout: 30000, // 30 second timeout
  proxyTimeout: 30000,
  
  // Custom headers for Railway
  headers: {
    'User-Agent': 'ESP32-Proxy/1.0.0',
    'X-Forwarded-Proto': 'https'
  },
  
  // Logging
  onProxyReq: (proxyReq, req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`📤 [${timestamp}] ${req.method} ${req.url} → ${RAILWAY_SERVER}${req.url}`);
    
    // Log headers for debugging
    if (req.headers.authorization) {
      console.log(`🔐 Auth: ${req.headers.authorization.substring(0, 20)}...`);
    }
    
    // Log body for POST requests
    if (req.method === 'POST' && req.body) {
      console.log(`📦 Body:`, JSON.stringify(req.body, null, 2));
    }
  },
  
  onProxyRes: (proxyRes, req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`📥 [${timestamp}] ${proxyRes.statusCode} ${req.method} ${req.url}`);
    
    // Log response headers for debugging
    if (proxyRes.statusCode >= 400) {
      console.log(`❌ Error Response Headers:`, proxyRes.headers);
    }
  },
  
  onError: (err, req, res) => {
    const timestamp = new Date().toISOString();
    console.error(`❌ [${timestamp}] Proxy Error for ${req.method} ${req.url}:`, err.message);
    
    // Send error response to ESP32
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Proxy Error',
        message: 'Failed to connect to Railway server',
        timestamp: timestamp,
        target: RAILWAY_SERVER
      });
    }
  }
};

// Create proxy middleware
const proxy = createProxyMiddleware(proxyOptions);

// Apply proxy to all API routes
app.use('/api', proxy);

// Handle root requests
app.get('/', (req, res) => {
  res.json({
    service: 'ESP32 ↔ Railway Proxy Server',
    status: 'running',
    target: RAILWAY_SERVER,
    endpoints: {
      health: '/health',
      proxy: '/api/*'
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Express Error:', error);
  res.status(500).json({
    error: 'Internal Server Error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PROXY_PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n✅ ESP32 ↔ Railway Proxy Server Started!');
  console.log(`🌐 Local: http://localhost:${PROXY_PORT}`);
  console.log(`📡 Network: http://${localIP}:${PROXY_PORT}`);
  console.log(`🎯 Target: ${RAILWAY_SERVER}`);
  console.log(`📋 Health Check: http://localhost:${PROXY_PORT}/health`);
  console.log('\n🔄 Ready to proxy ESP32 requests to Railway!\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});