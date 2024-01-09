const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const xss = require("xss-clean");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const cors = require("cors");
const compression = require("compression");

const AppError = require("./utils/appError");
const globalErrorHandler = require("./controllers/errorController");
const openaiRoutes = require("./routes/openAIRoutes");

const app = express();

// app.enable("trust proxy");

// Security
// app.use(
//   cors({
//     origin: ["https://almt.hella.com/"],
//     credentials: true,
//   })
// );

app.use(
  cors({
    origin: "https://almt.hella.com",
  })
);

app.options(
  "*",
  cors({
    origin: "https://almt.hella.com",
  })
);

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100000,
//   message: "You have reached the maximum query limit. Please wait for 15 minutes...",
// });

// app.use(helmet());
// app.use(limiter);
// app.use(xss());
// app.use(
//   hpp({
//     whitelist: ["name", "vendor", "variants", "SKU", "slug", "maxPrice", "minPrice", "categories", "collections", "tags", "inventory", "bidding"],
//   })
// );

// Serve
app.use(express.static(path.join(__dirname, "public")));

// Transfer data to process
app.use(express.json());
// app.use(cookieParser());
// app.use(compression());

// Routes
app.use("/api/v1/openai", openaiRoutes);

app.use("*", (req, res, next) => {
  next(new AppError(`No routes found at ${req.originalUrl}`, 400));
});

// Error hanlder
app.use(globalErrorHandler);
module.exports = app;
