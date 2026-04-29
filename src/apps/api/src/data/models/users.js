import { createModel } from "./baseModel.js";

export const User = createModel({
  tableName: "users",
  primaryKey: "username",
  allowedFilters: {
    dealerId: "dealer_id",
    region: "region",
    reportsToId: "reports_to_id",
    roleId: "role_id",
    username: "username"
  }
});
