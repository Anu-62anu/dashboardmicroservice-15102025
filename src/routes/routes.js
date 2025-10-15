const express = require('express');

const { DashboardService } = require('../services/dashboardservice');

const parseConfigFromQuery = (query) => {
  if (!query?.config) {
    return {};
  }

  try {
    return typeof query.config === 'string' ? JSON.parse(query.config) : query.config;
  } catch (error) {
    const parseError = new Error('Invalid config value. Expected JSON string.');
    parseError.statusCode = 400;
    parseError.cause = error;
    throw parseError;
  }
};

const createService = (sdk, query, overrides = {}) => {
  const config = parseConfigFromQuery(query);
  return new DashboardService(sdk, { ...config, ...overrides });
};

const createRoutes = (sdk) => {
  const router = express.Router();

  if (!sdk) {
    throw new Error('Looker SDK instance must be provided to create routes.');
  }

  router.get('/', (_req, res) => {
    res.send('Dashboard Service is up and running!');
  });

  router.get('/health', (_req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  router.get('/api/personal-folder', async (req, res) => {
    try {
      const service = createService(sdk, req.query);
      const folderId = await service.getPersonalFolderId();
      res.json({ success: true, folderId });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/dashboard/tiles-with-results', async (req, res) => {
    try {
      const { dashboardId } = req.body;
      if (!dashboardId) {
        return res.status(400).json({
          success: false,
          error: 'dashboardId parameter is required in URL',
        });
      }

      const service = createService(sdk, req.query);

      let finalFilters = {};
      if (req.query.filters) {
        try {
          finalFilters = JSON.parse(req.query.filters);
        } catch (parseError) {
          return res.status(400).json({
            success: false,
            error: 'Invalid filters format. Must be valid JSON string',
          });
        }
      } else {
        finalFilters = { ...req.query };
        delete finalFilters.config;
      }

      const result = await service.getDashboardTilesWithResults(dashboardId, finalFilters);

      res.json({ success: true, ...result });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/dashboard/copy', async (req, res) => {
    try {
      const service = createService(sdk, {});
      const { originalDashboardId, userDashboardFolderId, originalDashboardCopyTitle } = req.body;
      if (!originalDashboardId || !userDashboardFolderId) {
        return res.status(400).json({
          success: false,
          error: 'Both originalDashboardId and userDashboardFolderId are required in the request body',
        });
      }
      const dashboardId = await service.ensureDashboardCopyInFolder(
        originalDashboardId,
        userDashboardFolderId,
        originalDashboardCopyTitle
      );

      res.json({ success: true, dashboardId });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/dashboard/find', async (req, res) => {
    try {
      const { path, originalDashboardName } = req.body;
      if (!path || !originalDashboardName) {
        return res.status(400).json({
          success: false,
          error: 'Both path and originalDashboardName are required in the request body',
        });
      }
      const service = createService(sdk, req.query);
      const dashboardId = await service.findDashboardInNestedPath(path, originalDashboardName);
      res.json({ success: true, dashboardId });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/folder/get-or-create', async (req, res) => {
    try {
      const service = createService(sdk, req.query);
      const personalFolderId = await service.getPersonalFolderId();
      const folderId = await service.getOrCreateDashboardFolder(personalFolderId);
      res.json({ success: true, folderId });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.put('/api/dashboard/update', async (req, res) => {
    try {
      const service = createService(sdk, req.query);
      const {
        currentDashboardId,
        originalDashboardId,
        selectedColumns,
        selectedFilterDimensions,
        filtersFromRequest,
        filterNameMap,
      } = req.body;

      if (!currentDashboardId) {
        return res.status(400).json({
          success: false,
          error: 'currentDashboardId is required',
        });
      }
      if (!Array.isArray(selectedColumns)) {
        return res.status(400).json({
          success: false,
          error: 'selectedColumns must be an array',
        });
      }
      if (!Array.isArray(selectedFilterDimensions)) {
        return res.status(400).json({
          success: false,
          error: 'selectedFilterDimensions must be an array',
        });
      }

      await service.updateDashboard(
        currentDashboardId,
        originalDashboardId,
        selectedColumns,
        selectedFilterDimensions,
        filtersFromRequest || {},
        filterNameMap || {}
      );

      res.json({ success: true, message: 'Dashboard updated successfully' });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/dashboard/defaults', async (req, res) => {
    try {
      const { dashboardId } = req.body;
      if (!dashboardId) {
        return res.status(400).json({ success: false, error: 'dashboardId parameter is required in URL' });
      }
      const service = createService(sdk, req.query);
      const result = await service.getDefaultColumnsAndFilterNameMap(dashboardId);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/filters/values', async (req, res) => {
    try {
      const { dimensions, selectedMeasure } = req.body;
      const service = createService(sdk, req.query);
      const values = await service.getFilterValues(dimensions, selectedMeasure);
      res.json({ success: true, values });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/filters/date-range-counts', async (req, res) => {
    try {
      const { dimensions, selectedMeasure } = req.body;
      const service = createService(sdk, req.query);
      const counts = await service.getDateRangeCounts(dimensions, selectedMeasure);
      res.json({ success: true, counts });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/dashboard/save-copy', async (req, res) => {
    try {
      const { currentDashboardId, folderId, customName } = req.body;
      const service = createService(sdk, req.query);
      const dashboardId = await service.saveDashboardCopy(
        currentDashboardId,
        folderId,
        customName
      );
      res.json({ success: true, dashboardId });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/dashboard/filters', async (req, res) => {
    try {
      const { dashboardId } = req.body;
      if (!dashboardId) {
        return res.status(400).json({ success: false, error: 'dashboardId parameter is required in URL' });
      }
      const service = createService(sdk, req.query);
      const filters = await service.getDashboardFilters(dashboardId);
      res.json({ success: true, filters });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/folder/dashboards', async (req, res) => {
    try {
      const { folderId } = req.body;
      if (!folderId) {
        return res.status(400).json({ success: false, error: 'folderId parameter is required in URL' });
      }
      const service = createService(sdk, req.query);
      const dashboards = await service.getDashboardListForUI(folderId, req.query.originalDashboardId);
      res.json({ success: true, dashboards });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/api/explore/save-measures', async (req, res) => {
    try {
      const { modelName, exploreName } = req.body;
      const service = createService(sdk, req.query);
      const result = await service.saveExploreMeasures(modelName, exploreName);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });



  return router;
};

module.exports = { createRoutes };
