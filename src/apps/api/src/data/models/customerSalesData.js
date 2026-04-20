import { createModel } from "./baseModel.js";

export const CustomerSalesData = createModel({
  tableName: "customer_sales_data",
  primaryKey: "sale_id",
  allowedFilters: {
    buyerType: "buyer_type",
    customerId: "customer_id",
    dealerId: "dealer_id",
    modelId: "model_id",
    month: "month",
    paymentMethod: "payment_method",
    salesChannel: "sales_channel",
    salespersonId: "salesperson_id",
    variantId: "variant_id"
  }
});
