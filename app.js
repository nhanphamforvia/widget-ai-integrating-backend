const path = require("path");
const express = require("express");
const cors = require("cors");
const compression = require("compression");

const AppError = require("./utils/appError");
const globalErrorHandler = require("./controllers/errorController");
const openaiRoutes = require("./routes/openAIRoutes");

const app = express();

// Security
app.use(
  cors({
    origin: ["https://almt.hella.com", "https://alm.hella.com"],
    credentials: true,
  })
);

app.options(
  "*",
  cors({
    origin: ["https://almt.hella.com", "https://alm.hella.com"],
  })
);

// Serve
app.use(express.static(path.join(__dirname, "public")));

// Transfer data to process
app.use(express.json());
app.use(compression());

// Routes
app.use("/api/v1/openai", openaiRoutes);

app.use("*", (req, res, next) => {
  next(new AppError(`No routes found at ${req.originalUrl}`, 400));
});

// Error hanlder
app.use(globalErrorHandler);
module.exports = app;
