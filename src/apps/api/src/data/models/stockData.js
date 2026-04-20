import { createModel } from "./baseModel.js";

export const StockData = createModel({
  tableName: "stock_data",
  primaryKey: "month",
  allowedFilters: {
    dealerId: "dealer_id",
    modelId: "model_id",
    month: "month",
    variantId: "variant_id"
  }
});
