import { Router } from "express";
import { Dealer, VehicleModel, VehicleVariant } from "../data/models/index.js";

const router = Router();

router.get("/dealers", async (request, response) => {
  try {
    const dealers = await Dealer.findAll({
      filters: {
        city: request.query.city,
        dealerType: request.query.dealerType,
        region: request.query.region,
        state: request.query.state
      },
      limit: request.query.limit || 1000,
      offset: request.query.offset || 0
    });

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

router.get("/models", async (request, response) => {
  try {
    const models = await VehicleModel.findAll({
      filters: {
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
        launchYear: Number(model.launch_year)
      }))
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/variants", async (request, response) => {
  try {
    const variants = await VehicleVariant.findAll({
      filters: {
        fuelType: request.query.fuelType,
        modelId: request.query.modelId,
        transmission: request.query.transmission
      },
      limit: request.query.limit || 1000,
      offset: request.query.offset || 0
    });

    response.json({
      ok: true,
      variants: variants.map((variant) => ({
        id: variant.variant_id,
        modelId: variant.model_id,
        name: variant.variant,
        fuelType: variant.fuel_type,
        transmission: variant.transmission,
        exShowroomPrice: Number(variant.ex_showroom_price)
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
