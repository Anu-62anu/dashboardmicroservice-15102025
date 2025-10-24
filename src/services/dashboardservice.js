
const fs = require('fs');
const path = require('path');
const { initializeFirebase } = require('../config');

class DashboardService {
  constructor(sdk, config = {}) {
    if (!sdk) {
      throw new Error('Looker SDK instance is required to use DashboardService.');
    }

    this.sdk = sdk;
    this.config = config;
  }

  async getPersonalFolderId() {
    const me = await this.sdk.ok(this.sdk.me());
    if (!me) throw new Error('Failed to retrieve current user info.');
    const personalId = me.personal_folder_id ? String(me.personal_folder_id) : '';
    if (personalId) return personalId;
    if (me.home_folder_id) return String(me.home_folder_id);
    throw new Error('Could not determine personal_folder_id or home_folder_id for the current user.');
  }

  async ensureDashboardCopyInFolder(originalDashboardId, folderId, copyTitle) {
    const dashboardsInFolder = await this.sdk.ok(
      this.sdk.search_dashboards({
        folder_id: folderId,
        fields: 'id,title,folder_id,deleted',
        per_page: 200,
      })
    );

    const existingCopy = dashboardsInFolder.find((dashboard) => {
      if (!dashboard?.id || dashboard.deleted) {
        return false;
      }

      const isSameFolder = String(dashboard.folder_id) === String(folderId);
      const titleMatches =
        typeof dashboard.title === 'string' &&
        dashboard.title.trim().toLowerCase() === copyTitle.trim().toLowerCase();

      return isSameFolder && titleMatches;
    });

    if (existingCopy?.id) {
      if (existingCopy.title !== copyTitle) {
        await this.sdk.ok(
          this.sdk.update_dashboard(existingCopy.id, { title: copyTitle })
        );
      }
      return String(existingCopy.id);
    }

    const copiedDashboard = await this.sdk.ok(
      this.sdk.copy_dashboard(originalDashboardId, folderId)
    );

    if (!copiedDashboard.id) {
      throw new Error('Failed to copy dashboard: missing id');
    }

    await this.sdk.ok(
      this.sdk.update_dashboard(copiedDashboard.id, { title: copyTitle })
    );

    return String(copiedDashboard.id);
  }

  async findDashboardInNestedPath(pathSegments, dashboardTitle) {
    try {
      const parts = (Array.isArray(pathSegments) ? pathSegments : pathSegments.split('/')).map((p) =>
        p.trim().toLowerCase()
      );
      if (parts.length === 0) throw new Error('Path is empty');

      let currentFolderId = null;

      for (let i = 0; i < parts.length; i++) {
        const folderNameNorm = parts[i];

        if (i === 0 && folderNameNorm === 'shared') {
          const me = await this.sdk.ok(this.sdk.me());
          if (!me.home_folder_id) {
            throw new Error('home_folder_id not found for current user');
          }
          currentFolderId = String(me.home_folder_id);
          continue;
        }

        const parentFolderId = currentFolderId;

        const folders = await this.sdk.ok(
          this.sdk.search_folders({
            parent_id: parentFolderId,
            name: folderNameNorm,
            fields: 'id,name,parent_id',
            per_page: 200,
          })
        );

        const matchedFolder = folders.find(
          (f) => f.name?.trim().toLowerCase() === folderNameNorm
        );

        if (!matchedFolder) {
          const siblings = await this.sdk.ok(
            this.sdk.search_folders({
              parent_id: parentFolderId,
              fields: 'id,name,parent_id',
              per_page: 200,
            })
          );
          const available = siblings.map((f) => f.name).join(', ') || 'None';
          throw new Error(`Folder "${parts[i]}" not found. Available: ${available}`);
        }

        currentFolderId = String(matchedFolder.id);
      }

      if (!currentFolderId) {
        throw new Error('Failed to resolve folder path: currentFolderId is null');
      }

      const dashboards = await this.sdk.ok(
        this.sdk.search_dashboards({
          folder_id: currentFolderId,
          title: dashboardTitle.trim(),
          fields: 'id,title,folder_id,deleted',
          per_page: 200,
        })
      );

      const inFolder = dashboards.filter(
        (d) => String(d.folder_id) === String(currentFolderId) && !d.deleted
      );

      if (inFolder.length === 0) {
        const allInFolder = await this.sdk.ok(
          this.sdk.search_dashboards({
            folder_id: currentFolderId,
            fields: 'id,title,folder_id,deleted',
            per_page: 200,
          })
        );
        const availableTitles = allInFolder
          .filter((d) => !d.deleted)
          .map((d) => d.title)
          .filter(Boolean)
          .join(', ') || 'None';

        throw new Error(
          `Dashboard titled "${dashboardTitle}" not found in folder ID "${currentFolderId}". Available: ${availableTitles}`
        );
      }

      const exactMatch = inFolder.find(
        (d) => d.title?.trim().toLowerCase() === dashboardTitle.trim().toLowerCase()
      );

      const dashboard = exactMatch || inFolder[0];

      if (!dashboard.id) {
        throw new Error('Found dashboard has no ID');
      }

      return String(dashboard.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to locate dashboard "${dashboardTitle}": ${errorMessage}`);
    }
  }

  async getOrCreateDashboardFolder(parentFolderId) {
    const existingFolders = await this.sdk.ok(
      this.sdk.search_folders({ name: this.config.folderName, parent_id: parentFolderId })
    );
    if (existingFolders.length > 0) return String(existingFolders[0].id);

    const newFolder = await this.sdk.ok(
      this.sdk.create_folder({ name: this.config.folderName, parent_id: parentFolderId })
    );
    return String(newFolder.id);
  }

  async ensureTileListeners(
    dashboardId,
    selectedFilterDimensions,
    filterNameMap
  ) {
    const elements = await this.sdk.ok(this.sdk.dashboard_dashboard_elements(dashboardId));

    for (const element of elements) {
      const filterable = element.result_maker?.filterables?.[0];
      if (!filterable) continue;

      const currentListens = Array.isArray(filterable.listen) ? filterable.listen : [];

      const byKey = new Map();
      for (const listen of currentListens) {
        byKey.set(`${listen.dashboard_filter_name}::${listen.field}`, listen);
      }

      for (const dimension of selectedFilterDimensions) {
        const dashFilterName = filterNameMap[dimension] || dimension;
        const key = `${dashFilterName}::${dimension}`;
        if (!byKey.has(key)) {
          byKey.set(key, { dashboard_filter_name: dashFilterName, field: dimension });
        }
      }

      const updatedListens = Array.from(byKey.values());

      const changed =
        updatedListens.length !== currentListens.length ||
        updatedListens.some(
          (updated, index) =>
            !currentListens[index] ||
            updated.dashboard_filter_name !== currentListens[index].dashboard_filter_name ||
            updated.field !== currentListens[index].field
        );
      if (!changed) continue;

      await this.sdk.ok(
        this.sdk.update_dashboard_element(element.id, {
          result_maker: {
            ...(element.result_maker || {}),
            filterables: [{ ...filterable, listen: updatedListens }],
          },
        })
      );
    }
  }

  async updateDashboard(
    currentDashboardId,
    originalDashboardId,
    selectedColumns,
    selectedFilterDimensions,
    filtersFromRequest,
    filterNameMap
  ) {
    if (currentDashboardId === originalDashboardId) {
      throw new Error('Original dashboard cannot be updated');
    }

    const dashboard = await this.sdk.ok(this.sdk.dashboard(currentDashboardId));

    const tile = dashboard.dashboard_elements?.find((element) => element.title === this.config.tileTitle);

    if (!tile || !tile.id) {
      throw new Error('Tile not found or missing ID');
    }

    const queryId = tile.query_id || tile.result_maker?.query_id;
    if (!queryId) {
      throw new Error('No query_id found — tile has neither query_id nor result_maker.query_id');
    }

    const originalQuery = await this.sdk.ok(this.sdk.query(queryId));

    const { id, client_id, slug, ...rest } = originalQuery;

    const queryConfig = {
      ...rest,
      fields: selectedColumns,
      client_id: `custom_client_id_${Date.now()}`,
    };

    if (this.config.tileTitle) {
      queryConfig.vis_config = {
        ...(rest.vis_config || {}),
        type: 'table',
        column_order: selectedColumns,
        show_row_numbers: true,
        table_theme: 'editable',
      };
    }

    const newQuery = await this.sdk.ok(this.sdk.create_query(queryConfig));
    await this.sdk.ok(this.sdk.update_dashboard_element(tile.id, { query_id: newQuery.id }));

    const existingFilters = dashboard.dashboard_filters || [];

    for (const filter of existingFilters) {
      if (filter.dimension && !selectedFilterDimensions.includes(filter.dimension)) {
        await this.sdk.ok(this.sdk.delete_dashboard_filter(filter.id));
      }
    }

    for (const dimension of selectedFilterDimensions) {
      const title = filterNameMap[dimension] || dimension;
      const defaultValue = title ? (filtersFromRequest[title] || '') : '';

      const filterData = {
        dashboard_id: currentDashboardId,
        title,
        type: 'field_filter',
        model: this.config.model,
        explore: this.config.explore,
        dimension,
        row: 0,
        allow_multiple_values: true,
        required: false,
        name: title,
        default_value: defaultValue,
        ui_config: { display: 'popover', type: 'advanced' },
        listens_to_filters: [],
      };

      const match = existingFilters.find((existing) => existing.dimension === dimension);
      if (match) {
        await this.sdk.ok(this.sdk.update_dashboard_filter(match.id, filterData));
      } else {
        await this.sdk.ok(this.sdk.create_dashboard_filter(filterData));
      }
    }

    await this.ensureTileListeners(currentDashboardId, selectedFilterDimensions, filterNameMap);
  }

  async getDefaultColumnsAndFilterNameMap(dashboardId, tileTitle) {
    const dashboard = await this.sdk.ok(this.sdk.dashboard(dashboardId));
    const targetTitle = tileTitle || this.config.tileTitle;
    const tile = dashboard.dashboard_elements?.find((element) => element.title === targetTitle);
    if (!tile) {
      throw new Error(`Tile with title "${targetTitle}" not found in dashboard`);
    }
    const queryId = tile?.query_id ?? tile?.result_maker?.query_id;

    if (!queryId) {
      throw new Error(`No query_id found for tile titled "${tileTitle}"`);
    }

    const originalQuery = await this.sdk.ok(this.sdk.query(queryId));

    const listens = tile.result_maker?.filterables?.[0]?.listen || [];

    const filterNameMap = {};
    listens.forEach(({ field, dashboard_filter_name }) => {
      if (field && dashboard_filter_name) {
        filterNameMap[field] = dashboard_filter_name;
      }
    });

    let defaultColumns = originalQuery.fields || [];
    if (this.config.tileTitle) {
      defaultColumns = [...new Set(originalQuery.fields || [])];
    }

    return {
      default_columns: defaultColumns,
      filterNameMap,
    };
  }

  async getFilterValues(dimensions, selectedMeasure) {
    return await Promise.all(
      dimensions.map(async (dimension) => {
        if (!dimension) return { dimension, values: [] };

        try {
          const measureToUse = selectedMeasure || 'count';
          const queryConfig = {
            model: this.config.model,
            view: this.config.explore,
            fields: [dimension, measureToUse],
            sorts: [`${measureToUse} desc`],
            limit: 300,
          };

          if (this.config.baseFilters) {
            queryConfig.filters = this.config.baseFilters;
          }

          const query = await this.sdk.ok(this.sdk.create_query(queryConfig));
          const queryResult = await this.sdk.ok(
            this.sdk.run_query({ query_id: query.id, result_format: 'json' })
          ) as QueryResult[];

          const parsedValues = Array.isArray(queryResult) ? queryResult : [];
          const allValues = parsedValues
            .map((row: QueryResult) => ({
              value: String(row[dimension]),
              count: Number(row[selectedMeasure || 'count']) || 0,
            }))
            .filter(({ value }) => value !== null && value !== undefined && value !== 'null');

          const formattedValues = allValues
            .map(({ value, count }) => `${value} (${count})`)
            .filter((value) => value !== 'null (0)')
            .slice(0, Number(this.config.limitResults) || 5);

          return { dimension, values: formattedValues };
        } catch (error) {
          console.error(`Error fetching values for ${dimension}:`, error);
          return { dimension, values: [] };
        }
      })
    );
  }

  async getDateRangeCounts(dimensions, selectedMeasure) {
    if (!this.config.dateField) {
      console.warn('No dateField configured; skipping date range counts.');
      return dimensions.map((dimension) => ({ dimension, counts: {} }));
    }

    const latestDateQuery = await this.sdk.ok(
      this.sdk.create_query({
        model: this.config.model,
        view: this.config.explore,
        fields: [this.config.dateField],
        sorts: [`${this.config.dateField} desc`],
        limit: '1',
      })
    );
    const latestDateResult = await this.sdk.ok(
      this.sdk.run_query({ query_id: latestDateQuery.id, result_format: 'json' })
    );
    const latestDate =
      latestDateResult[0]?.[this.config.dateField] || new Date().toISOString().split('T')[0];

    return await Promise.all(
      dimensions.map(async (dimension) => {
        if (!dimension) return { dimension, counts: {} };

        const isDateField = dimension.toLowerCase().includes('date');
        if (!isDateField) return { dimension, counts: {} };

        const counts = {};
        const rangeOptions = [
          'last 1 month',
          'last 4 months',
          'last 1 year',
          'last 2 years',
          'last 5 years',
        ];

        for (const range of rangeOptions) {
          try {
            const query = await this.sdk.ok(
              this.sdk.create_query({
                model: this.config.model,
                view: this.config.explore,
                fields: [selectedMeasure || 'count'],
                filters: {
                  [dimension]: range,
                },
                limit: '1',
              })
            );
            const queryResult = await this.sdk.ok(
              this.sdk.run_query({ query_id: query.id, result_format: 'json' })
            );
            const count = queryResult[0]?.[selectedMeasure || 'count'] || 0;
            counts[range] = Number(count);
          } catch (error) {
            console.error(`Error fetching count for ${dimension} with range ${range}:`, error);
            counts[range] = 0;
          }
        }

        return { dimension, counts };
      })
    );
  }

  async saveDashboardCopy(currentDashboardId, folderId, customName) {
    const existingDashboards = await this.sdk.ok(
      this.sdk.search_dashboards({ title: customName, folder_id: folderId })
    );

    if (existingDashboards.length > 0) {
      throw new Error(`A dashboard named "${customName}" already exists in the folder.`);
    }

    const copiedDashboard = await this.sdk.ok(this.sdk.copy_dashboard(currentDashboardId, folderId));
    await this.sdk.ok(this.sdk.update_dashboard(copiedDashboard.id, { title: customName }));
    return String(copiedDashboard.id);
  }

  async getDashboardFilters(dashboardId) {
    const dashboard = await this.sdk.ok(this.sdk.dashboard(dashboardId));
    return (
      dashboard.dashboard_filters?.map((filter) => ({
        name: filter.name,
        title: filter.title,
        type: filter.type,
        dimension: filter.dimension,
        allow_multiple_values: filter.allow_multiple_values,
        required: filter.required,
        default_value: filter.default_value,
      })) || []
    );
  }

  async getDashboardListForUI(folderId, originalDashboardId) {
    const dashboardsInFolder = await this.sdk.ok(
      this.sdk.search_dashboards({ folder_id: folderId })
    );

    const dashboards = dashboardsInFolder
      .filter((dashboard) => !dashboard.deleted)
      .map((dashboard) => ({
        id: String(dashboard.id),
        title: dashboard.title,
      }));

    if (!originalDashboardId) {
      return dashboards;
    }

    const isOriginalInList = dashboards.some(
      (dashboard) => dashboard.id === String(originalDashboardId)
    );

    if (isOriginalInList) {
      return dashboards;
    }

    const originalDashboard = await this.sdk.ok(
      this.sdk.dashboard(originalDashboardId)
    );

    if (!originalDashboard?.id || !originalDashboard?.title) {
      return dashboards;
    }

    return [
      ...dashboards,
      { id: String(originalDashboard.id), title: originalDashboard.title },
    ];
  }

  async getDashboardTilesWithResults(dashboardId, finalFilters = {}) {
    const dashboard = await this.sdk.ok(this.sdk.dashboard(dashboardId));
    const tilesWithResults = [];

    for (const tile of dashboard.dashboard_elements || []) {
      const visConfigType = tile?.query?.vis_config?.type || tile.result_maker?.vis_config?.type;
      const queryId = tile.query_id || tile.result_maker?.query_id;

      if (!queryId || visConfigType === 'looker_grid' || visConfigType === 'table') {
        continue;
      }

      try {
        const originalQuery = await this.sdk.ok(this.sdk.query(queryId));
        const newQuery = await this.sdk.ok(
          this.sdk.create_query({
            model: originalQuery.model,
            view: originalQuery.view,
            fields: originalQuery.fields,
            filters: {
              ...originalQuery.filters,
              ...finalFilters,
            },
            sorts: originalQuery.sorts,
            limit: originalQuery.limit,
            column_limit: originalQuery.column_limit,
            pivots: originalQuery.pivots,
            total: originalQuery.total,
            row_total: originalQuery.row_total,
            dynamic_fields: originalQuery.dynamic_fields,
            filter_expression: originalQuery.filter_expression,
            vis_config: originalQuery.vis_config,
          })
        );

        const queryResult = await this.sdk.ok(
          this.sdk.run_query({
            query_id: newQuery.id,
            result_format: 'json',
          })
        );

        tilesWithResults.push({
          title: tile.title ? String(tile.title) : `Tile ${tile.id}`,
          query_id: String(queryId),
          data: Array.isArray(queryResult) ? queryResult : [],
        });
      } catch (error) {
        console.warn(`Failed to fetch data for tile "${tile.title}"`, error);
      }
    }

    return {
      dashboard: {
        id: String(dashboard.id ?? dashboardId),
        title: dashboard.title ?? '',
        description: dashboard.description ?? undefined,
      },
      tiles: tilesWithResults,
    };
  }

  async saveExploreMeasures(modelName, exploreName) {
    try {
      const exploreResponse = await this.sdk.lookml_model_explore({
        lookml_model_name: modelName,
        explore_name: exploreName,
      });

      if (!exploreResponse.ok) {
        throw new Error(`API call failed: ${JSON.stringify(exploreResponse)}`);
      }

      const exploreData = exploreResponse.value;
      const [model, exploreNameFromId] = exploreData.id?.split('::') || [];

      const measures = exploreData.fields?.measures || [];
      const dimensions = exploreData.fields?.dimensions || [];

      const fields = [
        ...measures.map((measure) => ({
          name: measure.suggest_dimension,
          is_grid_column: false,
          is_filterable: false,
          is_keyword_searchable: true,
          measure: measure.measure === true,
        })),
        ...dimensions.map((dimension) => ({
          name: dimension.suggest_dimension,
          is_grid_column: false,
          is_filterable: false,
          is_keyword_searchable: true,
          measure: false,
        })),
      ];

      const allDashboards = await this.sdk.ok(this.sdk.all_dashboards());
      const voucherDashboardIds = allDashboards
        .filter(
          (dashboard) =>
            dashboard.id &&
            dashboard.id.toString().toLowerCase().includes('syntrelis') &&
            dashboard.id.toString().toLowerCase().includes('voucher')
        )
        .map((dashboard) => dashboard.id);
      const [folderName] = voucherDashboardIds[0].split('::');

      const result = {
        [folderName]: {},
      };

      voucherDashboardIds.forEach((dashboardId, index) => {
        const dashboardName = `dashboard${index + 1}`;
        result[folderName][dashboardName] = {
          dashboard_id: dashboardId,
          model_name: model,
          explore_: exploreNameFromId,
          fields,
        };
      });

      const fileName = `explore_measures1_${exploreNameFromId}.json`;
      const filePath = path.join(process.cwd(), fileName);
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2));

      const { setDoc, sourceRef } = await initializeFirebase();
      await setDoc(sourceRef, result);

      return {
        filePath,
        voucherDashboardIds,
      };
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
  }
}

module.exports = { DashboardService };
