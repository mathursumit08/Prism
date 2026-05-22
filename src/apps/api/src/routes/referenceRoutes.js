import { Router } from "express";
import { VehicleModel } from "../data/models/index.js";
import { pool } from "../db.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { getScope, permissions } from "../auth/accessControl.js";

const router = Router();

router.use(authenticate);

router.get("/dealers", async (request, response) => {
  try {
    if (!request.user.permissions.includes(permissions.viewForecast)) {
      response.status(403).json({
        ok: false,
        error: "You do not have permission to view forecast data"
      });
      return;
    }

    const scope = getScope(request.user, "Sales");
    const values = [];
    const conditions = ["is_active = TRUE"];
    const addCondition = (value, sql) => {
      if (!value) return;
      values.push(value);
      conditions.push(sql(values.length));
    };
    addCondition(request.query.city, (index) => `city = $${index}`);
    addCondition(request.query.dealerType, (index) => `dealer_type = $${index}`);
    addCondition(request.query.region, (index) => `region = $${index}`);
    addCondition(request.query.state, (index) => `state = $${index}`);

    if (scope.kind === "none") {
      conditions.push("FALSE");
    }

    const scopeChecks = [];
    if (scope.kind === "Region" || scope.regions?.length) {
      values.push(scope.kind === "Region" ? [scope.region] : scope.regions);
      scopeChecks.push(`region = ANY($${values.length}::VARCHAR[])`);
    }

    if (scope.kind === "Dealer" || scope.dealerIds?.length) {
      values.push(scope.kind === "Dealer" ? [scope.dealerId] : scope.dealerIds);
      scopeChecks.push(`dealer_id = ANY($${values.length}::VARCHAR[])`);
    }

    if (scopeChecks.length > 0) {
      conditions.push(`(${scopeChecks.join(" OR ")})`);
    }

    values.push(Math.min(Math.max(Number(request.query.limit) || 1000, 1), 1000));
    const limitParameter = `$${values.length}`;
    values.push(Math.max(Number(request.query.offset) || 0, 0));
    const offsetParameter = `$${values.length}`;
    const result = await pool.query(
      `
        SELECT *
        FROM dealers
        WHERE ${conditions.join(" AND ")}
        ORDER BY dealer_name
        LIMIT ${limitParameter} OFFSET ${offsetParameter}
      `,
      values
    );
    const dealers = result.rows;

    response.json({
      ok: true,
      dealers: dealers.map((dealer) => ({
        id: dealer.dealer_id,
        name: dealer.dealer_name,
        region: dealer.region,
        city: dealer.city,
        state: dealer.state,
        dealerType: dealer.dealer_type,
        salesCapacityPerMonth: Number(dealer.sales_capacity_per_month)
      }))
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/models", requirePermission(permissions.viewForecast), async (request, response) => {
  try {
    const models = await VehicleModel.findAll({
      filters: {
        isActive: true,
        isDiscontinued: false,
        manufacturer: request.query.manufacturer,
        segment: request.query.segment
      },
      limit: request.query.limit || 1000,
      offset: request.query.offset || 0
    });

    response.json({
      ok: true,
      models: models.map((model) => ({
        id: model.model_id,
        name: model.model,
        manufacturer: model.manufacturer,
        segment: model.segment,
        launchYear: Number(model.launch_year),
        isActive: Boolean(model.is_active),
        isDiscontinued: Boolean(model.is_discontinued)
      }))
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/variants", requirePermission(permissions.viewForecast), async (request, response) => {
  try {
    const safeLimit = Math.min(Math.max(Number(request.query.limit) || 1000, 1), 1000);
    const safeOffset = Math.max(Number(request.query.offset) || 0, 0);
    const values = [];
    const conditions = [
      "vv.is_active = TRUE",
      "vv.is_discontinued = FALSE",
      "vm.is_active = TRUE",
      "vm.is_discontinued = FALSE"
    ];

    if (request.query.fuelType) {
      values.push(request.query.fuelType);
      conditions.push(`vv.fuel_type = $${values.length}`);
    }

    if (request.query.modelId) {
      values.push(request.query.modelId);
      conditions.push(`vv.model_id = $${values.length}`);
    }

    if (request.query.transmission) {
      values.push(request.query.transmission);
      conditions.push(`vv.transmission = $${values.length}`);
    }

    values.push(safeLimit, safeOffset);
    const limitParameter = `$${values.length - 1}`;
    const offsetParameter = `$${values.length}`;
    const result = await pool.query(
      `
        SELECT vv.*
        FROM vehicle_variants vv
        JOIN vehicle_models vm ON vm.model_id = vv.model_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY vv.variant_id
        LIMIT ${limitParameter} OFFSET ${offsetParameter}
      `,
      values
    );
    const variants = result.rows;

    response.json({
      ok: true,
      variants: variants.map((variant) => ({
        id: variant.variant_id,
        modelId: variant.model_id,
        name: variant.variant,
        fuelType: variant.fuel_type,
        transmission: variant.transmission,
        exShowroomPrice: Number(variant.ex_showroom_price),
        isActive: Boolean(variant.is_active),
        isDiscontinued: Boolean(variant.is_discontinued)
      }))
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
