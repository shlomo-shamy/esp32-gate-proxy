const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const os = require('os');

const app = express();

// Configuration
const PROXY_PORT = process.env.PORT || 3000;
const RAILWAY_SERVER = process.env.RAILWAY_SERVER || 'https://gate-controller-system-production.up.railway.app';

console.log('🚀 Starting ESP32 ↔ Railway Proxy Server...');
console.log('🎯 Target Railway Server:', RAILWAY_SERVER);
console.log('🌐 Proxy Port:', PROXY_PORT, '(Railway assigned)');
console.log('🔧 Environment:', process.env.NODE_ENV || 'development');

// FIXED: Enhanced ESP32 detection and HTTP handling
app.use((req, res, next) => {
  // Enhanced ESP32 detection
  const userAgent = req.headers['user-agent'] || '';
  const isESP32 = userAgent.includes('ESP32') || 
                  userAgent.includes('TinyGSM') ||
                  userAgent.includes('Gate-Controller') ||
                  userAgent.includes('ESP32-Gate-Controller-Cellular') ||
                  req.headers['x-esp32-device'] === 'true';
  
  if (isESP32) {
    // Allow ESP32 requests through without HTTPS redirect
    console.log('📱 ESP32 cellular request detected, allowing HTTP');
    console.log('📱 User-Agent:', userAgent);
    console.log('📱 Method:', req.method, 'Path:', req.path);
    
    // Add ESP32 identification header for downstream processing
    req.headers['x-esp32-request'] = 'true';
    next();
  } else if (req.header('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
    // Only redirect browsers to HTTPS, not ESP32 devices
    console.log('🔄 Redirecting browser to HTTPS');
    res.redirect(301, `https://${req.header('host')}${req.url}`);
  } else {
    next();
  }
});

// Enhanced CORS for ESP32
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'User-Agent',
    'X-ESP32-Device',
    'X-ESP32-Request'
  ]
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ESP32-Railway-Proxy',
    timestamp: new Date().toISOString(),
    target: RAILWAY_SERVER,
    uptime: process.uptime(),
    esp32_support: true
  });
});

// Enhanced proxy configuration
const proxyOptions = {
  target: RAILWAY_SERVER,
  changeOrigin: true,
  secure: true,
  followRedirects: true,
  timeout: 45000, // Increased timeout for cellular
  proxyTimeout: 45000,
  
  // Custom headers for Railway
  headers: {
    'User-Agent': 'ESP32-Proxy/1.0.0',
    'X-Forwarded-Proto': 'https'
  },
  
  // Enhanced logging
  onProxyReq: (proxyReq, req, res) => {
    const timestamp = new Date().toISOString();
    const isESP32 = req.headers['x-esp32-request'] === 'true';
    
    console.log(`📤 [${timestamp}] ${req.method} ${req.url} → ${RAILWAY_SERVER}${req.url}`);
    
    if (isESP32) {
      console.log(`📱 ESP32 Request Details:`);
      console.log(`   User-Agent: ${req.headers['user-agent']}`);
      console.log(`   Content-Type: ${req.headers['content-type']}`);
      console.log(`   Content-Length: ${req.headers['content-length']}`);
      
      // Add ESP32 identifier to forwarded request
      proxyReq.setHeader('X-ESP32-Request', 'true');
      proxyReq.setHeader('X-Original-User-Agent', req.headers['user-agent']);
    }
    
    // Log auth header (truncated)
    if (req.headers.authorization) {
      console.log(`🔐 Auth: ${req.headers.authorization.substring(0, 30)}...`);
    }
    
    // Log body for POST requests
    if (req.method === 'POST' && req.body) {
      console.log(`📦 Body:`, JSON.stringify(req.body, null, 2));
    }
  },
  
  onProxyRes: (proxyRes, req, res) => {
    const timestamp = new Date().toISOString();
    const isESP32 = req.headers['x-esp32-request'] === 'true';
    
    console.log(`📥 [${timestamp}] ${proxyRes.statusCode} ${req.method} ${req.url}`);
    
    if (isESP32) {
      console.log(`📱 ESP32 Response: ${proxyRes.statusCode}`);
      
      if (proxyRes.statusCode >= 400) {
        console.log(`❌ ESP32 Error Response Headers:`, proxyRes.headers);
      } else if (proxyRes.statusCode === 200 || proxyRes.statusCode === 201) {
        console.log(`✅ ESP32 request successful`);
      }
    }
    
    // Log response headers for debugging
    if (proxyRes.statusCode >= 400) {
      console.log(`❌ Error Response Headers:`, proxyRes.headers);
    }
  },
  
  onError: (err, req, res) => {
    const timestamp = new Date().toISOString();
    const isESP32 = req.headers['x-esp32-request'] === 'true';
    
    console.error(`❌ [${timestamp}] Proxy Error for ${req.method} ${req.url}:`, err.message);
    
    if (isESP32) {
      console.error(`📱 ESP32 Proxy Error Details:`, {
        error: err.message,
        code: err.code,
        stack: err.stack
      });
    }
    
    // Send appropriate error response
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Proxy Error',
        message: 'Failed to connect to Railway server',
        timestamp: timestamp,
        target: RAILWAY_SERVER,
        esp32_request: isESP32
      });
    }
  }
};

// Create proxy middleware
const proxy = createProxyMiddleware(proxyOptions);

// Apply proxy to all API routes
app.use('/api', proxy);

// Enhanced root endpoint
app.get('/', (req, res) => {
  const isESP32 = req.headers['user-agent'] && 
                  (req.headers['user-agent'].includes('ESP32') || 
                   req.headers['user-agent'].includes('TinyGSM'));
  
  res.json({
    service: 'ESP32 ↔ Railway Proxy Server',
    status: 'running',
    target: RAILWAY_SERVER,
    esp32_request: isESP32,
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
  console.log('\n✅ ESP32 ↔ Railway Proxy Server Started!');
  console.log(`🌐 Local: http://localhost:${PROXY_PORT}`);
  console.log(`🎯 Target: ${RAILWAY_SERVER}`);
  console.log(`📋 Health Check: http://localhost:${PROXY_PORT}/health`);
  console.log('\n🔄 Ready to proxy ESP32 requests to Railway!');
  console.log('📱 ESP32 User-Agent patterns supported:');
  console.log('   - ESP32*');
  console.log('   - TinyGSM*');
  console.log('   - Gate-Controller*');
  console.log('   - ESP32-Gate-Controller-Cellular*');
  console.log('\n');
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