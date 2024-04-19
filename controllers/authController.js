const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

exports.protect = catchAsync(async (req, res, next) => {
  if (req.body.client == null) {
    return next(new AppError("Failed to get client ID", 403));
  }
  
  req.client = req.body.client;
  next();
});