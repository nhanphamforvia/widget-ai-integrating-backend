const path = require("path");
const express = require("express");
const cors = require("cors");
const compression = require("compression");

const AppError = require("./utils/appError");
const globalErrorHandler = require("./controllers/errorController");
const openaiRoutes = require("./routes/openAIRoutes");
const translatorRoutes = require("./routes/translatorRoutes");
const docIntelRoutes = require("./routes/docIntelRoutes");

const app = express();

// Security
app.set("trust proxy", true);

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

// Test route
app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Hello world!",
  });
});

app.get("/api-trusted", (req, res) => {
  res.status(200).send(`<div style="display: flex; flex-direction: column; justify-content: center; align-items: center; width: 100%; height: 100vh;">
    <div>The API is trusted. You can now close this window to proceed.</div>
    <p><i>Production Server Response</i></p>
  </div>`);
});

// Routes
app.use("/api/v1/openai", openaiRoutes);
app.use("/api/v1/translator", translatorRoutes);
app.use("/api/v1/docIntel", docIntelRoutes);

app.use("*", (req, res, next) => {
  next(new AppError(`No routes found at ${req.originalUrl}`, 400));
});

// Error hanlder
app.use(globalErrorHandler);
module.exports = app;
