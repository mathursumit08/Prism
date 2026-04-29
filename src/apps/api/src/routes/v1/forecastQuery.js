const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const maxPageSize = 1000;

function isValidDate(value) {
  return isoDatePattern.test(value) && !Number.isNaN(Date.parse(value));
}

export function parseForecastQuery(query) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 100);
  const horizon = query.horizon === undefined ? null : Number(query.horizon);
  const startDate = query.startDate || null;
  const endDate = query.endDate || null;
  const region = query.region?.trim() || null;
  const segment = query.segment?.trim() || null;
  const errors = [];

  if (!Number.isInteger(page) || page < 1) {
    errors.push("page must be an integer greater than or equal to 1");
  }

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
    errors.push(`pageSize must be an integer between 1 and ${maxPageSize}`);
  }

  if (horizon !== null && (!Number.isInteger(horizon) || horizon < 1 || horizon > 60)) {
    errors.push("horizon must be an integer between 1 and 60");
  }

  if (startDate && !isValidDate(startDate)) {
    errors.push("startDate must be a valid ISO date in YYYY-MM-DD format");
  }

  if (endDate && !isValidDate(endDate)) {
    errors.push("endDate must be a valid ISO date in YYYY-MM-DD format");
  }

  if (startDate && endDate && Date.parse(startDate) > Date.parse(endDate)) {
    errors.push("startDate must be earlier than or equal to endDate");
  }

  return {
    filters: {
      endDate,
      horizon,
      page,
      pageSize,
      region,
      segment,
      startDate
    },
    isValid: errors.length === 0,
    errors,
    maxPageSize
  };
}
