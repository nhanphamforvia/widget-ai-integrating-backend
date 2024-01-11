const catchAsync = require("../utils/catchAsync");

exports.translate = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: "success",
    message: "Need to implement the translator controller",
  });
});
