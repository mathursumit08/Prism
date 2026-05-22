import { createModel } from "./baseModel.js";

export const VehicleVariant = createModel({
  tableName: "vehicle_variants",
  primaryKey: "variant_id",
  allowedFilters: {
    fuelType: "fuel_type",
    isActive: "is_active",
    isDiscontinued: "is_discontinued",
    modelId: "model_id",
    transmission: "transmission"
  }
});
