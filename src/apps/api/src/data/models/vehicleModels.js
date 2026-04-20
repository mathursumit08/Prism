import { createModel } from "./baseModel.js";

export const VehicleModel = createModel({
  tableName: "vehicle_models",
  primaryKey: "model_id",
  allowedFilters: {
    manufacturer: "manufacturer",
    segment: "segment"
  }
});
