import { createModel } from "./baseModel.js";

export const MonthlySalesData = createModel({
  tableName: "monthly_sales_data",
  primaryKey: "month",
  allowedFilters: {
    dealerId: "dealer_id",
    modelId: "model_id",
    month: "month",
    variantId: "variant_id"
  }
});
