const helmet = require('helmet');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');

const securityMiddleware = (app) => {
  // Set security headers
  app.use(helmet());

  // Prevent XSS attacks
  app.use(xss());

  // Prevent http param pollution
  app.use(hpp());

  // CORS
  app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
  }));
};

module.exports = securityMiddleware;