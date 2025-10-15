const express = require('express');

const { createRoutes } = require('./routes/routes');
const { errorHandler } = require('./utils/errorHandler');

const createApp = (sdk) => {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/', createRoutes(sdk));

  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
