import { createModel } from "./baseModel.js";

export const VehicleVariant = createModel({
  tableName: "vehicle_variants",
  primaryKey: "variant_id",
  allowedFilters: {
    fuelType: "fuel_type",
    modelId: "model_id",
    transmission: "transmission"
  }
});
