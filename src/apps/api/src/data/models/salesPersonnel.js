import { createModel } from "./baseModel.js";

export const SalesPersonnel = createModel({
  tableName: "sales_personnel",
  primaryKey: "employee_id",
  allowedFilters: {
    dealerId: "dealer_id",
    region: "region",
    reportsToId: "reports_to_id",
    role: "role"
  }
});
