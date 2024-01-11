const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

exports.protect = catchAsync(async (req, res, next) => {
  if (req.body.user == null) {
    return next(new AppError("Failed to get auth from the client", 403));
  }

  req.user = req.body.user;
  next();
});

exports.isAdmin = catchAsync(async (req, res, next) => {
  if (req.user.isAdmin !== true) {
    return next(new AppError("You're not an admin of the project on ALM!", 403));
  }

  next();
});
