import { createModel } from "./baseModel.js";

export const VehicleModel = createModel({
  tableName: "vehicle_models",
  primaryKey: "model_id",
  allowedFilters: {
    isActive: "is_active",
    isDiscontinued: "is_discontinued",
    manufacturer: "manufacturer",
    segment: "segment"
  }
});
