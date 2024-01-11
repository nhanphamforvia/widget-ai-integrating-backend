const catchAsync = require("../utils/catchAsync");

exports.analyzePDF = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: "success",
    message: "Need to implement the analyze PDF controller",
  });
});
